# Product copy

Users: freelancers requesting payment, merchants integrating checkout, individuals receiving/sending stablecoins,
and payers using a wallet or exchange. Payers do not need a Forwend account.
Product requirements and money policy live in [PROJECT](../PROJECT.md); future scope is in [PLAN](../../PLAN.md).

- Explain the path: invoice → detected → confirmed → settled into the profile wallet. Show fees, network and who can move money.
- Separate work progress from payment status, due dates from checkout expiry, and available money from held money.
- Partial, overpaid, expired, late and wrong-network payments need explicit next steps. Refunds follow approved claims;
  never promise automatic recovery or payment timing.
- Pay page: show who is asking (issuer name, or a request's sender name, and invoice number) and the site's host
  name. Before sending, show the short refund rule and "Forwend never asks you to pay a different address or an extra
  fee." Offer "Open in wallet" only as a link the payer's own wallet opens; never connect to it. Help payers with no
  USDC yet: buy it on an exchange, then withdraw on the exact network shown. The invoice PDF is linked at any time;
  after settlement the page is the payer's receipt (R-48), with the receipt PDF.
- Personal profiles can request money: amount, note, expiry and a private link. Call it a request, not an invoice.
- First run asks once what the user wants to do and says which profile each choice adds; the checklist names real next
  steps only. A passkey added there signs in from `/sign-in`.
- Bank withdrawal is user-started: quote, fees, net amount and confirmation. Do not imply it is available before implemented.
- Current public-facing material is pre-launch. No invented customers, testimonials, funding, insurance, regulation or volumes.
- The waitlist is a local mock until real storage is built. Label demonstration invoices, addresses and amounts as Sample.
- Say the exact network and token; planned support is not live support. First payment slice is Base + USDC.
- Plain words, short instructions, no crypto knowledge assumed beyond choosing the specified network.

Visual direction and accessibility: [DESIGN.md](DESIGN.md). Required copy behavior: PROJECT R-6…R-12.
