# Roadmap

This file owns future scope and release gates. [PROJECT](docs/PROJECT.md) owns requirements and decisions;
harness `status` owns progress. A phase is complete only when its gate has evidence.
No phase grants permission to spend, publish, deploy or accept other people's money.
This plan is not complete. When work shows a missing feature or a better solution, suggest it to the owner with the
reason; it joins the plan once the owner agrees.

| Phase | Outcome | Gate |
|---|---|---|
| 1–2 | Product definition, workspace, checks and task workflow | A fresh checkout installs, builds, tests and serves the web app |
| 3 | Design tokens, shared components, private `/kit`, responsive landing | R-1…R-13 checks; owner reviews the visual direction; real waitlist before public launch |
| 4 | Resolve integration risks with testnet spikes | Q-7 answered, Base USDC contract verified, spike results recorded |
| 5 | Receiver contracts and authority operations | Unit, fork, fuzz, invariant and symbolic checks; no open high/medium findings; same factory and matching real receiver on four testnets |
| 6 | Go API, watcher, ledger and signer | R-14…R-24; local create → pay → confirmed → settled twice with one invoice and matching ledger |
| 7 | Login, app shell and profile wallets | Sign in, create freelancer profile, switch profiles and see the correct wallet |
| 8 | First payment through the UI on Base USDC: invoice numbers, pay page, PDFs, personal requests, first-run onboarding | Sasha's Base Sepolia run; then enable other planned pairs individually |
| 9 | Payment exceptions, refunds and notifications | On Anvil: partial → top-up → paid; overpay → claim → refund; expired partial → refund; late → held |
| 10 | Freelancer work | One freelancer runs deposit → delivery → acceptance → final invoice paid on testnet |
| 11 | Merchant stores and developer tools | Sample merchant uses SDK, pays and verifies an invoice.settled webhook |
| 12 | Account security, send, handles and bank withdrawal | Send works on a fork; withdrawal works in provider sandbox |
| 13 | Security review and personal mainnet trials | Full testnet exception suite, then 20 tiny personal mainnet invoices with zero reconciliation difference |

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

Existing measurements: [S-1…S-3](docs/spikes/s1-s3-privy.md), [S-4](docs/spikes/s4-chains.md), [S-5/S-6](docs/spikes/s5-s6-testnets.md).

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
- Authorization tests across profiles. Sessions and re-authentication for money actions move to phase 12 (12.1).

## Phase 8: first payment

Base Sepolia + USDC. Requirements: R-42…R-52. From here on, one numbered bullet is one PR and "After" names the
bullets it needs.

- 8.1 Invoice fields: per-profile number `INV-0001` (D-50), title, note, due date (separate from checkout expiry),
  client name, email and address copied into the invoice; `GET /v1/profiles/{id}/invoices` with cursor pages;
  settlement tx hash on the invoice.
- 8.2 Profile billing details (name, address, country, optional tax ID, contact email): GET/PUT; a copy goes into
  each invoice at creation. After 8.1.
- 8.3 Dashboard Invoices: create form, list, detail with status timeline, share link and copy. Replaces the "Soon"
  item. After 8.1.
- 8.4 Public `/pay/<id>`, no payer signup: issuer name, invoice number, amount, token, network and the host domain.
  The browser recomputes the receive address from the terms; the payer confirms the network before copying.
  Separate wallet and exchange tabs. Live detected → confirming → paid → settled with blocks or time left (R-28).
  A short refund rule and a scam note before sending. No third-party scripts. After 8.1.
- 8.6 PDFs: `invoice.pdf` and `receipt.pdf` (D-51), issuer and client blocks from the invoice's copies. After 8.2.
- 8.7 Public receipt on `/pay/<id>` after settlement: tx hashes, times, PDF links; the dashboard detail links to
  both PDFs. After 8.3, 8.4, 8.6.
- 8.8 Personal "Request money": amount, note, expiry; link only (D-52). After 8.3, 8.4.
- 8.9 First-run "What do you want to do?" screen and checklists for personal and freelancer profiles, computed
  from data; passkey link step (D-53). After 8.2, 8.3.
- 8.10 Independent canary per [money safety](docs/backend/money-safety.md). After 8.4.
- 8.12 Review the complete money path, then Sasha's Base Sepolia run. This is the gate. After all of the above.
- 8.13–8.15 Enable Arbitrum Sepolia, Arc and Tempo: one PR each, each after its own run. After 8.12.
- Owner track, in parallel, no code: 5–10 interviews; register forwend.com; free USPTO, EUIPO and WIPO search in
  finance and software classes; check social handles and app-store names; spoken spelling test with 5 people.
  Results feed D-55, D-58 and Q-12. Interview questions:
  1. Your last three cross-border client payments: who chose the method, which currency and route, which arrived?
  2. USDC or USDT received for client work in the last 90 days: which network, exchange or wallet, and your net
     amount after conversion and bank fees?
  3. The last time an exchange or accountant asked where a payment came from, what did you show?
  4. When did a client refuse or struggle to pay in crypto, and what did you use instead?
  5. What do you pay today for invoicing, stablecoin receipt and cash-out? Would you pick free with a visible 1% fee,
     a monthly plan, or your current method?

