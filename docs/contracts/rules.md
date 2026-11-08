# Contracts rules

Every rule has a test.

## Status

- Pre-release: redesign freely, keep every test green, update `docs/contracts/` and `docs/diagrams/` in the same PR.
- After the first mainnet deploy, deployed code never changes. A fix is a new factory version; old ones stay for recovery.

## Terms (immutable clone args)

- Only `invoiceId` (256 random bits), `recipient`, `token`, `amount`, `expiresAt`, `settleDeadline`, `intendedChainId`,
  `networkFee`, `platformFee` (v2 on; v1.1 ends at `intendedChainId`).
- No authority or executor in the terms: the API writes them and must not choose who moves money.
- The fees are only amounts (R-226). The contract fixes who gets them: the settler and the refund authority.
- No profile, merchant or project ID: terms are public forever and would link a profile's invoices.
- `predict` and `deploy` never reject terms, so every address a payer saw stays deployable.
- `settle` refuses unsafe terms: amount 0, recipient 0 / receiver / factory / implementation / token, or fees above
  a tenth of `amount` together (`feesWithinCeiling`). That money goes to `refund`.
- Effective deadline = `min(settleDeadline, deployedAt + 30 days)`, so a wrong deadline cannot freeze money.

## Factory

- `refundAuthority`: immutable constructor argument (Safe on mainnet, test EOA on testnets). Losing it means a new
  factory, so the Safe must always be able to rotate its own owners.
- `executor`: stored; only the refund authority changes it. The first executor is part of the factory address: use the
  same one on every chain and keep passing it as `EXECUTOR` to `script/Deploy.s.sol`. On a new chain, call
  `setExecutor` right after deploying.
- `paused`: set by the refund authority; blocks `settle` only, never refunds.
- `recover(token, to, amount)`: refund authority only. Returns tokens or the native coin sent to the factory itself.
  - It moves only the factory's own balance, never a receiver's money.
  - `to` is not 0 or the factory. `paused` does not block it.
- Creates the implementation in its constructor. New invoices always use the newest factory.
- Only the executor or the refund authority may `deploy` (an early deploy would block native USDC top-ups on Arc).
- `deploy` returns an existing receiver and records `deployedAt` and `receiverOf(invoiceId)` (first wins; lookup only,
  never used for money decisions).
- Read-only `status(terms)`, `statusOf(invoiceId)` and receiver `status()` return: receiver, deployed, chain match,
  balance, settled, refundable, settleable, who may settle, effective deadline. Events carry `invoiceId`.
- Deploy only through the CREATE2 deployer `0x4e59b44847b379578588920cA78FbF26c0B4956C`, same bytecode everywhere
  (`foundry.toml` pins solc, EVM version, no metadata hash). Never a nonce-based deploy. A chain without that deployer
  gets its own factory address and no cross-chain recovery.

## Receiver

- `settle()`: intended chain, not paused, not settled, safe terms, balance ≥ `amount`. Executor until the effective
  deadline, then only the refund authority. Pays the recipient `amount` less both fees, and checks its balance rose by
  that. Then pays `networkFee` to the settler, who paid the gas, and `platformFee` to the refund authority.
  - `Settled` carries what the recipient got. `FeesPaid` carries both fees, only when one is above 0.
  - A refund takes no fee: the fees leave only by `settle`.
- `refund(to, amount)`: refund authority, intended chain, `to` not 0 or the receiver. May repeat, never above `refundableAmount`:
  everything once settled or past the deadline; before that only the excess over `amount`.
- `refundable()`: what `refund` allows now. Off the intended chain it is 0: `refund` reverts there, and money leaves
  through `recover`.
- `recover(token, to, amount)`: refund authority. On the intended chain it never sends the invoice token or lowers its
  balance (Arc: native coin and USDC are one balance). The balance read copies at most 32 bytes, so a broken invoice
  token never blocks recovery of others. No gas cap on that read: Tempo's built-in tokens need far more gas.
  `token = address(0)` is the native coin.
- `SafeERC20` for transfers; only allowlisted tokens, never fee-on-transfer ones.
- `nonReentrant` and checks-effects-interactions on `settle`, `refund`, `recover`.
- No `approve`, `isValidSignature`, `fallback`, `receive`, `selfdestruct` or `delegatecall`. External calls only to
  tokens, reads from the factory, and the native-coin destination of `recover`.
- Works only if our factory deployed it (`deployedAt != 0`).
  - On the implementation and outside clones, every function and view reverts.
  - The exceptions are the getters `settled` and `factory`, and the implementation's `recover`.
- The implementation's `recover` returns anything sent to it, for the refund authority only. It is never an invoice's
  receiver, so it holds no invoice money.
- Accepted: a malicious invoice token can block `recover` on the intended chain (needs a compromised API).
  - Examples: one that burns gas, or one whose balance changes during the call.
  - Off the intended chain there is no such check, so recovery still works there.
- Accepted: on Arc `recover(address(0))` can move under 0.000001 USDC unseen.

## Tests

- A unit test per rule; fuzz on amounts and timestamps.
- Invariants:
  - settled ≤ amount; settled + refunded ≤ received;
  - the recipient gets 0 or `amount` less the fees; the fees are paid once, at settlement, and nothing else;
  - refunds never take `amount` before the deadline;
  - the executor moves money only to `recipient`, and to itself only the network fee;
  - the factory returns only its own balance.
- Halmos for `settle` (with any fees too), `refund`, and receiver, implementation and factory `recover` (`forge clean` first).
- Cross-chain: same terms, same address on two Anvil chains; calls revert on the wrong one.
- Fork test on Base Sepolia with real USDC; a mock token for USDT behaviour.
