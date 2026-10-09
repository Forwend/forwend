# Forwend

Freelancers, merchants and developers get paid in stablecoins through invoices, payment links,
hosted checkout or an API, keep the balance in stablecoins, and send it or withdraw it to a bank
when they choose.

This file owns requirements, decisions and open questions. [PLAN.md](../PLAN.md) owns the roadmap.
Use harness `status` for progress.

## Users and jobs

- Visitor: when I land on forwend.com, I want to understand what Forwend does and trust it, so I can join the waitlist. (R-6, R-8)
- Freelancer or merchant (through the dashboard, later the API): when I create an invoice, I want a receive address that only pays the invoice amount to my profile wallet, so I get paid without trusting anyone with my money. (R-19…R-23)
- Sasha and agents building Forwend: when we build any screen, I want one shared set of tokens and components, visible on one private page, so I can keep the whole app consistent. (R-2…R-5)

## Scope

- First release (PLAN phase 3): R-1…R-12. A walking skeleton, the design system, the private `/kit` page, and a landing page with a mock waitlist.
- Backend scope: R-14…R-24. Use harness `status` / `list` for completion; the roadmap is not a progress log.
- Later, in PLAN order: technical spikes (phase 4), app shell and profiles (7), first payment on Base Sepolia + USDC (8), freelancer flow and payment exceptions (9), merchant stores and developer API/SDK (10), send and bank withdrawal (11), security review, full testnet run and tiny mainnet trials (12). Everything is tested on public testnets before any mainnet trial (D-34).
- Later, before the site is public: the waitlist stores signups for real (D-8).
- Out: customer logos, funding badges, or any claim of being regulated, insured or live (D-7); mobile app; custom checkout domains.

## Domain

| Term | Meaning | Relations | States and rules |
|---|---|---|---|
| Design token | A named value for color, type, spacing, radius, shadow, blur or motion | Defined in `packages/design-tokens`; read by Tailwind and components | Every color token has a light and a dark value |
| Kit page | Private page `/kit` showing all tokens and components | Uses `packages/ui-web` | Not linked, `noindex`, not in the sitemap; 404 unless `KIT_ENABLED=1` |
| Direction | One of three visual styles to compare: A Dawn Path, B Dusk Ledger, C Halftone Horizon | Chosen once; tokens follow it | D-13 is the working direction; Q-1 is owner review |
| Payment status | Label shown for an invoice or payment | Used by status pill, timeline | detected, confirming, paid, partially paid, overpaid, expired, expired–partially paid, settled, refund pending, refunded |
| Base units | Integer token amount on chain (USDC: 6 decimals) | Money component input | Always `bigint` in TypeScript; never floating point |
| Waitlist (mock) | Email form on the landing page | Landing hero and final CTA | Shows success, sends nothing and stores nothing |
| Invoice terms | `invoiceId` (32 random bytes), recipient, token, amount, `expiresAt`, `settleDeadline`, `intendedChainId` | Written once at creation; the receive address commits to them | Immutable; the recipient comes from the profile wallet, never from the request |
| Receive address | The CREATE2 address of the invoice's receiver clone | Computed locally from the factory address and init-code hash compiled into the binary | Unique per chain; must equal `factory.predict(terms)` |
| Chain transfer | One token `Transfer` log to a receive address | Unique `(chain_id, tx_hash, log_index)`; feeds the ledger | detected → confirmed, or reorged |
| Ledger entry | Append-only money record per invoice: received, settled, refunded, held | Built from confirmed transfers and settlement results | Never updated or deleted |
| Settlement intent | A typed request "settle invoice X" for the signer | One per invoice | pending → sent → confirmed or failed; reconciled before any retry |

## Requirements

