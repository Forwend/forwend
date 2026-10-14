# Architecture

How Forwend works as a system: the parts, who holds which key, and how money moves. It names concepts and
boundaries, not folders; each area's own doc has the detail. Roadmap: [PLAN.md](../PLAN.md). Money rules:
[money safety](backend/money-safety.md).
Requirements and decisions: [PROJECT.md](PROJECT.md).

## Parts

| Part | What it does | Holds keys? | Detail |
|---|---|---|---|
| Web app (Next.js) | Landing, dashboard, hosted checkout, private `/kit` | No | [web](web/architecture.md) |
| API | Signed-in users create invoices and read state; payers read checkout state | No | [backend](backend/architecture.md) |
| Worker | Watches chains, keeps the append-only ledger, runs the invoice state machine; webhooks come in PLAN 11.5 | No | [backend](backend/architecture.md) |
| Signer | Turns typed intents ("settle invoice X") into transactions with the executor key | Executor key | [backend](backend/architecture.md) |
| Postgres | Profiles, invoices, chain transfers, ledger, intents | No | [backend](backend/architecture.md) |
| Invoice receiver contracts | One receiver per invoice at an address known in advance; can only pay the invoice amount to its recipient or return money through the refund authority | No | [contracts](contracts/architecture.md) |
| Refund-authority Safe | Multisig. Refunds, recoveries and late settles wait 24–48 h; pause and executor change are immediate | Owner hardware keys | [contracts operations](contracts/operations.md) |
| Privy | Login and one wallet per profile; the profile wallet is the invoice recipient | User wallets (Privy) | PROJECT D-21 |
| RPC providers | Read chains (Infura first, public RPCs as fallback); a second provider confirms balances | No | PROJECT D-15 |

## Trust boundaries

- The API never holds a private key. A hacked API can write wrong invoice terms, but it cannot move money already in
  a receiver: the receiver only pays its fixed recipient, or returns money through the Safe.
- The signer has no public routes and no user sessions. It re-reads the ledger and the chain before signing, and the
  executor key can only settle to the recipient written in the terms. A leaked executor key is replaced by the Safe.
- Refunds and recoveries never go through the signer: an approved claim becomes a proposed Safe transaction that
  owners sign, then waits in the delay so an honest owner can cancel it.
- The receive address is computed locally from the factory address and init-code hash compiled into the backend,
  never read from the database or an RPC, and recomputed on the checkout page.
- "Paid" comes only from `balanceOf` of the allowlisted token on an address the backend computed itself, confirmed by
  a second RPC. Logs from any other contract are ignored.

Diagram: [who can move money](diagrams/security-keys.json).

## Money flow

1. A creator makes an invoice. The API writes immutable terms (random 256-bit `invoiceId`, recipient = the profile
   wallet, token, amount, expiry, settle deadline, chain) and computes the receive address. Nothing is deployed.
   When the payer chooses, each accepted token and network gets such terms and an address of its own; the first one
   paid becomes the invoice's, and money sent to another is held for the payer.
2. The payer sends an ordinary token transfer to that address, from a wallet or an exchange.
3. The worker sees the transfer, waits for the confirm rule, and moves the invoice through detected → partially paid
   or paid. Deposits after expiry are late and held.
4. For a paid invoice the signer deploys the receiver (if needed) and calls `settle`: exactly the invoice amount goes
   to the profile wallet. Any excess stays held in the receiver.
5. Held money (excess, late, expired partial) goes back to the payer through a verified claim and a delayed Safe
   refund (claims come in PLAN 11.10; until then the Safe returns it by hand). Policy, not a contract rule: before the deadline the executor could still settle it to the recipient.

Diagrams: [full contract workflow](diagrams/contracts-workflow.json), [invoice states](diagrams/invoice-lifecycle.json).
Open one with `npx mapgrain@0.2.5 studio <file>.json`.
