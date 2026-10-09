# Contracts

Invoice receiver contracts v1: a factory and one receiver clone per invoice (PLAN.md Phase 5, C-03, C-04, C-10).
Design and diagrams: PLAN.md "Phase 5". These rules come from the 2026-10-09 design review and audit
(solidity-auditor, fp-check, fizz/Medusa; findings fixed in F039 and F041).

## Status

Pre-release. Until the first mainnet deployment, the contracts may be redesigned and patched freely: keep every
test green and update PLAN.md and `docs/diagrams/` in the same pull request. After the first mainnet deployment,
deployed contracts never change; a fix ships as a new factory version, and old factories stay deployed for recovery.

## Commands

- `forge build`, `forge test` in this folder, or `pnpm --filter @forwend/contracts test` from the root.
- `node script/rpc.mjs <chain>` prints a working RPC from `chains.json`: each key in `INFURA_API_KEYS`, then public RPCs.
- Secrets live only in the root `.env` (git-ignored). Never print, log or commit a private key.

## Rules (each one has a test)

Terms (immutable clone args):
- Only `invoiceId` (256 random bits from the backend), `recipient`, `token`, `amount`, `expiresAt`, `settleDeadline`,
  `intendedChainId`. No authority, executor or fee in the terms: the API writes the terms and must not choose who can
  move money. No profile, merchant or project ID: the terms are public forever and an ID would link every invoice of
  one profile; `invoiceId` maps to the profile in our database.
- `predict` and `deploy` never reject terms: any address a payer could have been shown must stay deployable, or its
  money would be stuck forever. Unsafe terms are refused when money moves: `settle` rejects amount 0 and a recipient that
  is 0, the receiver, the factory, the implementation or the token, so that money goes to `refund` instead. The backend
  still validates terms before it shows an address (Backend rules).
- The settle deadline is capped: the effective deadline is `min(settleDeadline, deployedAt + MAX_HOLD)` with
  `MAX_HOLD = 30 days`, so a wrong or huge deadline (milliseconds by mistake, a compromised API) cannot freeze money.

Factory:
- `refundAuthority` is an immutable constructor argument: the Safe on mainnet, a test EOA on testnets. Losing it means
  a new factory, so the Safe must always be able to rotate its own owners.
- `executor` is stored in the factory; only the refund authority can change it (a leaked executor key is replaceable).
  The first executor is a constructor argument, so it is part of the factory address: use the same one on every chain,
  and keep passing it to `script/Deploy.s.sol` as `EXECUTOR` after `setExecutor` (the script then finds the factory).
  A factory deployed on a new chain later starts with that first executor: the refund authority calls `setExecutor`
  there right after the deploy.
