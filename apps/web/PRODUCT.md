# Product

<!-- impeccable:product-schema 1 -->

Source: written from the owner's brief, `PLAN.md` and `docs/PROJECT.md` on 2026-10-08. The owner asked
for work to proceed without check-ins, so lines marked *(inferred)* were not confirmed in an interview.

## Platform

web

## Users

- Freelancers whose clients already pay, or are willing to pay, in stablecoins (USDC/USDT). They
  send invoices, wait for payment, and later move money to a bank. First audience suggested by
  the research.
- Merchants and their developers who want to accept stablecoin payments through hosted checkout,
  payment links, an API, an SDK or embeddable checkout components.
- Individuals who receive, hold and send stablecoins and sometimes withdraw to a bank.
- Payers (clients, customers) who open an invoice or checkout and pay from a wallet or from an
  exchange withdrawal, without creating an account.
- Right now: visitors to forwend.com before launch, deciding whether to join the waitlist.

## Product Purpose

Get paid in stablecoins, keep the balance in stablecoins, send it, or withdraw to a bank when
the user chooses. One login holds personal, freelancer and merchant profiles. Success: a payer
pays an invoice on the right network and the recipient sees it detected, confirmed and settled
into their own wallet, with every fee and state visible.

## Positioning

Each invoice gets its own receiving address (a per-invoice contract), so ordinary transfers,
including exchange withdrawals, match the right invoice. Partial, overpaid, late and
wrong-network payments have explicit rules instead of silent loss: settle only the amount due,
hold the rest for one verified refund. Basic crypto invoicing is not unique (Request Finance,
Acctual, Coinbase Business exist); the clarity of money states is the claim to test.

## Operating Context

- Planned networks: Base, Arbitrum, Arc, Tempo. Planned tokens: USDC, USDT. The first working
  slice is Base + USDC only. None are live yet.
- Payment states shown to users: detected, confirming, paid, partially paid, overpaid, expired,
  expired–partially paid, settled, refund pending, refunded.
- Bank withdrawal is manual: quote, fees and net amount shown before confirming. Provider not
  chosen.
- Developer integration: merchant ID, project ID, secret API key, webhook signing secret.

## Capabilities and Constraints

- Pre-launch: no product is live, no customers, no payments processed.
- The landing page must not claim regulated status, insurance, instant payouts, customers,
  funding or volumes.
- Waitlist is a front-end mock until the site is public (stores nothing).
- Money values are exact integers in base units; display is formatted from them.
- Stack: Next.js 16 App Router, Tailwind CSS v4, TypeScript; tokens in
  `packages/design-tokens`, components in `packages/ui-web`.

## Brand Commitments

- Name: Forwend (FOR-wend), domain forwend.com. "Wend" means to go; the name reads as "go
  forward".
- References the owner made binding for the landing: calm painterly landscape heroes with a
  centered serif headline, a floating pill navigation, glass card over imagery, dark framed
  product sections, halftone/dither image treatment, grainy gradient footer, real product UI
  over the landscape.
- Motif chosen in PLAN.md: "the path forward" — a river or road leading toward a bright horizon.
- Mood images come from the Grok image tool; until credits are available, code-drawn
  illustrations stand in. Product UI, numbers and text are always built in code.

## Evidence on Hand

- No customers, testimonials, logos, press, metrics or pricing exist. Do not fabricate any.
- Demonstration data (sample invoices, amounts, addresses) may be authored and must be labeled
  as sample.
- Research findings live in the owner's research canvas and `PLAN.md`.

## Product Principles

1. Show where the money is and who can move it, at every step.
2. Exact over approximate: precise amounts, named networks, explicit fees. *(inferred wording)*
3. Never promise what the system cannot guarantee (recovery, timing, coverage).
4. The payer should not need an account or crypto expertise beyond choosing the right network.
   *(inferred wording)*

## Accessibility & Inclusion

WCAG 2.2 AA: body text ≥ 4.5:1, large text ≥ 3:1, keyboard access, visible focus,
`prefers-reduced-motion` respected. *(inferred standard; matches docs/PROJECT.md R-2, R-7, R-10)*