| ID | Requirement | Acceptance (Given / When / Then) | Check | Based on |
|---|---|---|---|---|
| R-1 | The monorepo builds, tests and serves the web app. | Given a clean clone, when `pnpm install` then `pnpm build` run, then both exit 0. Given the built app, when `/` loads, then the page title contains "Forwend". | build, e2e | D-1, D-2 |
| R-2 | Tokens exist for both themes and meet contrast. | Given `packages/design-tokens`, when the token unit test computes contrast, then every text/background pair listed in the test is ≥ 4.5:1 (body) or ≥ 3:1 (large text) in light and dark. | tokens-unit | D-4 |
| R-3 | The theme can switch between light and dark. | Given `/kit`, when the theme switch is clicked, then `<html>` gets `data-theme="dark"` and the computed body background changes; clicking again restores light. | landing-e2e (theme toggle and persistence) | D-4 |
| R-4 | `/kit` shows the whole system and stays private. | Given `KIT_ENABLED=1`, when `/kit` loads, then headings Colors, Typography, Spacing, Radius, Shadows, Motion, Icons, Components and Payment components are visible and the page has `<meta name="robots" content="noindex">`. Given a production build without `KIT_ENABLED`, when `/kit` is requested, then the response is 404. | kit-e2e | D-5 |
| R-5 | Payment components display money exactly. | Given amount `1234560000n` with 6 decimals and token USDC, when Money renders, then text is "1,234.56 USDC" using tabular figures. Given address `0x1234567890abcdef1234567890abcdef12345678`, when Address renders, then it shows "0x1234…5678" and the copy button copies the full address. Given each of the 10 payment statuses, when the status pill renders, then each shows its own label. | ui-unit | D-6 |
| R-6 | The landing page explains the product in sections. | Given `/`, when it loads, then these are visible in order: nav with "Join waitlist", hero `h1`, network strip (Base, Arbitrum, Arc, Tempo, USDC, USDT), how it works, profile tabs (Personal, Freelancer, Merchant, Developers; clicking each shows its panel), checkout preview, money rules, developer code sample, fees, FAQ (an item expands on click), final call to action, footer. The text "trusted by" does not appear. | manual: review screenshots | D-7 |
| R-7 | The landing page works on every common width. | Given widths 360, 768, 1280 and 1536 px, when `/` loads, then `document.documentElement.scrollWidth` ≤ the viewport width (no horizontal scroll). Given `prefers-reduced-motion: reduce`, when `/` loads, then no element has a running CSS animation or transition longer than 0.01 s. | manual: review screenshots | D-7 |
| R-8 | The mock waitlist confirms without sending data. | Given the hero form, when `name@example.com` is submitted, then "You're on the list" appears and no network request starts after the click. Given `abc`, when submitted, then an error message appears and the success text does not. | waitlist-e2e | D-8 |
| R-9 | Every image is reproducible and optimized. | Given every file in `apps/web/public/images/`, when the images check runs, then each has an entry in `docs/web/images.md` with slot, prompt and date, and the page serves it through `next/image` as AVIF or WebP. | images-check | D-9 |
| R-10 | Pages have no serious accessibility problems. | Given `/` and `/kit`, when axe runs, then there are 0 violations with impact serious or critical. | a11y-e2e | D-4 |
| R-11 | The landing page is fast. | Given a production build, when Lighthouse runs on `/` (mobile preset), then Performance ≥ 90, Accessibility ≥ 95 and LCP < 2.5 s. | lighthouse | D-9 |
| R-12 | Search engines get correct metadata. | Given `/`, when it loads, then it has a title, a meta description and an `og:image` of 1200×630. Given `/sitemap.xml`, then it lists `/` and not `/kit`. Given `/robots.txt`, then it exists. | seo-e2e | D-5 |
| R-13 | Three visual directions can be compared side by side. | Given `KIT_ENABLED=1`, when `/kit/directions` loads, then three hero comps labeled A Dawn Path, B Dusk Ledger and C Halftone Horizon are visible, each with a headline, a primary button and one product panel. | manual: Sasha picks one (Q-1) | D-3 |
| R-14 | The Go backend builds, tests and starts. | Given `apps/backend`, when `pnpm --filter @forwend/backend test` runs, then `gofmt -l` prints nothing and `go vet` and `go test ./...` exit 0. Given Postgres from `infra/docker-compose.yml`, when `api` starts, then `GET /healthz` returns 200 `{"status":"ok"}`; `worker` and `signer` build. Given an empty database, when migrations run twice, then both runs exit 0. | backend | PLAN phase 6, D-16 |
| R-15 | Go computes the same receive address as the contract. | Given a vectors file that Foundry writes from `factory.predict` for at least 20 terms (edge values: amount 1 and 2^256−1, chain IDs of all four testnets, expiry 0 and 2^64−1), when the Go address code runs on each, then every address equals the vector. Given a contract change that alters the init code, when `forge test` runs, then the vectors test fails until the file is regenerated. | backend, contracts | PLAN phase 6, `docs/backend/money-safety.md` |
| R-16 | Chain reading works on all four testnets (spike S-4). | Given Base Sepolia, Arbitrum Sepolia, Arc testnet and Tempo Moderato, when the spike program fetches a block, a receipt and token `Transfer` logs with go-ethereum and reads the `safe` and `finalized` tags, then `docs/spikes/s4-chains.md` records the result per chain and the confirm/finality rule (answers Q-7). | manual: agent, spike notes | PLAN S-4, Q-7 |
| R-17 | The database enforces the money rules. | Given the migrated schema, when a test inserts a second invoice with the same `(chain_id, receive_address)` or the same `(profile_id, idempotency_key)`, a second transfer with the same `(chain_id, tx_hash, log_index)` while the first is not `reorged`, an unbalanced ledger transaction, or updates or deletes a `ledger_entries` row, then Postgres rejects it. Amounts are `NUMERIC(78,0)`; addresses are text with a `chain_family`. | backend | PLAN phase 6 data model |
| R-18 | Only a signed-in user acts, and only for their own profiles. | Given an ES256 access token signed with the configured verification key, issuer `privy.io` and audience = app ID, when it calls a protected route, then it passes. Given a token that is expired, has another issuer or audience, uses another algorithm or `none`, or has a bad signature, then 401. Given a valid token for a profile the user does not own, then 403. No network call per request. | backend | D-12, D-21 |
| R-19 | A creator makes an invoice once, with a correct receive address. | Given `POST /v1/profiles/{profileId}/invoices` with `Idempotency-Key`, `chainId`, `token` and `amount` (decimal string, base units), then 201 with `invoiceId` (32 random bytes, hex), `receiveAddress`, `expiresAt` = now + 1 h unless `expiresIn` is given (allowed 15 min to 365 days, else 422) and `settleDeadline` = `expiresAt` + 24 h. The recipient is the profile's wallet. The same key and body again → 200 with the same invoice; the same key with another body → 409; a disabled or unknown token, amount 0 or above 2^256−1 → 422. | backend | D-18, PLAN phase 6 |
| R-20 | The watcher records only real deposits and survives reorgs and restarts. | Given Anvil with the allowlisted token, when 5 USDC is transferred to a receive address, then a `chain_transfers` row is `detected`, then `confirmed` once the block is at or below the confirm rule. A `Transfer` from a look-alike token contract or to an unknown address adds no row. After a reorg that drops the block, the row is `reorged`. Restarting the worker resumes from the cursor with no duplicate rows. | backend | PLAN phase 6, R-17 |
| R-21 | Invoice states follow confirmed money and block time. | Given confirmed transfers, when their sum is below the amount then `partially_paid`; at or above then `paid` (above: the excess is `held`); a deposit with block time after `expiresAt` is `late` and held; when `expiresAt` passes, `expired` or `expired_partially_paid`. `paid` is set only after a second RPC's `balanceOf` agrees. The database rejects any other transition. A property test over random deposit sequences keeps ledger totals equal to the receiver balance. | backend | PLAN phase 6 state machine, D-15 |
| R-22 | The signer settles a paid invoice once, and only correctly. | Given a paid invoice on Anvil with the real contracts, when its settlement intent runs, then the signer re-reads the terms, recomputes the address, checks the balance on chain, deploys the receiver if needed and calls `settle` with the executor key; the recipient gets exactly the amount. A second intent for the same invoice is rejected. Killing the signer after sending and restarting it sends nothing again (reconciled by nonce and tx hash). Terms whose recipient or address does not match → refused, nothing sent. | backend | PLAN phase 6 signer, `docs/contracts/rules.md` |
| R-23 | The whole money loop runs locally. | Given Postgres and Anvil from compose, when the gate script creates an invoice through the API and pays it with the mock token, then the invoice goes detected → confirmed → paid → settled, and the ledger equals on-chain balances. Running it again with the same idempotency key gives one invoice. | backend-e2e | PLAN phase 6 gate |
| R-24 | Privy works from Go for login and profile wallets (spikes S-1…S-3). | Given a Privy test app, when the spike program verifies an access token, creates and looks up a wallet per profile (several for one user), and tries a sponsored USDC send on Base Sepolia, then `docs/spikes/s1-s3-privy.md` records each result and the decision. | manual: agent, spike notes | PLAN S-1…S-3, Q-4 |
| R-25 | Repository guidance has one owner per topic and checks cannot report false success. | Given the instruction map and check registry, when docs-check and harness regression tests run, then links and decision IDs resolve, changed inputs invalidate evidence, and missing checks cannot pass. | docs-check, harness | Owner cleanup request |
| R-26 | API shutdown drains active responses and reports failure. | Given an active request, when termination starts, then its response completes before normal exit; a shutdown deadline closes the connection and returns an error. Database errors identify their operation and retain their cause. | backend | Owner skeleton review |
| R-27 | Shared UI components and hooks are easy to locate by name. | Given the UI package, when a component or hook changes, then its name identifies its source file and the package exports, rendering and behavior remain unchanged. | typecheck, ui-unit, e2e | Owner structure cleanup |
| R-28 | The payer sees how much is left until a received payment is paid. | Given a deposit in block `B` with time `T` and the chain's finalized head `F`, when progress is computed, then blocks left = `max(0, B − F.number)` and time left = `max(0, T − F.time)`; both are 0 and the deposit is final once `F.number ≥ B`. When the finalized head falls further behind (a busy day), time left grows. A chain whose finalized head equals the latest block (Arc, Tempo) reports 0 at once. | backend | D-45, S-4 |
| R-29 | Privy key rotation never breaks sign-in. | Given the keys published at `PRIVY_JWKS_URL`, when the api starts it loads them and verifies each token with the key named by its `kid`; tokens signed by any published ES256 key pass. Given a token with an unknown `kid`, the api fetches the keys again at most once per minute, then answers 401 if still unknown. A known `kid` makes no network call; a failed fetch at startup stops the api with an error. | backend | R-18, D-12 |

