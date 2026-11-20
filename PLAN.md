# Roadmap

This file owns future scope and release gates. [PROJECT](docs/PROJECT.md) owns requirements and decisions;
harness `status` owns progress. A phase is complete only when its gate has evidence.
No phase grants permission to spend, publish, deploy or accept other people's money.
This plan is not complete. When work shows a missing feature or a better solution, suggest it to the owner with the
reason; it joins the plan once the owner agrees.

| Phase | Outcome | Gate |
|---|---|---|
| 1–2 | Done: product definition, workspace, checks and task workflow | A fresh checkout installs, builds, tests and serves the web app |
| 3 | Done: design tokens, shared components, private `/kit`, responsive landing | R-1…R-13 checks |
| 4 | Done: integration risks resolved with testnet spikes | Q-7 answered, Base USDC contract verified, spike results recorded |
| 5 | Done: receiver contracts and authority operations | Unit, fork, fuzz, invariant and symbolic checks; no open high/medium findings; same factory and matching real receiver on four testnets |
| 6 | Done: Go API, watcher, ledger and signer | R-14…R-24; local create → pay → confirmed → settled twice with one invoice and matching ledger |
| 7 | Done: login, app shell and profile wallets | Sign in, create freelancer profile, switch profiles and see the correct wallet |
| 8 | Done: first payment through the UI on Base USDC, then Arbitrum, Arc and Tempo | Sasha's Base Sepolia run; then enable other planned pairs individually |
| 9 | Done: payment exceptions, cancel and notifications | On Anvil: partial → top-up → paid; expired partial → held; late → held; cancel → later deposit held; each email sent once |
| 10 | Done: freelancer work | One freelancer runs quote → accepted → deposit → milestone → final invoice paid on testnet; the final invoice shows the earlier payments and the records export matches the chain |
| 11 | Done: merchant stores, developer tools, history log and support returns of held money; 11.8 onboarding is open | Sample merchant uses SDK, pays and verifies an invoice.settled webhook; on Anvil, held money of each kind goes back through support |
| 12 | Done: fresh sign-in, settings and send; open: account recovery and handles | Send works on a fork |
| 13 | Security review and personal mainnet trials | Full testnet exception suite, then 20 tiny personal mainnet invoices with zero reconciliation difference |

## Open from phases 1–10

Phases 1–10 are done; their requirements are PROJECT R-1…R-122 and their records are in `docs/archive/`. Still open:

- S-7 RPC spike before any paid RPC plan: log ranges, rate limits, finality tags and polling cost.
  - Paid usage needs approval.
- Owner track, no code: interviews and a free USPTO, EUIPO and WIPO search in finance and software classes.
  - Also social handles, app-store names and a spoken spelling test with 5 people.
  - Results feed D-55, D-58 and Q-12. Questions: [owner research](docs/owner-research.md).

## Phase 11: open work

Sections 11.1–11.7, 11.9.1–11.9.3, 11.9.5, 11.10.1–11.10.5 and 11.11 shipped; PROJECT holds their rules.

- 11.8 Merchant onboarding (D-64, D-112):
  - Business name and website, first store, branding preview and team invites.
  - Developer steps: test key, allowed origin, webhook, test event and quickstart. The developer choice shows them first.
  - A KYB status row with a reason and a next step.
  - Build it last, after every other phase 11 feature and its checks.
- 11.9.4 Publish `@forwend/js`, `@forwend/react` and `forwend` (D-103) from CI with provenance, once the owner approves.
  - `forwend` 0.2.1 and the browser packages' 0.1.1 are on npm, published from a local machine without provenance.
  - The browser packages stay `0.x` until the message protocol is stable.
  - `.github/workflows/publish.yml` publishes one package, started by hand from main. Before its first run the owner:
    - Makes the repository public: npm makes provenance only from a public repository.
    - Creates the `npm` environment with required reviewers and main-only deployments.
    - Stores `NPM_TOKEN` only as that environment's secret. Until then no run can publish.
- 11.10 Open stuck-money gaps:
  - The Safe exists at its address on every enabled chain, and on chains payers often mistake for them.
  - Back up the invoice terms and test a restore: an undeployed receiver can't move money without them.
  - Check that the Safe and its fee token work on Tempo, which has no native gas coin.
- Before outside merchants: Q-11. The Privy key-quorum spike comes first; D-61 holds for the first outside merchants.

## Phase 12: account recovery and handles

Sections 12.1, 12.2a and 12.3 shipped: fresh sign-in, account and profile settings, and send.

