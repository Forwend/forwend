# Forwend

Get paid in stablecoins, and see every step of each payment.

Forwend sends invoices, runs checkouts and holds balances in USDC.
Each payment lands in its own contract, is confirmed on chain and then settles to your wallet.
Payers can also pay with almost any token from another chain, through NEAR Intents.

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![npm: forwend](https://img.shields.io/npm/v/forwend?label=forwend)](https://www.npmjs.com/package/forwend)
[![npm: @forwend/js](https://img.shields.io/npm/v/@forwend/js?label=%40forwend%2Fjs)](https://www.npmjs.com/package/@forwend/js)
[![npm: @forwend/react](https://img.shields.io/npm/v/@forwend/react?label=%40forwend%2Freact)](https://www.npmjs.com/package/@forwend/react)

> Forwend is under active development. Test mode runs on testnets.
> Live mode runs on mainnets as a development deployment, not for other people's money,
> until a security review and an independent contract audit.

## What it does

- **Invoices.** Send an invoice with a pay link, a PDF and reminders. The client pays from any wallet or exchange.
- **Checkout.** Take payments in a store, at a counter with a QR code, or from your own site through the packages.
- **Balances.** See what is in your wallet, what is on its way and what is held, per token and network.
- **Send.** Move money between your profiles or to a wallet on the same network, after a fresh sign-in check.
- **Teams and developers.** Roles for a merchant's team, API keys, webhooks and a public API.

Forwend accepts USDC on Base, Arbitrum and Arc, and stablecoins on Tempo.
Each profile chooses its own tokens and networks.

## How a payment works

1. Forwend creates an invoice. Its receive address is a contract that exists only for that invoice.
2. The payer sends the exact amount to that address. The address is known before the contract is deployed.
3. The worker watches the chain. "Paid" comes only from the token balance at that address, once it is final.
4. The signer settles the payment: the contract can only pay its fixed recipient, your profile wallet.
5. Money that arrives late, twice or short is held. It goes back only through the refund authority, a multisig with a time delay at launch.

The API holds no keys, and the signer has no public routes.
Read [the architecture](docs/architecture.md) and [the money safety rules](docs/backend/money-safety.md) for the details.

## Cross-chain payments with NEAR Intents

A payer can pay a live invoice with a token on another chain, such as USDT on Tron or SOL on Solana.
It works in live mode only: NEAR Intents has no testnet.
[NEAR Intents](https://docs.near-intents.org) converts it, and USDC arrives on Base.

1. The payer picks a chain and a token, and gives a refund address on that chain.
2. Forwend asks NEAR Intents 1Click for an exact-output quote. Exactly the amount due must arrive as USDC on Base.
3. The pay page checks the quote's signature before it shows anything. It confirms the quote names the invoice's own Base address, the amount due and the refund address.
4. The page shows a deposit address with a price held for 15 minutes.
5. The payer sends the token. Solvers in the NEAR Intents network convert it and deliver USDC to the invoice's address.
6. Forwend marks the invoice paid from the USDC balance on Base, as for any direct payment.

- The payer pays the conversion cost. You receive the invoice amount, as for a direct payment.
- Extra, short or failed money goes back to the payer's refund address. Forwend holds none of the payer's money in transit.
- The pay page follows each step: received, converting, confirming on Base, and paid.
- Each profile can turn cross-chain payments off in Settings, under Accepted assets.

## NEAR HACKATHON

Forwend is entered in [NEAR HACKATHON](https://nearhackathon.com), in the Real-World Money track.
With NEAR Intents, a client pays a Forwend invoice with almost any token on any chain.
Watch [the live demo on X](https://x.com/0xEnsp1re/status/2120536074787205365).

- The repository started on 8 Oct 2026. The hackathon was announced on 19 Oct 2026.
- Before 19 Oct, Forwend had a first version on testnets: invoices, the pay page, balances, the invoice contracts and the backend.
- Most of the code was written after 19 Oct, during the hackathon.
- Tag `pre-hackathon` marks the last commit before 19 Oct 2026 UTC. Everything up to it is baseline.
- Tag `hackathon-submission` marks the submitted commit.
- [All changes made during the hackathon](https://github.com/Forwend/forwend/compare/pre-hackathon...hackathon-submission).

### Built during the hackathon

NEAR Intents pays only into a live invoice's Base USDC option, because 1Click has no testnet.
So Forwend first had to take real money on mainnet:

| Pull request | What it adds |
|---|---|
| [#298](https://github.com/Forwend/forwend/pull/298) | Each chain is test or live mode, and live invoices stay apart from test ones. |
| [#445](https://github.com/Forwend/forwend/pull/445), [#447](https://github.com/Forwend/forwend/pull/447) | Base, Arbitrum, Arc and Tempo mainnets, and live mode on them. |

Then the NEAR Intents integration landed between 9 and 11 Nov 2026:

| Pull request | What it adds |
|---|---|
| [#457](https://github.com/Forwend/forwend/pull/457) | The API asks 1Click for an exact-output quote and checks its signature. |
| [#458](https://github.com/Forwend/forwend/pull/458) | The worker follows each quote's 1Click status to its end. |
| [#459](https://github.com/Forwend/forwend/pull/459) | The pay page gets a token picker, a checked deposit address and a 15-minute price. |
| [#460](https://github.com/Forwend/forwend/pull/460) | The owner sees how each cross-chain payment was paid, and can turn the option off. |
| [#461](https://github.com/Forwend/forwend/pull/461) | The picker shows each token's minimum and blocks a token that needs more than is due. |
| [#462](https://github.com/Forwend/forwend/pull/462) | The pay box shows what the payer sent, what arrived on Base and any refund. |
| [#464](https://github.com/Forwend/forwend/pull/464), [#465](https://github.com/Forwend/forwend/pull/465), [#472](https://github.com/Forwend/forwend/pull/472) | One rounded amount to send, clear refusals, and no tokens that 1Click can't route. |
| [#468](https://github.com/Forwend/forwend/pull/468) | Audit fixes: a stuck quote frees the invoice, and the page shows the refund fee. |
| [#474](https://github.com/Forwend/forwend/pull/474), [#475](https://github.com/Forwend/forwend/pull/475), [#476](https://github.com/Forwend/forwend/pull/476), [#489](https://github.com/Forwend/forwend/pull/489) | The payment page and pay box show each cross-chain step. |

The code lives in these places:

- [`apps/backend/internal/intents`](apps/backend/internal/intents): the 1Click client, quotes, signature check, tokens and status.
- [`apps/backend/internal/invoice`](apps/backend/internal/invoice): `crosschain.go`, `crosschain_read.go` and `crosschain_track.go`.
- [`apps/web/src/features/pay`](apps/web/src/features/pay): `crosschain-picker.tsx` and `crosschain-pay.tsx`.

The rest of Forwend was built in the same weeks:

- Stores, payment links and team roles for merchants ([#288](https://github.com/Forwend/forwend/pull/288), [#294](https://github.com/Forwend/forwend/pull/294), [#292](https://github.com/Forwend/forwend/pull/292)).
- Checkout sessions and hosted or embedded checkout ([#325](https://github.com/Forwend/forwend/pull/325), [#392](https://github.com/Forwend/forwend/pull/392)).
- The `forwend`, `@forwend/js` and `@forwend/react` packages ([#312](https://github.com/Forwend/forwend/pull/312), [#393](https://github.com/Forwend/forwend/pull/393)).
- API keys and signed webhooks ([#299](https://github.com/Forwend/forwend/pull/299), [#301](https://github.com/Forwend/forwend/pull/301), [#303](https://github.com/Forwend/forwend/pull/303)).
- Send between profiles and to other wallets ([#429](https://github.com/Forwend/forwend/pull/429), [#430](https://github.com/Forwend/forwend/pull/430)).
- Network and platform fees on each invoice option ([#450](https://github.com/Forwend/forwend/pull/450), [#453](https://github.com/Forwend/forwend/pull/453)).

### Try it without money

NEAR Intents has no testnet, so a real cross-chain payment needs mainnet funds.
The browser tests run the pay page against a local stub API that returns signed 1Click quotes.

```sh
pnpm install
pnpm --filter @forwend/web e2e crosschain
```

Playwright builds the web app and pays a live invoice with USDT on Tron, from quote to receipt.
It also covers refunds, short deposits, token minimums and a quote changed after 1Click signed it.
Every test passes.

### Libraries and services

- Web: Next.js, React, Redux Toolkit, Zod, Tailwind CSS, Radix UI and Lucide icons.
- Backend: Go with pgx, goose, go-ethereum, the Privy Go SDK, golang-jwt, gorilla/websocket and fpdf.
- Contracts: Foundry with forge-std and OpenZeppelin Contracts.
- Tests and tooling: Vitest, Playwright, Biome, Turborepo and pnpm.
- Services: the NEAR Intents 1Click API, Privy for sign-in and wallets, Chainlink price feeds and Uniswap v3.

## Packages

| Package | What it is |
|---|---|
| [`forwend`](packages/node) | The API for Node 20 or later: checkout sessions, payments, invoices, stores, webhook events, and `verifyWebhook`. |
| [`@forwend/js`](packages/js) | The checkout in any web page: a pay link, the full checkout, or its pay panel beside your summary. |
| [`@forwend/react`](packages/react) | The same checkout for React 18 and 19: `PayButton`, `Checkout` and `PaymentElement`. |

None of them has runtime dependencies, and none loads a script from Forwend.

```sh
npm install forwend               # on your server
npm install @forwend/react        # or @forwend/js, in your page
```

Your server creates a checkout session and gives its `payToken` to the page.

```ts
import { Forwend, verifyWebhook } from "forwend";

const forwend = new Forwend({
  apiKey: process.env.FORWEND_API_KEY!,
  profileId: process.env.FORWEND_PROFILE_ID!,
  baseUrl: "https://forwend.com/api",
});

const session = await forwend.checkoutSessions.create(
  { storeId, amountUsd: "25.00", reference: "order-1042" },
  { idempotencyKey: "order-1042" },
);
// Redirect to session.payment.hostedUrl, or pass session.payment.payToken to the page.
```

```tsx
import { Checkout } from "@forwend/react";

<Checkout payToken={payToken} onStatus={({ paymentStatus }) => paymentStatus === "paid" && showThanks()} />;
```

Fulfil an order only after your server verifies the webhook and reads the payment as paid.
Each package's README has the full guide, and the API reference lives at `/docs` in the web app.

## Repository

| Folder | What it holds |
|---|---|
| [`apps/web`](apps/web) | The Next.js app: landing page, dashboard, hosted checkout and API docs. |
| [`apps/backend`](apps/backend) | The Go API, worker, signer and webhooks sender, with Postgres. |
| [`apps/example-merchant`](apps/example-merchant) | A sample shop that uses the packages and verifies webhooks. |
| [`packages/contracts`](packages/contracts) | The Solidity invoice receivers and their factory, built with Foundry. |
| [`packages/node`](packages/node), [`js`](packages/js), [`react`](packages/react) | The published packages. |
| [`packages/ui-web`](packages/ui-web), [`design-tokens`](packages/design-tokens) | The shared UI kit and design tokens. |
| [`docs`](docs) | Requirements, decisions, architecture and design rules. |

## Run it locally

You need Node 26, pnpm 12, Go 1.27, Foundry and Docker.

```sh
pnpm install
cp apps/backend/.env.example apps/backend/.env
cp apps/web/.env.example apps/web/.env
pnpm dev
```

`pnpm dev` starts Postgres in Docker, the API, the worker, the signer and the web app at http://localhost:3000.
Fill in the keys in each `.env` first; the backend needs a funded testnet executor key.

```sh
pnpm test        # unit tests for every package, the backend and the contracts
pnpm e2e         # browser and backend end-to-end tests
pnpm lint && pnpm typecheck
```

## Roadmap

- **Done: payments.** Invoices and PDFs, payment links, hosted and embedded checkout, signed webhooks, and paying from other chains.
- **Next: agentic payments.** x402 payments for AI agents: an agent pays for an API or content per request, in stablecoins.
- **Planned: bank withdrawals.** Move stablecoins to a bank account.
- **Planned: card and wallet payments.** Customers pay with a card, Apple Pay or Google Pay, with no crypto knowledge. You still receive stablecoins.

## Security

Please report a vulnerability privately, through this repository's
[Security tab](https://github.com/Forwend/forwend/security/advisories/new). Don't open a public issue.

## License

[MIT](LICENSE)