## Decisions

All D- IDs are defined here. The roadmap refers to these decisions.

| ID | Decision | Reason |
|---|---|---|
| D-1 | pnpm workspaces + Turborepo; Go and Foundry use native tools. | One workspace, native compilers. |
| D-2 | One Next.js app (App Router, TypeScript strict) for landing, `/kit`, dashboard and checkout | One deploy and one design system until a real reason to split |
| D-3 | Choose the visual direction from three code comps, not from static mockups | Real type, spacing and images in the browser show the actual result |
| D-4 | Tailwind CSS v4 reading CSS-variable tokens; light and dark themes from the start; `data-theme` on `<html>` | Both themes cost little with variables; the app dashboard needs dark |
| D-5 | `/kit` lives in the web app behind `KIT_ENABLED`, `noindex`, outside the sitemap | Same code and tokens as the real pages, no extra tool |
| D-6 | Money uses bigint base units plus token decimals in TypeScript; formatting never converts money to float. | Exact amounts. |
| D-7 | Landing shows real product UI built in code, no generated screenshots, no fake social proof | Trust for a payments brand; image models garble numbers and text |
| D-8 | The waitlist is a front-end mock until the site is public | Start fast; making it real is queued before launch |
| D-9 | Generate landscape images with image_gen; store WebP and record prompts in docs/web/images.md. Product UI stays code. | Reproducible assets. |
| D-10 | Biome for lint and format; Vitest for unit; Playwright + axe for browser tests | One fast tool; browser tests prove visible behavior |
| D-11 | Named TypeScript types live in src/types/<domain>/; finite domain values live in src/constants/ with derived unions. | One definition per domain. |
| D-12 | Backend in Go with the official Privy Go SDK wrapped in `apps/backend/internal/privy`; built from PLAN phase 6 | Learning goal; official SDK covers the REST API |
| D-13 | Dawn Path marketing, Dusk Ledger product bands, Halftone Horizon texture. Libre Caslon Display, Hanken Grotesk and Geist Mono. | Q-1 remains open for owner review. |
| D-14 | Lighthouse uses mobile devtools throttling locally; recheck simulated throttling on the deployed site. | Local rendering distorts simulated LCP. |
| D-15 | Infura first for Base and Arbitrum; public RPC fallback only after chain-ID validation. A second independent provider confirms balances before paid. | Independent balance confirmation. |
| D-16 | Go net/http, pgx + sqlc, embedded goose migrations, go-ethereum; Postgres 17. | Explicit SQL and few dependencies. |
| D-17 | Database and chain integration tests use real Postgres and Anvil, not SQL or chain mocks. | Prove constraints, transactions and reorg behavior. |
| D-18 | Checkout expiry: default 1 h, the creator may set 15 min to 365 days; `settleDeadline` = `expiresAt` + 24 h | 15 min leaves time for confirmations; 365 days matches the contract rules |
| D-19 | Go binaries in cmd/, application packages in internal/: feature services, database queries and one HTTP boundary. | See backend/rules.md. |
| D-20 | One login holds many profiles: personal, freelancer, merchant. Developer is a team role and workflow, not a profile. | Product policy |
| D-21 | Privy handles login/onboarding **and** creates one default wallet per profile. Our database owns profiles, settings, permissions and links to Privy wallet IDs. A personal profile and wallet are created at signup. | Product policy |
| D-22 | Invoices use **one invoice receiver contract per invoice**, at a CREATE2 address known in advance. Payers send an ordinary token transfer, so exchange withdrawals work. The executor pays gas. | Product policy |
| D-23 | Partial payment: the invoice waits for the rest until expiry. | Product policy |
| D-24 | Paid or overpaid: settle **only the invoice amount** to the profile wallet. The excess stays held as money we owe the payer. | Product policy |
| D-25 | An expired invoice cannot be topped up or reopened. A new payment needs a new invoice and new address. | Product policy |
| D-26 | Expired partial payments and late deposits stay held in the receiver for a verified, platform-approved refund. They are never settled to the merchant, forfeited, or counted as revenue. | Product policy |
| D-27 | **Refunds come only from held funds**, one per approved claim. Normally one refund returns everything held; when several payers sent money (for example two people paid the same invoice), each approved payer gets their own refund. The total never exceeds the held amount and never pulls back money already settled. Never auto-refund to an exchange sender address. | Product policy |
| D-28 | Balances stay in stablecoins. Bank withdrawal is manual and user-started: quote, fees and confirmation first. No automatic payouts. | Product policy |
| D-29 | Payment events have explicit states: detected (unconfirmed), confirmed, settled. Detection is never treated as final. A browser redirect never marks an invoice paid. | Product policy |
| D-30 | Merchant profile → stores/projects. Each store has its own project ID, keys, branding and webhook. At first, stores share the merchant wallet. Developer and Finance roles see assigned stores; Admin sees all. | Product policy |
| D-31 | Developer credentials: merchant ID and project ID (public, no authority), secret API key (server only, scoped), webhook signing secret (separate), optional public key for browser components. | Product policy |
| D-32 | Hosted checkout and branded components (logo, colors, layout). No custom domains in the MVP. | Product policy |
| D-33 | Wrong-chain payments: checkout warns before sending that money sent on another network can be lost. A support request is reviewed case by case; on a chain where our factory exists, `recover()` can return it. Never promise recovery. | Product policy |
| D-34 | Testing: local tests, fork tests and review first, then a full testnet deployment (Base Sepolia, Arbitrum Sepolia, Arc testnet, Tempo testnet) where the whole product runs end to end with Privy on testnets and faucet tokens, then personal mainnet trials with tiny amounts. Bank withdrawal is built last. A public developer sandbox is still deferred. | Product policy |
| D-35 | KYC is deferred for the private prototype only. It must be resolved before other people use real money. | Product policy |
| D-36 | Planned chains: Base, Arbitrum, Arc, Tempo (BNB optional). Planned tokens: USDC, USDT. Each chain/token pair is enabled only after its exact contract is verified. | Product policy |
| D-37 | No MetaMask connection in the MVP. Cross-chain send and recurring wallet billing are later. | Product policy |
| D-38 | Start with Base + USDC; enable Arbitrum, Arc, Tempo and other token pairs one at a time after their tests pass. | Product scope |
| D-39 | Build the invoice engine and hosted checkout before the merchant developer API. Both use the same invoice service. | Product scope |
| D-40 | Use a deterministic deployer for matching factory addresses across supported chains. No nonce-based fallback; a chain with another factory has no cross-chain recovery. | Product scope |
| D-41 | Receiver terms are immutable clone arguments. Deploy only for settlement, refund or recovery; never merely to accept a payment. | Product scope |
| D-42 | Sign webhooks using Standard Webhooks, with retry, replay and delivery records. | Product scope |
| D-43 | Verify sponsored gas for profile-wallet sends on Base and Arbitrum; use a paymaster if Privy cannot provide it. | Product scope |
| D-44 | Store the receive method per invoice (evm_create2 initially). Chain-family adapters allow later HD-wallet or non-EVM methods without changing invoice and ledger semantics. | Product scope |
| D-45 | Confirmation rule (Q-7): a deposit is received when seen in a block and paid only at or below the chain's `finalized` block, on every chain; no fixed block count. Progress shown to the payer: blocks left = deposit block − finalized block, time left = deposit block time − finalized block time, recomputed every poll. Read chains through headers, logs and receipts; take block hashes from the RPC. | Measured in S-4 ([s4-chains](spikes/s4-chains.md)); finality is slower on busy days, and on L2s it counts L1 blocks |