- 12.2 Security settings: login methods; an email and a passkey before the first money action (recovery); a recovery
  explainer.
  - Settings already lists, adds and removes passkeys, and sets up two-step methods (R-219).
- 12.4 Handles (D-67) and saved contacts; new addresses are confirmed.

## Phase 13: release safety

- 13.1 Q-6 key storage, stop-signing switch, unusual-signing alerts and ledger/chain reconciliation.
- 13.2 Drill signer crash, RPC outage, reorg and webhook outage. Run exact, partial, overpaid, expired, late and
  refund cases on every enabled testnet; reconcile all to zero difference.
- 13.3 Review system trust boundaries and the full money path; independent external contract audit before other
  people's money.
- 13.4 Only with explicit approval: Sasha-only $1–$5 mainnet trials, 20 invoices across exception cases.
- 13.5 Before outside users: jurisdiction, KYC/KYB policy (Q-12), terms, privacy, trademark filing (D-70) and merchant wallet control (Q-11).
  - The terms say held money under 0.10 USD is not returned, and unclaimed held money stays held (D-90).
  - Check which unclaimed-property rules apply where the company is registered (Q-2) before deciding on old held money.
- 13.6 Anvil browser test in CI: create → pay → settled → receipt PDF 200 (409 before paid) (R-52).
  - It is part of the QA pass once the MVP works end to end.
  - Until then the owner tests this path by hand, and backend-e2e covers the money loop.

## Deferred beyond MVP

Out of the MVP, by the owner's choice:

- Bank withdrawal, after Q-2 and Q-5. One provider adapter comes first.
  - It checks country, currency, rail and account-holder name, and needs the verified tier (D-64).
  - A quote shows the stablecoin debit, expected fiat, rate, every fee and its expiry, and is confirmed once.
  - States: quoted, awaiting approval, processing, sent, paid, rejected and returned.
  - Hold and review states: category, what is needed, case ID, last change, and next update or "no date yet".
- Paying from a connected wallet, as a second path beside the address and QR code.
  - Until then payers send a transfer (D-37).
- Agent payments, such as x402. No merchant has asked for them yet.
- Card and wallet payments: the payer uses a card, Apple Pay or Google Pay.
  - The payer needs no crypto knowledge; the merchant still receives stablecoins.
  - It needs an on-ramp or card acquirer that settles in stablecoins; pick one after Q-2, with a spike first.
  - Consumer on-ramps forbid buying for another person's address, and card payments bring chargebacks back.
  - Local research notes: `docs/research/phase-10-freelancers.md#card-payers-paying-by-card-receiving-stablecoins`.
- A payment link's own return link: off by default, the store's return link, or a custom one.
  - The second choice needs an optional store return link, on one of the store's allowed origins.
- Self-serve returns of held money, replacing support by hand (11.10):
  - a Return to sender button on the pay page, with the exchange warning;
  - a form for exchange and app payers with a destination and proof;
  - a wrong-network lookup by transaction hash;
  - status emails to the payer;
  - a private support console in place of `cmd/ops`, with roles and an audit log.
- A better fee model, planned with the business model (D-56, Q-10).
  - Every option carries its invoice's highest network fee (D-122).
  - A payer on a cheaper network, such as Arc or Tempo, pays more than its gas; the extra goes to the settler.
- Faster "paid": rethink the confirmation rule (D-45) after the MVP is done.
  - A deposit is paid only at the chain's `finalized` block; on Base that is about 15 minutes.
  - Option 1: "paid" at the `safe` block on L2s, once the block's data is posted to Ethereum.
  - Option 2: a fixed number of confirmations per chain, perhaps fewer for small amounts.
  - Either way the settle still waits for `finalized`, so a reorg can't move the merchant's money.
  - Decide with measured times per chain, then change D-45, money-safety.md and the tests together.

Mobile; optional BNB and non-EVM networks; HD-wallet receive methods; cross-chain sends; automatic wallet billing;
full accounting page and Koinly export; opt-in escrow; public developer sandbox; custom checkout domains; external
payout address (D-62); file delivery storage (D-66); invoice and tax rules for countries beyond the EU, the UK and the
US (D-83); our own email provider in place of Resend (the client email cap, R-116, stays).
Also later: an underpayment tolerance (needs a receiver that settles a minimum amount); merchant refunds of paid
invoices, such as a customer who did not like the product; credit notes; a draft invoice state.
Each new chain or receive method needs its own spike.
