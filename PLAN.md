# Roadmap

This file owns future scope and release gates. [PROJECT](docs/PROJECT.md) owns requirements and decisions;
harness `status` owns progress. A phase is complete only when its gate has evidence.
No phase grants permission to spend, publish, deploy or accept other people's money.
This plan is not complete. When work shows a missing feature or a better solution, suggest it to the owner with the
reason; it joins the plan once the owner agrees.

| Phase | Outcome | Gate |
|---|---|---|
| 1–2 | Done: product definition, workspace, checks and task workflow | A fresh checkout installs, builds, tests and serves the web app |
| 3 | Done: design tokens, shared components, private `/kit`, responsive landing | R-1…R-13 checks; Q-1 review still open |
| 4 | Done: integration risks resolved with testnet spikes | Q-7 answered, Base USDC contract verified, spike results recorded |
| 5 | Done: receiver contracts and authority operations | Unit, fork, fuzz, invariant and symbolic checks; no open high/medium findings; same factory and matching real receiver on four testnets |
| 6 | Done: Go API, watcher, ledger and signer | R-14…R-24; local create → pay → confirmed → settled twice with one invoice and matching ledger |
| 7 | Done: login, app shell and profile wallets | Sign in, create freelancer profile, switch profiles and see the correct wallet |
| 8 | Done: first payment through the UI on Base USDC, then Arbitrum, Arc and Tempo | Sasha's Base Sepolia run; then enable other planned pairs individually |
| 9 | Done: payment exceptions, cancel and notifications | On Anvil: partial → top-up → paid; expired partial → held; late → held; cancel → later deposit held; each email sent once |
| 10 | Done: freelancer work | One freelancer runs quote → accepted → deposit → milestone → final invoice paid on testnet; the final invoice shows the earlier payments and the records export matches the chain |
| 11 | Done: merchant stores, developer tools, history log and refunds of held money; only 11.8 onboarding (F332) is still open | Sample merchant uses SDK, pays and verifies an invoice.settled webhook; on Anvil overpay → claim → refund and expired partial → claim → refund |
| 12 | Account security, send and handles | Send works on a fork |
| 13 | Security review and personal mainnet trials | Full testnet exception suite, then 20 tiny personal mainnet invoices with zero reconciliation difference |

## Open from phases 1–10

Phases 1–10 are done; their requirements are PROJECT R-1…R-122 and their records are in `docs/archive/`. Still open:

- Q-1: the owner reviews the visual direction on `/kit/directions`.
- S-7 RPC spike (log ranges, rate limits, finality tags, polling cost of the independent confirmation provider) before
  any paid RPC plan; approval before paid usage.
- Owner track, no code: interviews, a free USPTO, EUIPO and WIPO search in finance and software classes, social
  handles and app-store names, a spoken spelling test with 5 people. Results feed D-55, D-58 and Q-12. Questions:
  [owner research](docs/owner-research.md).

## Phase 11: merchants, developers, history log and refunds of held money

Merchants after freelancers (D-55). Scope and evidence: local phase 11 research notes (`docs/research/phase-11-merchants.md`)
(owner decisions 2026-10-22). Merchants lose most when a payment company holds or locks their money. Forwend pays the
merchant's own wallet, so the phase builds merchant and developer tools around that. Payers pay only by address and QR
code, and never connect a wallet (D-37).

- 11.1 Stores: project ID, logo, color, default checkout expiry and allowed origins (return links and embeds); each
  invoice records its store; per-invoice override (D-30). A profile turns chains and tokens on or off, and a store can
  narrow that (D-75).
- 11.2 Team: email invites (single use, hashed, bound to the invited email); Admin, Developer and Finance roles with
  assigned stores; permissions in one map in code, and a test fails when a route has none; the last Admin cannot
  leave. Roles also decide which History rows a member reads (11.11). Only the owner moves money (D-61). After 11.1.
