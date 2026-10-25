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
| 10 | Done: freelancer work | One freelancer runs quote → accepted → deposit → milestone → final invoice paid on testnet; the final invoice shows the earlier payments and the records export matches the chain |
| 11 | Merchant stores, developer tools, history log and refunds of held money | Sample merchant uses SDK, pays and verifies an invoice.settled webhook; on Anvil overpay → claim → refund and expired partial → claim → refund |
| 12 | Account security, send, handles and bank withdrawal | Send works on a fork; withdrawal works in provider sandbox |
| 13 | Security review and personal mainnet trials | Full testnet exception suite, then 20 tiny personal mainnet invoices with zero reconciliation difference |

## Open from phases 1–10

Phases 1–10 are done; their requirements are PROJECT R-1…R-122 and their records are in `docs/archive/`. Still open:

- Q-1: the owner reviews the visual direction on `/kit/directions`.
- Before ignoring tiny deposits, define a dust threshold; they stay refundable.
- S-7 RPC spike (log ranges, rate limits, finality tags, polling cost of the independent confirmation provider) before
  any paid RPC plan; approval before paid usage.
- Owner track, no code: interviews, a free USPTO, EUIPO and WIPO search in finance and software classes, social
  handles and app-store names, a spoken spelling test with 5 people. Results feed D-55, D-58 and Q-12. Questions:
  [owner research](docs/owner-research.md).

## Phase 11: merchants, developers, history log and refunds of held money

Merchants after freelancers (D-55). Scope and evidence: [phase 11 research](docs/research/phase-11-merchants.md)
(owner decisions 2026-10-22). Merchants lose most when a payment company holds or locks their money. Forwend pays the
merchant's own wallet, so the phase builds merchant and developer tools around that. Payers pay only by address and QR
code; a wallet connects only to claim a refund (D-37).

- 11.1 Stores: project ID, logo, color, default checkout expiry and allowed origins (return links and embeds); each
  invoice records its store; per-invoice override (D-30). A profile turns chains and tokens on or off, and a store can
  narrow that (D-75).
- 11.2 Team: email invites (single use, hashed, bound to the invited email); Admin, Developer and Finance roles with
  assigned stores; permissions in one map in code, and a test fails when a route has none; the last Admin cannot
  leave. Roles also decide which History rows a member reads (11.11). Only the owner moves money (D-61). After 11.1.
