# Contracts

Invoice receiver contracts v1: a factory and one receiver clone per invoice (PLAN.md Phase 5, C-03, C-04, C-10).
Design and diagrams: PLAN.md "Phase 5". These rules come from the 2026-10-09 design review.

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
  move money.
- `predict` and `deploy` reject: amount 0; recipient 0, the receiver itself, the factory or the token; token 0;
  expiresAt 0; settleDeadline before expiresAt; chain id 0. Expiry in the past is a backend check only, because a late
  deposit deploys the receiver after expiry.

Factory:
- `refundAuthority` is an immutable constructor argument: the Safe on mainnet, a test EOA on testnets.
- `executor` is stored in the factory; only the refund authority can change it (a leaked executor key is replaceable).
- `paused` is set only by the refund authority and blocks `settle` only, never refunds.
- Creates the implementation in its constructor. `deploy` returns the existing receiver if it is already deployed and
  records every receiver it deploys (the Safe Guard allows only these).
- Deployed only through the CREATE2 deployer `0x4e59b44847b379578588920cA78FbF26c0B4956C`, with the same bytecode on
  every chain (`foundry.toml` pins solc, `evm_version` and no metadata hash). Never a nonce-based deployment: a leaked
  deployer key could then put other code at our addresses on a new chain. A chain without the CREATE2 deployer gets its
  own factory address and no cross-chain recovery.

Receiver:
- `settle()`: intended chain only; not paused; not settled; balance at least `amount`. The executor may call it until
  `settleDeadline`, then only the refund authority. Pays exactly `amount` to `recipient` and checks the recipient's
  balance rose by exactly `amount`. `settleDeadline` is at least finality lag plus a retry margin (default 24 h after
  `expiresAt`).
- `refund(to, amount)`: refund authority only; intended chain only; `to` is not 0 or the receiver. May repeat, but never
  more than the refundable amount: the whole balance once settled or after `settleDeadline`; before that, only what is
  above `amount`.
- `recover(token, to, amount)`: refund authority only. On the intended chain it never sends the invoice token and never
  lowers the invoice-token balance (on Arc the native coin and USDC are one balance). `token = address(0)` is the native
  coin.
- Checks-effects-interactions and `nonReentrant` on `settle`, `refund` and `recover`.
- No `approve`, no `isValidSignature` (USDC `permit` accepts contract signatures), no `fallback` or `receive`, no
  `selfdestruct`, no `delegatecall`, no external calls except to the token and reads from the factory. Calling the
  implementation directly reverts.

Safe (mainnet; testnets use an EOA):
- Safe 1.4.1 or newer, at least 3 of 5 owners on hardware keys, the same address on every planned chain, deployed on all
  of them on day one; owner changes are applied on every chain.
- A Guard blocks `delegatecall` and allows only the factory and receivers it deployed as targets.
- A 24–48 h Delay module on `refund` and `recover`, with alerts and a cancel path; `setPaused` stays instant.
- Refunds go to the deposit's sender by default; any other address needs written evidence. Owners check every
  transaction hash with an independent tool before signing.

Backend rules that protect these contracts (PLAN.md Phase 6 and 8):
- The receive address is computed locally from the factory address and init-code hash compiled into the binary, never
  from the database or an RPC call, and recomputed on the checkout page, which refuses to show a mismatch.
- `(chain_id, receive_address)` is unique; the watcher alerts on any invoice whose address does not recompute.
- A second, independent RPC confirms the balance before an invoice is marked paid or a webhook is sent.
- The checkout page has no third-party scripts and pinned dependencies; a canary compares the live checkout address
  with the database.

## Tests

- A unit test for every rule above, fuzz tests on amounts and timestamps, and invariants: settled ≤ amount;
  settled + refunded ≤ received; only `recipient` receives settlement; refunds never take `amount` before
  `settleDeadline`; the executor cannot move funds anywhere except `recipient`.
- Halmos symbolic tests for `settle`, `refund` and `recover`.
- Cross-chain: the same terms give the same address on two Anvil chains, and `settle`/`refund` revert on the wrong one.
- Fork test against Base Sepolia with the real USDC contract; a mock token for USDT behaviour.