## Phase 9: payment exceptions, refunds and notifications

- 9.1 Pay page and dashboard states for partial (remainder and deadline), expired, expired partial and late, each
  with its next step. After 8.4. Overpaid waits for 11.10.1.
- 9.2 Warnings for wrong chain, bridged USDC.e and address poisoning (compare the first and last 6 characters).
  Wrong-network help requires a tx hash (D-33).
- 9.3 Payer claims on `/pay`: evidence per Q-9 (wallet signature for self-custody, otherwise a destination and
  support evidence); `refund_claims` with states. After 9.1.
- 9.4 Refund tool: an ops command (`cmd/ops`) lists claims, approves or rejects them with a reason (D-60) and prints
  the `refund(to, amount)` call for the refund-authority Safe; one refund of everything held by default (D-57).
  The watcher books the refund. No new hot key. After 9.3.
- 9.5 Cancel an unpaid invoice: settlement stops; later deposits stay held (D-26).
- 9.6 Email notifications through a provider adapter and the outbox (D-65, Q-13): paid, settled, exception, claim
  opened and resolved; per-profile on/off. The in-app bell also shows invoice events. After 8.1.
- 9.7 Payer receipt email: an optional email field on `/pay`, kept per invoice for the receipt and claim updates
  only (D-68). After 9.6.
- 9.8 Exception suite on Anvil (the gate). After 9.1–9.7.

## Phase 10: freelancer work

Freelancer before merchant (D-55). Phase 9 comes first for both, so phases 10 and 11 can swap without rework.

- 10.1 Saved clients (name, email, company, address, tax ID); an invoice picks a client and copies it.
- 10.2 Line items, duplicate invoice, and an "Agreed value" in fiat that the user types (currency, amount and the
  time; no exchange-rate API). After 10.1.
- 10.3 Recurring retainers (D-58): a schedule (day of month, end date); each cycle the worker creates a new invoice
  and emails the client, who pays by hand. After 9.6.
- 10.4 Jobs: a job groups invoices; deposit and milestone invoices; a quote the client accepts creates the deposit
  invoice. After 10.2.
- 10.5 Shared work page `/w/<token>`: scope (deliverables, deadline, included revisions, how acceptance works);
  work states agreed, in progress, delivered, changes requested and approved stay separate from payment states;
  an append-only log of client acceptance and change requests (typed name, email, time). Delivery is links only
  (D-66). After 10.4.
- 10.6 Action list: overdue, exceptions, waiting for approval, money available. After 9.1.
- 10.7 Reminders only after the client opts in (D-69); at most 3, before and after the due date. After 9.6.
- 10.8 Records: transfers between your own profiles are labeled "own transfer"; a deposit without an invoice stays
  "Unclassified" until the user labels it; CSV export with a classification column.

## Phase 11: merchants and developers

- 11.1 Stores: project ID, logo, color, default checkout expiry; each invoice records its store; per-invoice
  override (D-30).
- 11.2 Team: email invites; Admin, Developer and Finance roles with assigned stores; a 403 test on every route; the
  last Admin cannot leave. Only the owner moves money (D-61). After 11.1.
- 11.3 Payment links `/l/<slug>` per store or freelancer, fixed or open amount: each visit creates its own invoice
  and goes to `/pay/<id>` (D-54); rate limited; can be turned off. After 11.1.
- 11.4 Secret API keys: shown once, hashed, scoped to a store, revocable; creating one needs a fresh sign-in (D-63).
  After 12.1; build 12.1 first.
- 11.5 Webhooks: Standard Webhooks signatures (D-42) with a separate signing secret, backoff, replay, delivery log,
  "send test event". Events: `invoice.detected`, `invoice.confirmed`, `invoice.paid`, `invoice.settled`,
  `invoice.partially_paid`, `invoice.expired`, `invoice.overpaid`, `refund.completed`.
- 11.6 Public API v1 (idempotent create, get, list, events), OpenAPI, generated Node SDK, webhook verification
  helper. After 11.4, 11.5.
- 11.7 Merchant ops: attention list (exceptions, claims, failed webhooks), store filter, CSV. After 9.1.
- 11.8 Merchant onboarding: business name and website, first store, branding preview, team invites, developer steps
  (API key, webhook, test event, quickstart) and a KYB status row (D-64); the developer choice shows the developer
  steps first. After 11.1.