- 11.3 Payment links `/l/<slug>` per store or freelancer, fixed or open amount (the owner's min and max, D-94). Opening the
  link creates nothing; Pay creates the invoice, and the same browser reuses its open one (D-54). Its number comes at
  the first deposit (D-50). Optional end date and use cap; rate limited; can be turned off; the owner sees visits and
  paid counts. After 11.1.
- 11.4 Test mode and secret API keys (D-87). Test mode runs on the testnets, live mode on mainnets; test mode reads
  chains through public RPCs, and a developer can add their own. Keys `fw_test_…` and `fw_live_…` with a checksum:
  shown once, hashed, scoped to a store, no scope moves money, rolled with an overlap, last use shown. Creating one
  needs a fresh sign-in (D-63). After 12.1; build 12.1 first. Test mode's marks are R-143. Before the first mainnet,
  a payer-chooses invoice takes options of one mode only, so its `livemode` never changes.
- 11.5 Webhooks: Standard Webhooks signatures (D-42) with a separate signing secret, retries over days, replay,
  delivery log, "send test event" and secret rotation; the task picks the design from the research. Events:
  `invoice.detected`, `invoice.partially_paid`, `invoice.paid`, `invoice.settled`, `invoice.expired`,
  `invoice.canceled`, `invoice.held` (with its reason), `refund.completed`. After 11.11.1.
- 11.6 Public API v1 (idempotent create, get, list, events), OpenAPI, generated Node SDK, webhook verification
  helper; create takes `returnUrl`, `reference` and `metadata`. A create with `dueDate` and no `expiresIn` closes the
  checkout 60 days after the due date, as the form does (D-80), with a retry-stable idempotency hash. Developer docs
  with a changelog and a status page; breaking changes get 90 days' notice (D-91). After 11.4, 11.5.
- 11.7 Merchant ops: attention list (exceptions, held money with its reason, refund claims waiting, failed webhooks),
  store filter, and a CSV with store, invoice, chain, transaction hash, settlement and USD value.
- 11.8 Merchant onboarding: business name and website, first store, branding preview, team invites, developer steps
  (test key, allowed origin, webhook, test event, quickstart) and a KYB status row with a reason and a next step
  (D-64); the developer choice shows the developer steps first. After 11.1.
- 11.9 Checkout for merchant sites in three levels (D-88), `apps/example-merchant` and the quickstart. Review keys,
  scopes and webhook verification before the gate.
  - 11.9.1 Pay button: a link to `/pay/<token>` or `/l/<slug>` with a return link (`{INVOICE_ID}`) and the store's
    branding (D-32). Works on any site without a package. After 11.6.
  - 11.9.2 Embedded checkout: `/embed/<token>` on the Forwend origin, as the full pay page or as a payment element
    (`layout=full|element`). Only the store's allowed origins may frame it; events go by `postMessage` to that one
    origin as UI hints (D-29). After 11.1, 11.9.1.
  - 11.9.3 `@forwend/js` and `@forwend/react` (`PayButton`, `Checkout`, `PaymentElement`): no remote script; a theme
    and a few variables mapped to the design tokens and checked for contrast; React 18 and 19. After 11.9.2.
  - 11.9.4 Publish both packages: npm org (owner approval), CI publish with provenance, `0.x` until the message
    protocol is stable, a changelog file, size and type checks. After 11.9.3.
  - 11.9.5 `apps/example-merchant` uses the button and the components and verifies the webhook, with a browser test:
    merchant code cannot read the frame, a forged message never marks an order paid, a strict CSP works, and an
    origin off the list is blocked. After 11.9.3.
- 11.10 Refunds of held money (D-78). A refund goes ahead whatever the merchant profile's status (D-89). Forwend pays
  the network fee, and the minimum refund is 1 USD (D-90). After 11.11.1.
  - 11.10.1 Overpaid handling: the pay page and the owner's invoice page show money sent above the amount (held for
    the payer, D-26) with its next step and a way to return it. Until then neither page shows an overpaid line.
    After 11.10.
  - 11.10.2 Refund claims on `/pay`: the payer presses Claim refund, then connects the wallet that sent the money and
    signs a claim naming the invoice and the destination (D-37); plain and smart-contract wallets are both checked.
    Exchange deposits give a destination and support evidence instead (Q-9). From an embed the claim opens the hosted
    page in a new tab. `refund_claims` with states the payer sees; claim updates reach the payer receipt email (D-68).
    After 11.10.
  - 11.10.3 Refund tool: an ops command (`cmd/ops`) lists claims, approves or rejects them with a reason
    (D-60) and prints the `refund(to, amount)` call for the refund-authority Safe; one refund of everything held by
    default (D-57). The watcher books the refund. No new hot key. A refund shows in the invoice's Transactions list on
    the owner page, beside the payments and the settlement (R-69). After 11.10.2.
  - 11.10.4 Wrong-network help: the payer gives the tx hash, the API finds it on an enabled chain and
    opens a recovery claim; `recover()` works only where our factory exists, and recovery is never promised (D-33).
    After 11.10.2.
  - 11.10.5 Refund suite on Anvil: overpay → claim → refund; expired partial → claim → refund; late → claim → refund;
    a smart-wallet claim; the ledger matches the chain after each. After 11.10.1–11.10.4.
- 11.11 History log and invoice changes (D-92). Build 11.11.1 before 11.5: webhook events and the events endpoint read
  it.
  - 11.11.1 History log: one append-only row per change, written in the same transaction, with the actor and typed
    data; no secrets, IP or user agent. A test fails when a Go writer of invoices writes no row. Invoices, requests,
    checkouts and jobs write to it; old invoices are backfilled; the job Record (R-104) moves onto it later.
  - 11.11.2 History panel on the invoice page, newest first, with filters. Views count first view, last view and a
    total, with no IP. After 11.11.1.
  - 11.11.3 Edits: memo, client email, reminders and return link at any time; reference, note and a due date inside
    the checkout window before payment. The pay page lists the payer's history rows as Updates, an edit as Updated.
    Any other change is a Revise before any deposit: a new invoice with a new number, address and pay link, and the
    old one canceled as "Replaced by". After 11.11.1.
  - 11.11.4 Reopen an expired, partly paid invoice before its settle deadline: same address, and the payer sends the
    rest. The settle grace is 7 days (D-18). After 11.11.1.
- Before outside merchants: Q-11. The Privy key-quorum spike comes first; D-61 holds for the first outside merchants.

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
(D-66); invoice and tax rules for countries beyond the EU, the UK and the US (D-83); our own email provider in place of
Resend (owner request 2026-10-19; the client email cap, R-116, stays).
Also later: an underpayment tolerance (needs a receiver that settles a minimum amount); merchant refunds of paid
invoices, such as a customer who did not like the product; credit notes; a draft invoice state.
Each new chain or receive method needs its own spike. Planned Base/Arbitrum/Arc/Tempo expansion stays gated by D-38.
Card payers (card, Apple Pay or Google Pay in, USDC to the invoice) need a card-acquirer spike first:
the consumer on-ramps forbid buying for another person's address, and card payments bring chargebacks back
([research](docs/research/phase-10-freelancers.md#card-payers-paying-by-card-receiving-stablecoins)).
