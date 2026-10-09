# Roadmap

This file owns future scope and release gates. [PROJECT](docs/PROJECT.md) owns requirements and decisions;
harness `status` owns progress. A phase is complete only when its gate has evidence.
No phase grants permission to spend, publish, deploy or accept other people's money.

| Phase | Outcome | Gate |
|---|---|---|
| 1–2 | Product definition, workspace, checks and task workflow | A fresh checkout installs, builds, tests and serves the web app |
| 3 | Design tokens, shared components, private `/kit`, responsive landing | R-1…R-13 checks; owner reviews the visual direction; real waitlist before public launch |
| 4 | Resolve integration risks with testnet spikes | Q-7 answered, Base USDC contract verified, spike results recorded |
| 5 | Receiver contracts and authority operations | Unit, fork, fuzz, invariant and symbolic checks; no open high/medium findings; same factory and matching real receiver on four testnets |
| 6 | Go API, watcher, ledger and signer | R-14…R-24; local create → pay → confirmed → settled twice with one invoice and matching ledger |
| 7 | Login, app shell and profile wallets | Sign in, create freelancer profile, switch profiles and see the correct wallet |
| 8 | First payment through the UI on Base USDC | Local Anvil browser test in CI and Sasha's Base Sepolia run; then enable other planned pairs individually |
| 9 | Freelancer work and payment exceptions | Partial → top-up → paid; overpay → claim → refund; expired partial → refund; late → held |
| 10 | Merchant stores and developer tools | Sample merchant uses SDK, pays and verifies an invoice.settled webhook |
| 11 | Send and bank withdrawal | Send works on a fork; withdrawal works in provider sandbox |
| 12 | Security review and personal mainnet trials | Full testnet exception suite, then 20 tiny personal mainnet invoices with zero reconciliation difference |

## Phase 3: design and landing

Code and tests are defined by R-1…R-13. Visual rules: [DESIGN](docs/web/DESIGN.md).
Compare the three existing direction pages for Q-1. Keep the landing honest and the kit private.
Before publishing, replace the mock waitlist with real storage. No fake customer or funding claims.

## Phase 4: integration spikes

Write measured results and source links in `docs/spikes/`. Local forks, testnets and provider sandboxes only.

| Spike | Measure | Failure decision |
|---|---|---|
| S-1 Privy Go | Access-token checks, wallet create/lookup, authorization policies | Wrap an unsupported endpoint in internal/privy; keep Go |
| S-2 Profile wallets | Several wallets for one user; user approval for sends | Revisit wallet provider/model with owner; do not silently combine profile balances |
| S-3 Gas sponsorship | Sponsored USDC send on Base Sepolia and expected cost | Evaluate paymaster (D-43) |
| S-4 Chains | go-ethereum blocks, receipts, token logs, fee/transaction types, safe/finalized tags on all four testnets | Raw RPC or another adapter for unsupported types; establish Q-7 before enabling |
| S-5 Deterministic deployment | Deployer and Safe support; matching factory and real receiver addresses across chains | Separate factory and no cross-chain recovery; never nonce-based fallback (D-40) |
| S-6 Tokens | Exact USDC/USDT contracts, decimals and behavior per chain; mocks for unavailable test tokens | Leave unverified pairs disabled |
| S-7 RPC | Infura/public endpoints and independent confirmation provider: log ranges, rate limits, finality tags, polling cost | Choose another verified provider; approval before paid usage |

Existing deployment measurements: [S-5/S-6](docs/spikes/s5-s6-testnets.md).

## Phase 5: contracts

Implementation rules and tests: [contracts/rules](docs/contracts/rules.md).
Authority and deployment requirements: [contracts/operations](docs/contracts/operations.md).
Verify nonstandard token behavior, decimal arithmetic and recovery on each enabled chain.
Run static analysis (including Slither), independent review, stateful fuzzing and symbolic tests;
record unresolved findings. Measure clone-deploy + settle gas. Do not infer phase completion from deployed addresses.

## Phase 6: backend

[Backend architecture](docs/backend/architecture.md), [API contract](docs/backend/api.md) and
[money safety](docs/backend/money-safety.md) own the implementation rules. R-14…R-24 define the current tasks.
Additional gate requirements: Anvil in local compose, sqlc generation, append-only ledger, outbox workers using
`SKIP LOCKED`, signer nonce reconciliation after a crash, low executor-gas alerts, structured logs and an error
reporting hook disabled locally. Define a dust threshold before ignoring tiny deposits; they remain refundable.
The signer checks the recipient against Privy and never receives authority to send from user wallets.
Create `apps/backend/api/openapi.yaml` with the first business endpoint; generate the Go types and
`packages/api-client` TypeScript client. These are planned paths, not existing infrastructure.