- `paused` is set only by the refund authority and blocks `settle` only, never refunds.
- Creates the implementation in its constructor. Only the executor or the refund authority may `deploy` (on Arc a
  deployed receiver rejects native transfers, so a stranger deploying early could block a payer's top-up). `deploy`
  returns an already deployed receiver and records `deployedAt` and `receiverOf(invoiceId)` (first deploy wins; a lookup
  aid, never an authority for money decisions).
- Read-only status for the backend, support, explorers and Safe owners: `status(terms)` works before deployment,
  `statusOf(invoiceId)` for deployed receivers, and the receiver's own `status()`. Each returns the receiver, deployed,
  chain match, balance, settled, refundable, settleable, who may settle now and the effective deadline. Settled,
  Refunded and Recovered events carry the invoiceId.
- Deployed only through the CREATE2 deployer `0x4e59b44847b379578588920cA78FbF26c0B4956C`, with the same bytecode on
  every chain (`foundry.toml` pins solc, `evm_version` and no metadata hash). Never a nonce-based deployment: a leaked
  deployer key could then put other code at our addresses on a new chain. A chain without the CREATE2 deployer gets its
  own factory address and no cross-chain recovery.

Receiver:
- `settle()`: intended chain only; not paused; not settled; safe terms (above); balance at least `amount`. The executor
  may call it until the effective deadline, then only the refund authority. Pays exactly `amount` to `recipient` and checks the recipient's
  balance rose by exactly `amount`. `settleDeadline` is at least finality lag plus a retry margin (default 24 h after
  `expiresAt`).
- `refund(to, amount)`: refund authority only; intended chain only; `to` is not 0 or the receiver. May repeat, but never
  more than the refundable amount: the whole balance once settled or after the effective deadline; before that, only
  what is above `amount`. The rule lives in one function (`refundableAmount`) used by the receiver and `status`.
- `recover(token, to, amount)`: refund authority only. On the intended chain it never sends the invoice token and never
  lowers the invoice-token balance (on Arc the native coin and USDC are one balance). The balance is read with a
  low-level call that copies at most 32 bytes, so a broken invoice token (no code, reverting `balanceOf`, huge reply)
  never blocks recovery of other tokens or the native coin. Accepted: a malicious invoice token that burns all gas can
  still block `recover`; only a compromised API can put one in the terms, and it could steal more directly. No gas cap
  on the read: Tempo's built-in tokens cost far more gas than Ethereum's. `token = address(0)` is the native coin.
  Accepted: on Arc the guard reads the 6-decimal view of an 18-decimal balance, so `recover(address(0))` can move less
  than 1e12 wei (under 0.000001 USDC) in total without a visible drop.
- Checks-effects-interactions and `nonReentrant` on `settle`, `refund` and `recover`.
- No `approve`, no `isValidSignature` (USDC `permit` accepts contract signatures), no `fallback` or `receive`, no
  `selfdestruct`, no `delegatecall`, no external calls except to the token and reads from the factory.
- Works only if our factory deployed it: `settle`, `refund`, `recover`, `terms`, `deadline`, `refundable` and `status`
  revert unless `factory.deployedAt(this) != 0`, so the implementation and clones made outside the factory (same code,
  the real factory's roles, any terms) do nothing. Only the plain getters `settled` and `factory` still answer.

Safe (mainnet; testnets use an EOA):
- Safe 1.4.1 or newer, at least 3 of 5 owners on hardware keys, the same address on every planned chain, deployed on all
  of them on day one; owner changes are applied on every chain.
- Everything that can move money or weaken the controls goes through a 24–48 h Delay module, with alerts, so honest
  owners can cancel a transaction that tricked signers approved: a receiver's `refund`, `recover` and post-deadline
  `settle`; Safe admin changes (owners, threshold, guard, modules, fallback handler), so key rotation also waits; and the
  Delay module's own settings.
- A Guard allows a direct (undelayed) Safe transaction only for: `factory.setPaused`, `factory.setExecutor` (harmless:
  the executor can only pay the fixed recipient), queuing a transaction on the Delay module, and cancelling one
  (`setTxNonce`). Direct transactions never use `delegatecall`, so a batch cannot hide a call. Delayed transactions
  may batch through `MultiSendCallOnly` 1.4.1 (deploy, then refund). Safe 1.4.1 Guards do not check module
  transactions; the delay is the control there, so the Guard also decodes every call that queues on the Delay module
  and allows an inner `delegatecall` only to `MultiSendCallOnly`. The Delay module sets `txExpiration`, and owners
  cancel every unwanted queued transaction: after the cooldown anyone can execute it.
- A pause that lasts more than a few hours alerts every owner: paid invoices pushed past their deadline move from the
  executor to the Safe (`setPaused` has no delay).
- `isReceiver` only proves our clone code. Before signing a queued refund, owners check `receiverOf(invoiceId)` equals
  the target, the terms match the claim, and `refundable` covers the amount.
- Keep the original owner keys recoverable: deploying the Safe on a new chain later replays the original owner set.
  The reverse risk: former owners can claim the Safe address on any chain where it is not deployed yet, so deploy it on
  every EVM chain where a wrong-chain deposit could arrive before changing owners.
  Old factories keep their Safe forever.
- The delay cannot stop owners who hold the threshold of keys themselves; it stops tricked or blind signing.
- Refunds go to the deposit's sender by default; any other address needs written evidence. Owners check every
  transaction hash with an independent tool before signing.

Backend rules that protect these contracts (PLAN.md Phase 6 and 8):
- The receive address is computed locally from the factory address and init-code hash compiled into the binary, never
  from the database or an RPC call, and recomputed on the checkout page, which refuses to show a mismatch.
- `(chain_id, receive_address)` is unique; the watcher alerts on any invoice whose address does not recompute.
- A second, independent RPC confirms the balance before an invoice is marked paid or a webhook is sent.
- "Paid" comes only from `balanceOf` of the allowlisted token contract (chain ID + address) on a receive address the
  backend computed itself. Logs and events from any other address are ignored: anyone can deploy a look-alike token or
  a clone outside the factory that emits the same `Transfer`, `Settled` or `ReceiverDeployed`-shaped events.
- The checkout page has no third-party scripts and pinned dependencies. A canary from an independent build and host
  takes the factory address from its own config, calls `predict(terms)` on two RPCs and compares the result with the live
  checkout; a canary in the same build would share a tampered constant.
- The backend runs the same term checks as `settle` (and expiry ≤ 365 days, settle deadline = expiry + 24 h; the
  contract accepts any window, even zero, because it never rejects terms) before it shows an address, with shared test vectors between the Go address code and `predict`.
- On Arc the checkout builds an ERC-20 `transfer` on `0x3600…`, never a native send, and the watcher decides "paid" from
  `balanceOf` (6 decimals), exactly what `settle` checks. Native USDC sends log `Transfer` from a system emitter
  (18 decimals), not from `0x3600…`; index it for deposit times. Deploy happens only when settling, refunding or
  recovering.
- The recipient wallet must exist on the invoice's chain before the invoice is created.
- The executor can settle money the backend would hold (late, cancelled) before the deadline; it still goes only to the
  recipient. Accepted: a leaked executor key misdirects a dispute, it cannot steal.
- Testnet invoices are never shown to real payers: the testnet refund-authority key can `recover` real money paid to
  the same address on a mainnet chain.

## Tests

- A unit test for every rule above, fuzz tests on amounts and timestamps, and invariants: settled ≤ amount;
  settled + refunded ≤ received; only `recipient` receives settlement; refunds never take `amount` before
  `settleDeadline`; the executor cannot move funds anywhere except `recipient`.
- Halmos symbolic tests for `settle`, `refund` and `recover` (`forge clean` first: Halmos needs a fresh build).
- Cross-chain: the same terms give the same address on two Anvil chains, and `settle`/`refund` revert on the wrong one.
- Fork test against Base Sepolia with the real USDC contract; a mock token for USDT behaviour.
