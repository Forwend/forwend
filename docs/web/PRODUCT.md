# Product copy

Public audiences: businesses, freelancers, and builders. Stores and marketplaces are examples of businesses.
Payers use a wallet or exchange and do not need a Forwend account.
Product requirements and money policy live in [PROJECT](../PROJECT.md); future scope is in [PLAN](../../PLAN.md).

- Explain the path: invoice → detected → confirmed → settled into the profile wallet. Show fees, network and who can move money.
- Separate work progress from payment status, due dates from checkout expiry, and available money from held money.
- Partial, overpaid, expired, late and wrong-network payments need explicit next steps. Refunds follow approved claims;
  never promise automatic recovery or payment timing.
- Pay page: show who is asking (issuer name, or a request's sender name, and invoice number). The site's host name,
  the short refund rule and "Forwend never asks you to pay a different address or a fee this page doesn't show." live under Need help
  (R-45, R-68), never in the pay box. An attached invoice PDF is linked at any time; once paid the page is the payer's receipt
  (R-48), with the receipt PDF, and it never mentions the settlement, which is the creator's business (R-68).
- Personal profiles can request money: amount, note, expiry and a private link. Call it a request, not an invoice.
- First run asks once what the user wants to do and says which profile each choice adds. It asks only what those
  profiles use now (name, contact, country, address, accepted test tokens), then names one real first action each;
  the checklist names real next steps only. A passkey added there signs in from `/sign-in`.
- Bank withdrawal is user-started: quote, fees, net amount and confirmation. Do not imply it is available before implemented.
- Current public-facing material is pre-launch. No invented customers, testimonials, funding, insurance, regulation or volumes.
- Landing actions open `/sign-in`; the landing page does not collect email addresses.
- The hero dashboard and product drawings are examples, named so to screen readers. Nothing in them is a control or accepts money.
- The roadmap marks Payments as Done, Agentic payments (x402 payments for AI agents) as Coming next, and Bank withdrawals and Card and wallet payments as Planned.
- Say the exact network and token; planned support is not live support.
- Live mode is Base, Arbitrum, Arc and Tempo with real money; Developer mode uses their testnets (D-120).
- Plain words, short instructions, no crypto knowledge assumed beyond choosing the specified network.

Visual direction and accessibility: [DESIGN.md](DESIGN.md).
