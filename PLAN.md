# Roadmap

What is left before Forwend takes other people's money, and what comes after.

- [PROJECT](docs/PROJECT.md) holds requirements and decisions. `python3 scripts/harness.py status` shows the task queue.
- Nothing here grants permission to spend, publish, deploy or take other people's money.
- When work shows a missing feature or a better way, suggest it to the owner with the reason.
  - It joins the plan once the owner agrees.

## Open work

### Merchants

- Merchant onboarding (D-64, D-112). Build it after the other items in this section.
  - Business name and website, first store, branding preview and team invites.
  - Developer steps: test key, allowed origin, webhook, test event and quickstart.
  - Choosing the developer path shows those steps first.
  - A KYB status row with a reason and a next step.
- Team control of a merchant wallet (Q-11). Try Privy key quorums first.
  - Until it is decided, only the owner moves money (D-61), also for the first outside merchants.
- Publish the npm packages from CI with provenance (D-103), once the owner approves.
  - `forwend` 0.2.1, `@forwend/js` 0.1.1 and `@forwend/react` 0.1.1 are on npm, published by hand without provenance.
  - The browser packages stay `0.x` until their message protocol is stable.
  - `.github/workflows/publish.yml` publishes one package when started by hand from main.
  - Before its first run, the owner creates the `npm` environment with required reviewers and main-only deploys.
  - `NPM_TOKEN` lives only in that environment's secrets. Until then no run can publish.

### Stuck money

- Deploy the Safe at its address on every enabled chain, and on chains payers often confuse with them.
- Back up the invoice terms and test a restore. An undeployed receiver can't move money without its terms.
- Check that the Safe and its fee token work on Tempo, which has no native gas coin.

### Accounts

- Account recovery: an email and a passkey before the first money action, with a short explainer.
  - Settings already lists, adds and removes passkeys, and sets up two-step methods (R-219).
- Handles (D-67) and saved contacts. A new address is confirmed before sending.

### Research

- Before any paid RPC plan, measure log ranges, rate limits, finality tags and polling cost.
  - Paid usage needs approval.
- Owner track, no code: interviews, and free USPTO, EUIPO and WIPO searches in finance and software classes.
  - Also social handles, app-store names and a spoken spelling test with 5 people.
  - The results feed D-55, D-58 and Q-12. The questions are in [owner research](docs/owner-research.md).

## Release safety (phase 13)

Gate: the full exception suite passes on every enabled testnet.
Then 20 tiny mainnet invoices of the owner's reconcile with zero difference.

- Signer key storage (Q-6), a stop-signing switch, alerts on unusual signing, and ledger-to-chain reconciliation.
- Drills: signer crash, RPC outage, reorg and webhook outage.
- Exact, partial, overpaid, expired, late and refund cases on every enabled testnet, all reconciled to zero difference.
- A review of the trust boundaries and the whole money path.
- An independent contract audit before other people's money.
- The owner's own mainnet trials: 20 invoices of $1–$5 across the exception cases, only with explicit approval.
- An Anvil browser test in CI: create, pay, settle, then the receipt PDF returns 200, and 409 before paid (R-52).
  - Until then the owner tests this path by hand, and backend-e2e covers the money loop.
- Before outside users: jurisdiction, KYC and KYB policy (Q-12), terms, privacy, trademark filing (D-70).
  - Merchant wallet control (Q-11) is also needed.
  - The terms say held money under 0.10 USD is not returned, and unclaimed held money stays held (D-90).
  - Before deciding on old held money, check the unclaimed-property rules where the company is registered (Q-2).

## Deferred beyond MVP

The owner chose to leave these out of the MVP.

- Bank withdrawal, after Q-2 and Q-5, starting with one provider.
  - It checks country, currency, rail and account-holder name, and needs the verified tier (D-64).
  - A quote shows the stablecoin debit, expected fiat, rate, every fee and its expiry. The user confirms it once.
  - States: quoted, awaiting approval, processing, sent, paid, rejected and returned.
  - A held withdrawal shows its reason, what is needed, a case ID, the last change and the next update.
- Agent payments with x402: an AI agent pays for an API or content per request.
  - The public roadmap lists them next.
- Card and wallet payments: the payer uses a card, Apple Pay or Google Pay, and the merchant still gets stablecoins.
  - It needs an on-ramp or card acquirer that settles in stablecoins. Pick one after Q-2, with a test integration first.
  - Consumer on-ramps forbid buying for another person's address, and cards bring chargebacks back.
- Paying from a connected wallet, beside the address and QR code. Until then payers send a transfer (D-37).
- A payment link's own return link: off by default, the store's return link, or a custom one.
  - The store option needs an optional store return link on one of the store's allowed origins.
- Self-serve returns of held money, in place of returns through support:
  - a Return to sender button on the pay page, with the exchange warning;
  - a form for exchange and app payers, with a destination and proof;
  - a lookup by transaction hash for money sent on the wrong network;
  - status emails to the payer;
  - a private support console with roles and an audit log, in place of `cmd/ops`.
- A better fee model, decided with the business model (Q-10).
  - Today every option carries its invoice's highest network fee (D-122).
  - So a payer on a cheaper network, such as Arc or Tempo, pays more than its gas. The extra goes to the settler.
- Faster "paid": rethink the confirmation rule (D-45).
  - Today a deposit counts as paid only at the chain's `finalized` block. On Base that takes about 15 minutes.
  - Option 1: paid at the `safe` block on L2s, once the block's data is posted to Ethereum.
  - Option 2: a fixed number of confirmations per chain, maybe fewer for small amounts.
  - Either way the settle still waits for `finalized`, so a reorg can't move the merchant's money.
  - Decide with measured times per chain. Then change D-45, money-safety.md and the tests together.

Later ideas:

- A mobile app.
- BNB and non-EVM networks, HD-wallet receive methods, and cross-chain sends.
- Automatic wallet billing, a full accounting page and Koinly export.
- Opt-in escrow, a public developer sandbox and custom checkout domains.
- An external payout address (D-62) and file delivery storage (D-66).
- Invoice and tax rules beyond the EU, the UK and the US (D-83).
- Our own email provider in place of Resend. The client email cap stays (R-116).
- An underpayment tolerance, which needs a receiver that settles a minimum amount.
- Merchant refunds of paid invoices, credit notes and a draft invoice state.
- Each new chain or receive method gets its own test integration first.