- 11.3 Payment links `/l/<slug>` per store or freelancer, fixed or open amount (the owner's min and max, D-94). After 11.1.
  - Opening the link creates nothing; Pay starts an independent checkout without an invoice number or document (D-54, D-107).
  - Refresh and Back preserve the current attempt; Start another purchase creates a new one (R-142).
  - Optional end date and use cap; rate limited; can be turned off; the owner sees visits, paid purchases and reserved slots.
- 11.4 Test mode and secret API keys (D-87). Test mode runs on the testnets, live mode on mainnets; test mode reads
  chains through public RPCs, and a developer can add their own. Keys `fw_test_…` and `fw_live_…` with a checksum:
  shown once, hashed, scoped to a store, no scope moves money, rolled with an overlap, last use shown. Creating one
  needs a fresh sign-in (D-63). After 12.1; build 12.1 first. Test mode's marks are R-143. Before the first mainnet,
  a payer-chooses invoice takes options of one mode only, so its `livemode` never changes, and a key reaches only
  its own mode's invoices (R-144).
- 11.5 Webhooks: Standard Webhooks signatures (D-42) with a separate signing secret, retries over days, replay,
  delivery log, "send test event" and secret rotation; the task picks the design from the research. Events:
  `invoice.detected`, `invoice.partially_paid`, `invoice.paid`, `invoice.settled`, `invoice.expired`,
  `invoice.canceled`, `invoice.held` (with its reason), `invoice.open` (after a reorg), `invoice.reopened`,
  `refund.completed`. After 11.11.1.
- 11.6 Public API v1 (idempotent create, get, list, events), OpenAPI, a hand-written Node package (D-103), webhook verification
  helper; create takes `returnUrl`, `reference` and `metadata`. A create with `dueDate` and no `expiresIn` closes the
  checkout 60 days after the due date, as the form does (D-80), with a retry-stable idempotency hash. Developer docs
  with a changelog and a status page; breaking changes get 90 days' notice (D-91). After 11.4, 11.5.
### Merchant workflow correction order

- Research: F325 documents current behavior and primary evidence in local `docs/research/merchant-payment-workflows.md`.
- The durable model is [merchant payments](docs/merchant-payments.md), PROJECT R-160–R-170 and D-106–D-112.
- Correct foundations before building 11.7–11.9 screens; existing section scope remains below.
- F326: explicit invoice, checkout and personal-request purposes; preserve issued documents and legacy API behavior.
- F327: store-scoped checkout-session API, order correlation and Node SDK operations.
- F328: independent reusable-link purchases, original-request replay, capacity reservations and immutable store attribution.
- F329: actual receiver refund observation, balanced accounting and chain/token-exact settlement attribution.
- F330: merchant payment, attention and reconciliation APIs with store filtering and exact CSV exports.
- F331: Payments and link-result screens, customer invoice workflow, coherent navigation and explicit configuration failures.
- F333: hosted integration and secure full/element embedded checkout.
- F334: minimal JavaScript/React packages and verified release artifacts.
- F335: merchant example, fulfillment/delivery recovery, end-to-end reconciliation and complete integration documentation.
- F332: merchant onboarding last, using actual setup state and D-64's not_required KYB status.
- F326–F331 execute in order, followed by F333–F335; checkout integration does not wait for onboarding.
- F332 depends on F335 and remains blocked until all other phase 11 work is complete, including 11.10 refunds and 11.11 history.
- F329 also supplies the financial evidence required by 11.7.
- Returns through support, Safe execution and wrong-network recovery follow 11.10.
- New package publication, deployments and provider accounts require separate approval.
- Detailed local task rationale lives in `docs/research/merchant-payment-tasks.md`; the tracked task queue owns progress.

### Remaining phase 11 deliverables

- 11.7 Merchant ops: attention list (exceptions, held money with its reason, returns in progress, failed webhooks),
  store filter, and a CSV with store, invoice, chain, transaction hash, settlement and USD value.
- 11.8 Merchant onboarding: business name and website, first store, branding preview, team invites, developer steps
  (test key, allowed origin, webhook, test event, quickstart) and a KYB status row with a reason and a next step
  (D-64); the developer choice shows the developer steps first.
  - Build onboarding last, after all other phase 11 features and their checks, including checkout integration, held-money refunds and history.
- 11.9 Checkout for merchant sites in three levels (D-88), `apps/example-merchant` and the quickstart. Review keys,
  scopes and webhook verification before the gate.
  - 11.9.1 Pay button: a link to `/pay/<token>` or `/l/<slug>` with a return link (`{INVOICE_ID}`) and the store's
    branding (D-32). Works on any site without a package. After 11.6.
  - 11.9.2 Embedded checkout: `/embed/<token>` on the Forwend origin, as the full pay page or as a payment element
    (`layout=full|element`). Only the store's allowed origins may frame it; events go by `postMessage` to that one
    origin as UI hints (D-29). After 11.1, 11.9.1.
  - 11.9.3 `@forwend/js` and `@forwend/react` (`PayButton`, `Checkout`, `PaymentElement`): no remote script; a theme
    and a few variables mapped to the design tokens and checked for contrast; React 18 and 19. After 11.9.2.
  - 11.9.4 Publish `@forwend/js`, `@forwend/react` and `forwend` (D-103) once the owner approves, from the npm org.
    `forwend` 0.1.0 is published on npm under MIT. `@forwend/js` and `@forwend/react` 0.1.0 followed on 2026-10-31. CI publishes with provenance. The browser packages stay `0.x` until the message protocol is stable. Each package
    has a changelog file, size and type checks. After 11.9.3.
    - The 0.1.0 releases were published from a local machine, so they have no provenance.
    - `forwend` 0.2.0 and the browser packages' 0.1.1 followed on 2026-11-08, also from a local machine.
    - npm held each upload until the owner approved it on npmjs.com (`npm stage`).
    - `.github/workflows/publish.yml` publishes one package, started by hand from main. Before its first run the owner:
      - Makes the repository public: npm makes provenance only from a public repository.
      - Creates the `npm` environment with required reviewers and main-only deployments.
      - Stores `NPM_TOKEN` only as that environment's secret. Until then no run can publish.
  - 11.9.5 `apps/example-merchant` uses the button and the components and verifies the webhook, with a browser test:
    merchant code cannot read the frame, a forged message never marks an order paid, a strict CSP works, and an
    origin off the list is blocked. After 11.9.3.
- 11.10 Returns of held money through support (D-26, D-78, D-118). Nothing is promised.
  - A return goes ahead whatever the merchant profile's status (D-89).
  - Forwend pays the network fee, and the minimum return is 0.10 USD (D-90).
  - The payer emails support with the pay link and the transaction link. An operator checks the case.
  - The refund-authority Safe sends the money to the address it came from.
  - A payer who paid from an exchange or an app gives an address of theirs and proof that they sent it.
  - 11.10.1 Pay page (F408): each held payment gets one short line with How to get it back, which opens Need help.
    - Need help explains each case and opens an email to support with the pay link filled in.
  - 11.10.2 Owner side (F409): the payment page and the held email give the reason and say the payer gets it back
    through Forwend support.
  - 11.10.3 Support tool (F410): `cmd/ops` on the server, with no UI. `case` takes a pay link, receive address or
    transaction hash; `return` queues one; `release` drops one that won't be sent.
    - It shows each held payment: sender, reason, amount and the date it can go back.
    - One return is queued per invoice option at a time, so the same money is never sent twice.
    - It checks the transfer is final and reached this receiver, and caps the amount at what is both held and
      refundable.
    - It refuses a zero, receiver, token or factory destination, and flags a contract.
    - It dry-runs the call as the Safe, which catches a blocklisted address or a paused token.
    - It sets `refund_pending`, then prints the Safe batch: the receiver's deploy when needed, then `refund`.
    - `Process` keeps `refund_pending` while money is held. Reopen refuses it, the watcher keeps watching it and the
      attention list shows it.
    - The watcher books the return, and it shows in the invoice's Transactions list (R-69).
  - 11.10.4 Wrong token and wrong network (F411): the same tool prints `recover` for another token on the invoice's
    chain.
    - On another chain it works only where our factory and Safe exist at their addresses.
    - Elsewhere support says the money can't be returned now.
  - 11.10.5 Anvil suite (F412): overpaid, late, expired partial, canceled and wrong-token money each go through the
    tool and the Safe call. The ledger matches the chain after each.
  - Before the first mainnet, close the stuck-money gaps found on 2026-10-31:
    - The Safe exists at its address on every enabled chain, and on chains payers often mistake for them.
    - Back up the invoice terms and test a restore: an undeployed receiver can't move money without them.
    - Check that the Safe and its fee token work on Tempo, which has no native gas coin.
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

## Phase 12: account security, send and handles

- 12.1 Fresh sign-in for money actions (D-49, D-63): the API `reauth_required` check, the in-place passkey or email-code
  confirm (R-137), `sessions_revoked_at` and "Sign out everywhere". Money actions built later get the check then.
- 12.2 Security settings: login methods; email and passkey before the first money action (recovery); a recovery
  explainer.
- 12.2a Settings pages: account settings (security from 12.2, passkey sign-in) apart from each profile's settings.
  Freelancer and personal profiles: billing details (now `/app/billing-details`, reached from the checklist) and
  profile name; merchant profiles add stores and team (11.1, 11.2).
  - Each profile has a Developer mode toggle in its settings (D-120, F438).
  - Off is live mode on mainnets with real money; on is test mode on the testnets.
  - Until F438 ships, staging uses testnets only.
- 12.3 Same-chain send to your own profiles and outside addresses. Review recipient, profile, chain, token, debit,
  network fee and amount received; fresh sign-in; Privy client signing with sponsored gas (D-46). After 12.1.
- 12.4 Handles (D-67) and saved contacts; new addresses are confirmed. After 12.3.

## Phase 13: release safety

- 13.1 Q-6 key storage, stop-signing switch, unusual-signing alerts and ledger/chain reconciliation.
- 13.2 Drill signer crash, RPC outage, reorg and webhook outage. Run exact, partial, overpaid, expired, late and
  refund cases on every enabled testnet; reconcile all to zero difference.
- 13.3 Review system trust boundaries and the full money path; independent external contract audit before other
  people's money.
- 13.4 Only with explicit approval: Base mainnet deployment and Sasha-only $1–$5 trials; 20 invoices across
  exception cases.
- 13.5 Before outside users: jurisdiction, KYC/KYB policy (Q-12), terms, privacy, trademark filing (D-70) and merchant wallet control (Q-11).
  - The terms say held money under 0.10 USD is not returned, and unclaimed held money stays held (D-90).
  - Check which unclaimed-property rules apply where the company is registered (Q-2) before deciding on old held money.
- 13.6 Anvil browser test in CI: create → pay → settled → receipt PDF 200 (409 before paid) (R-52). Part of the QA
  pass once the MVP works end to end; until then the owner tests this path by hand and backend-e2e covers the money loop.

## Deferred beyond MVP

The owner moved these out of the MVP on 2026-10-31:

- Bank withdrawal, formerly 12.5, after Q-2 and Q-5. One provider adapter comes first.
  - It checks country, currency, rail and account-holder name, and needs the verified tier (D-64).
  - A quote shows the stablecoin debit, expected fiat, rate, every fee and its expiry, and is confirmed once.
  - States: quoted, awaiting approval, processing, sent, paid, rejected and returned.
  - Hold and review states, formerly 12.6: category, what is needed, case ID, last change, and next update or
    "no date yet".
- Paying from a connected wallet, as a second path beside the address and QR code.
  - Until then payers send a transfer (D-37).
- Agent payments, such as x402. No merchant has asked for them yet.
- Card and wallet payments (owner request 2026-11-02): the payer uses a card, Apple Pay or Google Pay.
  - The payer needs no crypto knowledge; the merchant still receives stablecoins.
  - It needs an on-ramp or card acquirer that settles in stablecoins; pick one after Q-2.
- A payment link's own return link: off by default, the store's return link, or a custom one.
  - The second choice needs an optional store return link, on one of the store's allowed origins.
- Self-serve returns of held money, replacing support by hand (11.10):
  - a Return to sender button on the pay page, with the exchange warning;
  - a form for exchange and app payers with a destination and proof;
  - a wrong-network lookup by transaction hash;
  - status emails to the payer;
  - a private support console in place of `cmd/ops`, with roles and an audit log.
- A better fee model (owner request 2026-11-09), planned with the business model (D-56, Q-10).
  - Today every option carries its invoice's highest network fee (D-122).
  - A payer on a cheaper network, such as Arc or Tempo, pays more than its gas; the extra goes to the settler.
- Code refactoring (owner request 2026-11-09): make the code cleaner and easier to scale.
  - Each refactor keeps behavior and public contracts, as the workflow's refactor rule asks.
- Faster "paid" (owner request 2026-11-10): rethink the confirmation rule (D-45) after the MVP is done.
  - Today a deposit is paid only at the chain's `finalized` block; on Base that is about 15 minutes.
  - Option 1: "paid" at the `safe` block on L2s, once the block's data is posted to Ethereum.
  - Option 2: a fixed number of confirmations per chain, perhaps fewer for small amounts.
  - Either way the settle still waits for `finalized`, so a reorg can't move the merchant's money.
  - Decide with measured times per chain, then change D-45, money-safety.md and the tests together.

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
(local research notes (`docs/research/phase-10-freelancers.md#card-payers-paying-by-card-receiving-stablecoins`)).
