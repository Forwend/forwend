# Roadmap

This file owns future scope and release gates. [PROJECT](docs/PROJECT.md) owns requirements and decisions;
harness `status` owns progress. A phase is complete only when its gate has evidence.
No phase grants permission to spend, publish, deploy or accept other people's money.
This plan is not complete. When work shows a missing feature or a better solution, suggest it to the owner with the
reason; it joins the plan once the owner agrees.

| Phase | Outcome | Gate |
|---|---|---|
| 1–2 | Done: product definition, workspace, checks and task workflow | A fresh checkout installs, builds, tests and serves the web app |
| 3 | Done: design tokens, shared components, private `/kit`, responsive landing | R-1…R-13 checks; Q-1 review still open; real waitlist before launch (13.5) |
| 4 | Done: integration risks resolved with testnet spikes | Q-7 answered, Base USDC contract verified, spike results recorded |
| 5 | Done: receiver contracts and authority operations | Unit, fork, fuzz, invariant and symbolic checks; no open high/medium findings; same factory and matching real receiver on four testnets |
| 6 | Done: Go API, watcher, ledger and signer | R-14…R-24; local create → pay → confirmed → settled twice with one invoice and matching ledger |
| 7 | Done: login, app shell and profile wallets | Sign in, create freelancer profile, switch profiles and see the correct wallet |
| 8 | Done: first payment through the UI on Base USDC, then Arbitrum, Arc and Tempo | Sasha's Base Sepolia run; then enable other planned pairs individually |
| 9 | Done: payment exceptions, cancel and notifications | On Anvil: partial → top-up → paid; expired partial → held; late → held; cancel → later deposit held; each email sent once |
| 10 | Freelancer work | One freelancer runs deposit → delivery → acceptance → final invoice paid on testnet |
| 11 | Merchant stores, developer tools, connected wallet and refunds | Sample merchant uses SDK, pays and verifies an invoice.settled webhook; on Anvil overpay → claim → refund and expired partial → claim → refund |
| 12 | Account security, send, handles and bank withdrawal | Send works on a fork; withdrawal works in provider sandbox |
| 13 | Security review and personal mainnet trials | Full testnet exception suite, then 20 tiny personal mainnet invoices with zero reconciliation difference |

## Open from phases 1–9

Phases 1–9 are done; their requirements are PROJECT R-1…R-85 and their records are in `docs/archive/`. Still open:

- Q-1: the owner reviews the visual direction on `/kit/directions`.
- Before ignoring tiny deposits, define a dust threshold; they stay refundable.
- S-7 RPC spike (log ranges, rate limits, finality tags, polling cost of the independent confirmation provider) before
  any paid RPC plan; approval before paid usage.
- Owner track, no code: interviews, a free USPTO, EUIPO and WIPO search in finance and software classes, social
  handles and app-store names, a spoken spelling test with 5 people. Results feed D-55, D-58 and Q-12. Questions:
  [owner research](docs/owner-research.md).

## Phase 10: freelancer work

Freelancer before merchant (D-55). Phase 9 comes first for both, so phases 10 and 11 can swap without rework.

- 10.1 Saved clients (name, email, company, address, tax ID); an invoice picks a client and copies it.
- 10.2 Line items, duplicate invoice, and an "Agreed value" in fiat that the user types (currency, amount and the
  time; no exchange-rate API). After 10.1.
- 10.3 Recurring retainers (D-58): a schedule (day of month, end date); each cycle the worker creates a new invoice
  and emails the client, who pays by hand.
- 10.4 Jobs: a job groups invoices; deposit and milestone invoices; a quote the client accepts creates the deposit
  invoice. After 10.2.
- 10.5 Shared work page `/w/<token>`: scope (deliverables, deadline, included revisions, how acceptance works);
  work states agreed, in progress, delivered, changes requested and approved stay separate from payment states;
  an append-only log of client acceptance and change requests (typed name, email, time). Delivery is links only
  (D-66). After 10.4.
- 10.6 Action list: overdue, exceptions, waiting for approval, money available.
- 10.7 Reminders only after the client opts in (D-69); at most 3, before and after the due date.
- 10.8 Records: transfers between your own profiles are labeled "own transfer"; a deposit without an invoice stays
  "Unclassified" until the user labels it; CSV export with a classification column.

## Phase 11: merchants, developers, connected wallet and refunds

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
- 11.7 Merchant ops: attention list (exceptions, claims, failed webhooks), store filter, CSV.
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
  - 11.10.2 Refund claims on `/pay`: the payer connects the wallet that sent the money and signs a claim
    naming the invoice and the destination; exchange deposits give a destination and support evidence instead (Q-9);
    `refund_claims` with states; claim updates reach the payer receipt email (D-68). After 11.10.
  - 11.10.3 Refund tool: an ops command (`cmd/ops`) lists claims, approves or rejects them with a reason
    (D-60) and prints the `refund(to, amount)` call for the refund-authority Safe; one refund of everything held by
    default (D-57). The watcher books the refund. No new hot key. A refund shows in the invoice's Transactions list on
    the owner page, beside the payments and the settlement (R-69). After 11.10.2.
  - 11.10.4 Wrong-network help: the payer gives the tx hash, the API finds it on an enabled chain and
    opens a recovery claim; `recover()` works only where our factory exists, and recovery is never promised (D-33).
    After 11.10.2.
  - 11.10.5 Refund suite on Anvil: overpay → claim → refund; expired partial → claim → refund; late → claim → refund;
    the ledger matches the chain after each. After 11.10.1–11.10.4.
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