- 11.9 `apps/example-merchant`, quickstart and brandable checkout components. Review keys, scopes and webhook
  verification before the gate.
  - 11.9.1 Decide hosted or embedded checkout for merchant sites (a PROJECT decision row): the payer must always
    see the receive address and amount as Forwend shows them, never as merchant code renders them.
  - 11.9.2 Pay button: a link or popup to `/pay/<id>` with a return URL and the store's branding (D-32). Works on
    any site without a package. After 11.6.
  - 11.9.3 If 11.9.1 picks embedded: a `@forwend/react` package (`PayButton`, `Checkout`) that renders the pay page
    in an iframe from the Forwend origin, like Stripe Elements, so the merchant page cannot change it. Theme props
    map to design tokens; events (`paid`, `settled`, `expired`) reach the merchant through `postMessage`, and the
    server confirms them through webhooks. After 11.9.1, 11.6.
  - 11.9.4 Publish the SDK and components: npm scope and account (owner approval), semver, changelog, the browsers
    and React versions supported. After 11.9.3.
  - 11.9.5 `apps/example-merchant` uses the button or component and verifies the webhook, with a browser test.
    After 11.9.2 or 11.9.3.
- 11.10 Pay with a connected wallet on `/pay` and the merchant checkout (lifts D-37's MVP limit): the payer connects
  a wallet and the page sends the exact amount. After phase 10 and 11.1–11.9 (full freelancer and merchant features
  and the developer kit).
  - 11.10.1 Overpaid handling: the pay page and the owner's invoice page show money sent above the amount (held for
    the payer, D-26) with its next step and a way to return it. Until then neither page shows an overpaid line.
    After 11.10.
- Before outside merchants: Q-11.

## Phase 12: account security, send and bank withdrawal

- 12.1 Fresh sign-in for money actions (D-49, D-63): the API `reauth_required` check, the web email-code dialog,
  `sessions_revoked_at` and "Sign out everywhere". Actions built earlier, such as billing details, get the check here.
- 12.2 Security settings: login methods; email and passkey before the first money action (recovery); a recovery
  explainer.
- 12.2a Settings pages: account settings (security from 12.2, passkey sign-in) apart from each profile's settings.
  Freelancer and personal profiles: billing details (now `/app/billing-details`, reached from the checklist) and
  profile name; merchant profiles add stores and team (11.1, 11.2).
- 12.3 Same-chain send to your own profiles and outside addresses. Review recipient, profile, chain, token, debit,
  network fee and amount received; fresh sign-in; Privy client signing with sponsored gas (D-46). After 12.1.
- 12.4 Handles (D-67) and saved contacts; new addresses are confirmed. After 12.3.
- 12.5 Bank withdrawal after Q-2/Q-5: one provider adapter; check country, currency, rail and account-holder name;
  verified tier required (D-64); a quote with stablecoin debit, expected fiat, rate, every fee and expiry, confirmed
  once; states quoted, awaiting approval, processing, sent, paid, rejected, returned.
- 12.6 Hold and review states: category, what is needed, case ID, last change, next update or "no date yet".

## Phase 13: release safety

- 13.1 Q-6 key storage, stop-signing switch, unusual-signing alerts and ledger/chain reconciliation.
- 13.2 Drill signer crash, RPC outage, reorg and webhook outage. Run exact, partial, overpaid, expired, late and
  refund cases on every enabled testnet; reconcile all to zero difference.
- 13.3 Review system trust boundaries and the full money path; independent external contract audit before other
  people's money.
- 13.4 Only with explicit approval: Base mainnet deployment and Sasha-only $1–$5 trials; 20 invoices across
  exception cases.
- 13.5 Before outside users: jurisdiction, KYC/KYB policy (Q-12), terms, privacy, trademark filing (D-70), real
  waitlist (D-8) and merchant wallet control (Q-11).
- 13.6 Anvil browser test in CI: create → pay → settled → receipt PDF 200 (409 before paid) (R-52). Part of the QA
  pass once the MVP works end to end; until then the owner tests this path by hand and backend-e2e covers the money loop.

## Deferred beyond MVP

Mobile; optional BNB and non-EVM networks; HD-wallet receive methods; cross-chain sends; automatic wallet billing;
full accounting page and Koinly export; opt-in escrow; bank/card on-ramp; public developer sandbox; custom checkout
domains; platform fees and the business model (D-56, Q-10); external payout address (D-62); file delivery storage
(D-66). Each new chain or receive method needs its own spike. Planned Base/Arbitrum/Arc/Tempo expansion stays gated
by D-38.