## Assumptions

| ID | We believe that | Wrong if | Test and threshold | Owner | Status |
|---|---|---|---|---|---|
| A-1 | `codex exec` can generate an image with its built-in `image_gen` tool and save it into the repo | The tool only works in the interactive app | Generate the three hero candidates headless | agent | confirmed 2026-10-08 (F002): three candidates generated and copied into `apps/web/public/images/candidates/` |
| A-2 | Images generated with OpenAI image models through Codex may be used commercially on our website | OpenAI terms forbid or restrict it for our plan | Read the current OpenAI terms of use before the landing goes public | user | open |
| A-3 | Lighthouse can run locally against the production build | Headless Chrome cannot reach the score reliably | Local runs with devtools throttling: Performance 100, Accessibility 100, LCP 1.5 s (2026-10-08). Not in CI yet | agent | partly tested |

## Open questions

| ID | Question, options, recommended | Who can answer | Blocks | Default in use |
|---|---|---|---|---|
| Q-1 | Which visual direction: A Dawn Path, B Dusk Ledger, C Halftone Horizon? Compare on `/kit/directions` | user | no | D-13 (owner asked to build without stopping; review later) |
| Q-2 | Where is the company based? | user | no (PLAN phase 11) | Global product; first withdrawal corridors EU/EEA (SEPA) and US (ACH) |
| Q-3 | Preview deploys on Vercel free tier? | user | no | Local only until approved |
| Q-4 | Privy test app credentials for spikes S-1…S-3 | user | R-24 only | Answered 2026-10-09: the app exists; `PRIVY_APP_ID`, `PRIVY_APP_SECRET` and `PRIVY_JWKS_URL` are in `apps/backend/.env` |
| Q-5 | Bank withdrawal provider: Bridge, MoonPay Enterprise, BVNK or Fipto | user | phase 11 | Compare coverage after Q-2; one adapter first |
| Q-6 | Signer key storage before mainnet | user | phase 12 | KMS secp256k1 or Turnkey; local dev key only now |
| Q-7 | Confirmation/finality rule per chain | S-4 spike | R-20…R-22 | Answered by D-45 (S-4, 2026-10-09) |
| Q-8 | Hosting providers | user | deployment | Vercel web, Fly.io or Railway Go, Neon Postgres proposed; approval before publishing or spending |
| Q-9 | Evidence for refund claims, especially exchange deposits | user | phase 9 refunds | Wallet signature for self-custody where possible; support evidence and verified destination otherwise |
