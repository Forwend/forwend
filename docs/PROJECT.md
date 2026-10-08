# Forwend

Freelancers, merchants and developers get paid in stablecoins through invoices, payment links,
hosted checkout or an API, keep the balance in stablecoins, and send it or withdraw it to a bank
when they choose.

Discovery: tier 0 (spec supplied: [PLAN.md](../PLAN.md), built from a 106-block research canvas), checked 2026-10-08.
The full roadmap (phases 1–12), the product money rules and the accepted changes C-01…C-09 live in
PLAN.md. This file holds the current release's requirements and the decisions that bind code now.

## Users and jobs

- Visitor: when I land on forwend.com, I want to understand what Forwend does and trust it, so I can join the waitlist. (R-6, R-8)
- Sasha and agents building Forwend: when we build any screen, I want one shared set of tokens and components, visible on one private page, so I can keep the whole app consistent. (R-2…R-5)

## Scope

- First release (PLAN phase 3): R-1…R-12. A walking skeleton, the design system, the private `/kit` page, and a landing page with a mock waitlist.
- Later, in PLAN order: technical spikes (phase 4), contracts (5) with the factory deployed on four testnets, Go backend (6), app shell and profiles (7), first payment on Base Sepolia + USDC (8), freelancer flow and payment exceptions (9), merchant stores and developer API/SDK (10), send and bank withdrawal (11), security review, full testnet run and tiny mainnet trials (12). Everything is tested on public testnets before any mainnet trial (PLAN D-15).
- Later, before the site is public: the waitlist stores signups for real (PLAN C-09).
- Out: customer logos, funding badges, or any claim of being regulated, insured or live (PLAN C-08); mobile app; custom checkout domains.

## Domain

| Term | Meaning | Relations | States and rules |
|---|---|---|---|
| Design token | A named value for color, type, spacing, radius, shadow, blur or motion | Defined in `packages/design-tokens`; read by Tailwind and components | Every color token has a light and a dark value |
| Kit page | Private page `/kit` showing all tokens and components | Uses `packages/ui-web` | Not linked, `noindex`, not in the sitemap; 404 unless `KIT_ENABLED=1` |
| Direction | One of three visual styles to compare: A Dawn Path, B Dusk Ledger, C Halftone Horizon | Chosen once; tokens follow it | Undecided until Q-1 is answered |
| Payment status | Label shown for an invoice or payment | Used by status pill, timeline | detected, confirming, paid, partially paid, overpaid, expired, expired–partially paid, settled, refund pending, refunded |
| Base units | Integer token amount on chain (USDC: 6 decimals) | Money component input | Always `bigint` in TypeScript; never floating point |
| Waitlist (mock) | Email form on the landing page | Landing hero and final CTA | Shows success, sends nothing and stores nothing |

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
| R-9 | Every image is reproducible and optimized. | Given every file in `apps/web/public/images/`, when the images check runs, then each has an entry in `docs/images.md` with slot, prompt and date, and the page serves it through `next/image` as AVIF or WebP. | images-check | D-9 |
| R-10 | Pages have no serious accessibility problems. | Given `/` and `/kit`, when axe runs, then there are 0 violations with impact serious or critical. | a11y-e2e | D-4 |
| R-11 | The landing page is fast. | Given a production build, when Lighthouse runs on `/` (mobile preset), then Performance ≥ 90, Accessibility ≥ 95 and LCP < 2.5 s. | lighthouse | D-9 |
| R-12 | Search engines get correct metadata. | Given `/`, when it loads, then it has a title, a meta description and an `og:image` of 1200×630. Given `/sitemap.xml`, then it lists `/` and not `/kit`. Given `/robots.txt`, then it exists. | seo-e2e | D-5 |
| R-13 | Three visual directions can be compared side by side. | Given `KIT_ENABLED=1`, when `/kit/directions` loads, then three hero comps labeled A Dawn Path, B Dusk Ledger and C Halftone Horizon are visible, each with a headline, a primary button and one product panel. | manual: Sasha picks one (Q-1) | D-3 |

## Decisions

| ID | Decision (alternatives considered) | By | Date | Because |
|---|---|---|---|---|
| D-1 | pnpm workspaces + Turborepo; Go and Foundry keep native tools (Nx; plain pnpm) | user (PLAN C-06) | 2026-10-08 | Less config while the repo is small |
| D-2 | One Next.js app (App Router, TypeScript strict) for landing, `/kit`, dashboard and checkout (separate apps per surface) | agent default | 2026-10-08 | One deploy and one design system until a real reason to split |
| D-3 | Choose the visual direction from three code comps, not from static mockups (pick from the references directly) | user | 2026-10-08 | Real type, spacing and images in the browser show the actual result |
| D-4 | Tailwind CSS v4 reading CSS-variable tokens; light and dark themes from the start; `data-theme` on `<html>` (CSS-in-JS; light only) | agent default | 2026-10-08 | Both themes cost little with variables; the app dashboard needs dark |
| D-5 | `/kit` lives in the web app behind `KIT_ENABLED`, `noindex`, outside the sitemap (separate Storybook) | user | 2026-10-08 | Same code and tokens as the real pages, no extra tool |
| D-6 | Money is `bigint` base units plus token decimals everywhere in TypeScript; formatted only for display (number/float) | agent default | 2026-10-08 | Floats lose cents; matches on-chain integers |
| D-7 | Landing shows real product UI built in code, no generated screenshots, no fake social proof (logo walls, funding badges) | user (PLAN C-08) | 2026-10-08 | Trust for a payments brand; image models garble numbers and text |
| D-8 | The waitlist is a front-end mock until the site is public (real storage now) | user | 2026-10-08 | Start fast; making it real is queued before launch |
| D-9 | Landscape and texture images come from the Codex CLI built-in `image_gen` tool, run headless with `codex exec`; stored as WebP, served through next/image; prompts kept in `docs/images.md` (Grok CLI, which had no credits; stock images; code-only art) | user | 2026-10-08 | Grok returned HTTP 403 (no credits); owner chose Codex |
| D-10 | Biome for lint and format; Vitest for unit; Playwright + axe for browser tests (ESLint + Prettier) | agent default | 2026-10-08 | One fast tool; browser tests prove visible behavior |
| D-11 | TypeScript structure: all named types in `src/types/<domain>/`, finite runtime values as `as const` objects in `src/constants/<domain>.ts`, no repeated domain string literals (types next to code) | user | 2026-10-08 | Single source of truth per domain (typescript-structure skill) |
| D-12 | Backend in Go with the official Privy Go SDK wrapped in `apps/backend/internal/privy`; built from PLAN phase 6 (TypeScript backend; porting Privy's TS SDK) | user | 2026-10-08 | Learning goal; official SDK covers the REST API |
| D-13 | Visual direction: A Dawn Path for marketing, B Dusk Ledger's dark framed product sections, C Halftone Horizon's dots as a secondary texture. Fonts: Libre Caslon Display (display), Hanken Grotesk (UI), Geist Mono (amounts, addresses) (pure A, B or C; other faces) | agent default, pending owner review | 2026-10-08 | Q-1; PLAN §P3.2 recommendation |
| D-14 | The Lighthouse check uses real ("devtools") throttling with the mobile preset (default simulated throttling) | agent default | 2026-10-08 | R-11. On localhost the page scripts run before first paint, so simulation adds every script to the LCP path: simulated LCP 3.1 s, real throttled LCP 1.5 s, first paint 1.4 s either way. Re-check with simulation against the deployed site |

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