## Phase 7: app shell

- Privy email, Google and passkey login; personal profile and wallet on signup.
- Sidebar, top bar, profile/theme switchers; create profile and its wallet.
- Per-token/per-chain balance, clearly marked estimated total, pending and held amounts separately.
- Receive address + QR + exact network/token warning; activity and empty states.
- Sessions/devices and re-authentication for money actions; authorization tests across profiles.

## Phase 8: first payment

- Dashboard invoice: amount, due date, separate checkout expiry, note.
- `/pay/<invoice>`: no payer signup; name, invoice number, amount, network, gas note, address and QR.
  Confirm network before copying; separate wallet and exchange instructions; live detected/confirming/paid/settled status.
- Checkout address verification and independent canary follow the money-safety doc; no third-party scripts.
- Recipient wallet receives settlement; activity shows transaction hash; shareable receipt and PDF invoice/receipt.
- Review the complete money path. Add Arbitrum Sepolia, Arc and Tempo only after the Base slice passes.

## Phase 9: freelancer and exceptions

- Saved clients, templates, line items; due date differs from checkout expiry. Deposit/milestone invoices link to a job.
- Shared work/payment page: work states agreed/in progress/delivered/changes requested/approved stay separate from money states.
  Delivery files require access control; forwarding a page link must not expose private files.
- Action list: overdue, exceptions, funds available. Email reminders require client consent.
- Show partial remainder/deadline, excess held, expired partials and late deposits. Claims need Q-9 evidence,
  platform approval and separate multisig execution. Several payers may have separate approved claims (D-27).
- Warn about wrong chains, bridged USDC.e and address poisoning. Wrong-network support requires a transaction hash.
- Cancelling an unpaid invoice stops backend settlement; later deposits remain held.

## Phase 10: merchants and developers

- Merchant stores: project IDs, branding and default checkout expiry; per-invoice override.
- Admin across stores; Developer/Finance scoped to assigned stores. Reject other merchants' project IDs.
- Secret API keys: shown once, hashed, scoped and revocable. Webhook signing secrets are separate.
- Standard Webhooks signatures, backoff, replay and delivery logs. Events: `invoice.detected`, `invoice.confirmed`,
  `invoice.paid`, `invoice.settled`, `invoice.partially_paid`, `invoice.expired`, `invoice.overpaid`, `refund.completed`.
- API v1: idempotent create, get/list invoices, list events. Generated Node SDK plus webhook verification helper.
- Brandable checkout components, developer quickstart and docs. Put the sample merchant in `apps/example-merchant`.
- Review keys, scopes and webhook verification before the gate.

## Phase 11: send and bank withdrawal

- Same-chain sends to own profiles, registered profiles or outside addresses. Saved contacts; confirm new addresses.
- Review recipient, profile, chain, token, debit, fee and received amount; re-authenticate; show gas requirements.
- Resolve Q-2/Q-5: provider coverage, fees, quote API, KYC responsibilities and wallet/treasury funding model.
- One provider adapter. Precheck country, currency, rail and account-holder name.
- Quote: stablecoin debit, fiat expected, exchange rate, every fee and expiry; user confirms once.
- States: quoted, awaiting approval, processing, sent, paid, rejected, returned. Required identity checks precede funds.

## Phase 12: release safety

- Review system trust boundaries and the full money path; independent external contract audit before others' funds.
- Q-6 key storage, stop-signing switch, unusual-signing alerts and ledger/chain reconciliation.
- Drill signer crash, RPC outage, reorg and webhook outage. Run exact, partial, overpaid, expired, late and refund cases
  on every enabled testnet before mainnet. Reconcile all to zero difference.
- Only with explicit approval: Base mainnet deployment and Sasha-only $1–$5 trials; 20 invoices across exception cases.
- Before outside users: jurisdiction, KYC/KYB, terms, privacy and other launch requirements resolved.

## Deferred beyond MVP

Mobile; optional BNB and non-EVM networks; HD-wallet receive methods; cross-chain sends; recurring invoices/billing;
accounting/CSV/Koinly export; opt-in escrow; bank/card on-ramp; public developer sandbox; custom checkout domains.
Each new chain or receive method needs its own spike. Planned Base/Arbitrum/Arc/Tempo expansion stays gated by D-38.
