# Contracts rules

Every rule has a test. Source: the 2026-10-09 design review and audit (findings fixed in F039, F041).

## Status

- Pre-release: redesign freely, keep every test green, update `docs/contracts/` and `docs/diagrams/` in the same PR.
- After the first mainnet deploy, deployed code never changes. A fix is a new factory version; old ones stay for recovery.

## Terms (immutable clone args)

- Only `invoiceId` (256 random bits), `recipient`, `token`, `amount`, `expiresAt`, `settleDeadline`, `intendedChainId`.
- No authority, executor or fee in the terms: the API writes them and must not choose who moves money.
- No profile, merchant or project ID: terms are public forever and would link a profile's invoices.
- `predict` and `deploy` never reject terms, so every address a payer saw stays deployable.
- `settle` refuses unsafe terms: amount 0, or recipient 0 / receiver / factory / implementation / token. That money
  goes to `refund`.
- Effective deadline = `min(settleDeadline, deployedAt + 30 days)`, so a wrong deadline cannot freeze money.

## Factory

- `refundAuthority`: immutable constructor argument (Safe on mainnet, test EOA on testnets). Losing it means a new
  factory, so the Safe must always be able to rotate its own owners.
- `executor`: stored; only the refund authority changes it. The first executor is part of the factory address: use the
  same one on every chain and keep passing it as `EXECUTOR` to `script/Deploy.s.sol`. On a new chain, call
  `setExecutor` right after deploying.
- `paused`: set by the refund authority; blocks `settle` only, never refunds.
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
  deadline, then only the refund authority. Pays exactly `amount` and checks the recipient's balance rose by `amount`.
- `refund(to, amount)`: refund authority, intended chain, `to` not 0 or the receiver. May repeat, never above `refundableAmount`:
  everything once settled or past the deadline; before that only the excess over `amount`.
- `recover(token, to, amount)`: refund authority. On the intended chain it never sends the invoice token or lowers its
  balance (Arc: native coin and USDC are one balance). The balance read copies at most 32 bytes, so a broken invoice
  token never blocks recovery of others. No gas cap on that read: Tempo's built-in tokens need far more gas.
  `token = address(0)` is the native coin.
- `SafeERC20` for transfers; only allowlisted tokens, never fee-on-transfer ones.
- `nonReentrant` and checks-effects-interactions on `settle`, `refund`, `recover`.
- No `approve`, `isValidSignature`, `fallback`, `receive`, `selfdestruct` or `delegatecall`. External calls only to the
  token and reads from the factory.
- Works only if our factory deployed it (`deployedAt != 0`): on the implementation and outside clones every function
  and view reverts except the getters `settled` and `factory`.
- Accepted: a gas-burning invoice token can block `recover` (needs a compromised API); on Arc `recover(address(0))` can
  move under 0.000001 USDC unseen.

## Tests

- A unit test per rule; fuzz on amounts and timestamps.
- Invariants: settled ≤ amount; settled + refunded ≤ received; only `recipient` gets settlement; refunds never take
  `amount` before the deadline; the executor moves money only to `recipient`.
- Halmos for `settle`, `refund`, `recover` (`forge clean` first).
- Cross-chain: same terms, same address on two Anvil chains; calls revert on the wrong one.
- Fork test on Base Sepolia with real USDC; a mock token for USDT behaviour.
