# Phase 11 research: how merchants and developers get paid in stablecoins

Research for PLAN phase 11, 2026-10-21 and 2026-10-22. The owner decided on the proposals on 2026-10-22
([Owner decisions](#owner-decisions-2026-10-22)); PLAN.md and PROJECT.md now carry them.
Sources are raw: Reddit, X, Hacker News, Trustpilot, GitHub issues, competitor docs, specs and EIPs.

Terms used below:
- KYB: "know your business", the identity checks a payment company runs on a merchant.
- Off-ramp: cashing stablecoins out to a bank account.
- Gateway: a crypto payment company a merchant signs up with, such as Coinbase Commerce or NOWPayments.
- Chargeback: a card dispute that pulls money back from the merchant.
- Webhook: an HTTP call from Forwend to the merchant's server when an invoice changes.

## Summary

1. **The loudest merchant pain is money stuck behind a payment company, not fees.**
   - About 35 merchants report gateway balances they cannot move, accounts locked without reason, or a missed exit window (M1, M2).
   - About 35 more report Stripe or PayPal freezing $12k to $100k for months (M3).
   - Forwend's receiver pays the profile wallet directly, which answers this.
   - The plan has no written rule for what Forwend does to a suspended merchant's money. Write it before outside merchants.
2. **Refunds are the worst-run part of every competitor, and the payer blames the merchant.**
   - Payers report refunds behind KYC, weeks of silence, and gas fees as large as the refund (M7, M8).
   - When Stripe closes a merchant, refunds stop too, and customers call the merchant a scammer (M4).
   - No competitor lets the payer prove the sending wallet with a signature. The signed claim in 11.10.2 is a real edge.
3. **Short payments from exchange fees are the daily exception, and the plan has no answer.**
   - Exchanges take their fee from the amount, so the invoice arrives a little short (M9).
   - BVNK, CoinPayments, BitPay and OxaPay give the merchant an underpayment tolerance or an "accept short payment" button.
   - Expired, partly paid invoices also leave the payer with no way to finish.
4. **A forced wallet connection cost Coinbase Commerce merchants their sales.**
   - Six merchants say payments stopped when Commerce dropped the plain address and QR code (M6).
   - This backs D-37. The owner went further: payers never connect a wallet to pay, only to claim a refund.
5. **Developer pain is webhooks, testing and breaking changes, not missing features.**
   - Signature checks fail on a parsed body; webhooks arrive late, twice, or never; endpoints are disabled silently (M12).
   - No test mode, undocumented exception states, deprecated APIs and products (M13, M14).
   - Phase 11 should add a test mode on the testnets, an events endpoint, a full delivery log and a written deprecation rule.
6. **A payment link must not create an invoice when a page is fetched.**
   - Link previews, email scanners and crawlers fetch links. Each fetch would use a gapless `INV-` number (D-50).
   - Create the invoice when the payer presses Pay, and number it at the first deposit. The owner agreed.
7. **Nobody asked for an embedded React checkout.** Every crypto competitor that matters hosts the payment page.
   The owner keeps the React package for developers, beside the hosted page, as Stripe does (D-88).
8. **Merchants next or bank withdrawal next: merchants.** The owner keeps bank withdrawal at the end of phase 12.
   - Lock-in, freeze and refund pain (M1 to M8) has far more users than off-ramp pain (M17, about 17 users).
   - Merchants who come from Stripe or PayPal want money to "land as dollars". For them withdrawal is the adoption gate.
   - The sources lean toward Coinbase Commerce users, so treat the counts as direction, not market share.

## Market in October 2026

- Coinbase Commerce closed on 2026-03-31 outside the US and Singapore.
  - Users on Reddit and X report it, and so does a MoonPay page.
  - Coinbase's own migration guide exists; its help-center notice returned 403, so the date is not from Coinbase.
- Coinbase Business replaces it: custodial, US and Singapore only, and its Checkouts API takes USDC on Base only.
- Stripe takes stablecoins only for US businesses (EU, HK, MX and CH in private preview).
  - The limit is 10,000 USD per payment; refunds go back as stablecoins to the original wallet.
  - The pricing page shows 1.5%, and also 0.8% as a promotion to 2027-01-01. The difference is not explained.
- BVNK ships the design closest to Forwend's refunds: a holding account, a 3-month claim link, and refund to source.
- Cryptomus was put on the UK sanctions list on 2026-10-08 (news report; the UK notice was not read).
- So merchants outside the US who want a stablecoin checkout they do not have to trust have few options left.

## Money cycle map

| Step | Merchant or developer pain | Payer pain | What competitors do | What Forwend has or plans |
|---|---|---|---|---|
| Sign-up | KYB documents, a $1,000 fee, denial with no reason, weeks of review (M11) | — | Coinbase Business, BVNK and CoinGate gate on KYB | KYB is only a status (D-64); 11.8 |
| Integrate | No test mode, signature errors, undocumented states, breaking changes (M12 to M14) | — | Stripe: test and live keys, events API; Coinbase Business: sandbox | 11.4 to 11.6; no test mode yet |
| Checkout | Forced wallet connection lost sales; customers have no wallet (M6, M18) | Page stuck, wallet or chain not supported | Hosted page almost everywhere | Plain address and QR (D-22, D-37); 11.10 later |
| Exceptions | Short payment from exchange fees; expired partial payment cannot finish (M9) | Told to contact the merchant | Tolerance and "accept partial" (BVNK, CoinPayments, BitPay, OxaPay) | Partly paid and held states; no tolerance, no reopen |
| Refund | Refunds stop when the processor closes the account (M4) | KYC on refunds, weeks of silence, fee as large as the refund (M7, M8) | Email link where the payer types any address | Signed claims and two approvers (11.10.2, 11.10.3) |
| Wrong network | The customer blames the merchant (M10) | $20 fees, months of waiting, "cannot be recovered" | Almost nobody documents a recovery path | `recover()` where the factory exists (11.10.4) |
| Balance and exit | Stuck balances, locked accounts, a shutdown (M1, M2) | — | Custodial balances (Coinbase Business, most gateways) | Receiver pays the profile wallet; no suspension rule; Q-11 open |
| Reconcile | Wallet activity is hard to match to invoices (M16) | — | BitPay and BVNK reports; Xero through vendors | Phase 10 CSV with USD value at receipt |
| Cash-out | Bank freezes after a cash-out; want money to "land as dollars" (M17) | — | Fiat settlement (Stripe, BVNK, BitPay, CoinGate) | Phase 12.5 |

## Evidence table

Rule: a pain counts only when at least 3 different users report it in separate threads or reviews.
Rows that fail the rule are marked **<3 sources**. "About" counts merge the passes and may count one person twice.
Quotes are verbatim, trimmed with "…".

| # | Pain | Users (sources) | Quotes |
|---|---|---|---|
| M1 | Gateway holds or locks merchant money: balances that will not show or withdraw, accounts closed without reason, one lost login locks the funds. Coinbase Commerce, NOWPayments, CoinPayments, BitPay, Plisio | About 35 (Reddit 26, X 3, Trustpilot 9) | "I have about $400 of USDC that I can't withdraw from Coinbase Commerce." ([u/felya, 2024-04-18](https://www.reddit.com/r/CoinBase/comments/1c6u9de/)); "Absolutely ridiculous considering I've processed well into $500k+ with commerce coinbase without a single issue." ([u/wolfy, 2024-02-17](https://www.reddit.com/r/CoinBase/comments/1aryw60/comment/kqsuevz/)); "Then, in a single day, our account was blocked without any clear explanation." ([Axel Michaels on NOWPayments, 2026-04-15](https://www.trustpilot.com/reviews/69e0c3bb04719c5dad3cd676)) |
| M2 | Coinbase Commerce shutdown: 27 days of notice, KYB for a product that held no funds, replacement not in the merchant's country | 8 (Reddit 3, X 5) | "today March 4th I received an email saying commerce will be shut down and I need to migrate to their new platform by March 31st" ([@yuhuayang, 2026-03-05](https://x.com/yuhuayang/status/2029363996017737957)); "We went from $300/day to $0 overnight. … Because Coinbase Commerce shut down and we were already banned from Stripe." ([@michaelaubry, 2026-04-02](https://x.com/michaelaubry/status/2039800276123873414)) |
| M3 | Stripe or PayPal freezes payouts or closes the account, with no reason and template support. This pushes merchants to try stablecoins | About 35 (Reddit 11, X 12, HN 11) | "$100k frozen by Stripe while doing $20k/day." ([u/etimto, 2026-10-18](https://www.reddit.com/r/stripe/comments/1x96kfk/)); "Recently Stripe froze my account and won't let me withdraw anything. My balance is over $50,000" ([sfcoffeeguy, 2025-03-20](https://news.ycombinator.com/item?id=43422906)); "Stripe froze $40k of my business revenue for 120 days, collected $1,100 in fees, and gave no clear reason." ([@visiongroveus, 2026-05-26](https://x.com/visiongroveus/status/2059091574664188371)) |
| M4 | When the processor closes the merchant, customer refunds stop too | 5 (X) | "disabled our ability to issue refunds … our customers can't get refunds and are now calling us scammers" ([@BoymirzaevB, 2026-04-06](https://x.com/BoymirzaevB/status/2041111170921472365)); "Stripe's dashboard says my account "isn't enabled to refund charges." $2,100 of my customers' money is stuck." ([@barrygons2k5, 2026-06-25](https://x.com/barrygons2k5/status/2069974918708498602)) |
| M5 | Chargebacks and friendly fraud: the bank sides with the cardholder even with a signed contract | 7 (Reddit) | "I always submit a copy of the contract with their signature where they agreed to the charges but the bank takes their side anyway." ([u/starshiptraveler, 2024-05-26](https://www.reddit.com/r/smallbusiness/comments/1d0kr3n/comment/l5pgwy8/)) |
| M6 | A forced wallet connection or a required Coinbase account makes payers leave | 9 (Reddit 6 merchants, X 3) | "in the past 5 months I've received ZERO payments from clients and 100's of complaints about the shitty upgrade, no one wants to connect their wallet" ([u/coinophobia, 2024-07-23](https://www.reddit.com/r/CoinBase/comments/1bgheud/comment/legbv06/)); "@coinbase commerce is unusable. The walled gardens of forcing a Coinbase account to pay is pretentious." ([@Cowpertweets, 2024-08-20](https://x.com/Cowpertweets/status/1825691146707783756)) |
| M7 | Refunds withheld, gated by KYC, manual, or ignored for weeks. Triple-A, CoinGate, Cryptomus, BTCPay | About 15 (Trustpilot 7, GitHub 4, Reddit 4) | "This service held my payment and demanded a kyc check just to give me a refund." ([Grace Burrows on Triple-A, 2026-10-13](https://www.trustpilot.com/reviews/6ace5873e3d10d305fe860eb)); "I waited four months for a resolution" ([cryne on Cryptomus, 2026-08-21](https://www.trustpilot.com/reviews/6a88a8fb7a5024f268c7c54c)); maintainer: "refunds are processed manually on their end, so they need to initiate it." ([BTCPay #6643, 2025-03-29](https://github.com/btcpayserver/btcpayserver/issues/6643)) |
| M8 | The refund fee is as large as the refund. CoinPayments | 5 (Trustpilot) | "CoinPayments kept the full 0.02 BNB (around $12) to refund a $6 payment!" ([Eduardo, 2026-06-22](https://www.trustpilot.com/reviews/6a397470543a8383d4014b02)) |
| M9 | Short payments (the exchange took its fee) and late or expired partial payments the payer cannot finish | 10 (GitHub 6, Trustpilot 4); also documented by BVNK and CoinPayments | "You should't pay btcpay invoice from an exchange as exchanges deduct from the total amount" ([BTCPay maintainer, 2025-05-12](https://github.com/btcpayserver/btcpayserver/issues/6721)); "i paid the invoice but they claim it expired, which is not true. now i cannot access to funds" ([Andre on OxaPay, 2025-02-17](https://www.trustpilot.com/reviews/67b4e8eaf6e9f30c39332590)); BVNK: underpayment happens "if the end user is charged a network fee by their exchange platform" ([docs](https://docs.bvnk.com/bvnk/use-cases/stablecoin-payments-for-platforms/underpayments.md)) |
| M10 | Wrong network or token: recovery is slow, costs money, or is refused. Mostly payer-to-exchange; one merchant case | About 15 (Reddit 5, X 7, Trustpilot 3) | "The payment was sent via the BASE network, which was the recommended option given to the client. However, my wallet is on the Ethereum network" and "my customer is understandably frustrated and threatening legal action" ([u/HandLocal948, 2024-09-13](https://www.reddit.com/r/CoinBase/comments/1fg09ot/)); "charged a $20 USDT recovery fee. It's been 2 months now" ([@__BigJo, 2025-11-04](https://x.com/__BigJo/status/1985601177447235649)) |
| M11 | Onboarding and support: source-of-wealth demands, a fee, denial with no reason, 10 to 20 hour chat queues | About 25 (Reddit 13, X 4, Trustpilot 8) | "we were denied with no explanation." ([u/Useful_Ad3015, 2025-02-17](https://www.reddit.com/r/CoinBase/comments/1irp2h5/)); "The first email requested an upfront onboarding fee of USD 1,000" ([u/ahmoo, 2025-01-07](https://www.reddit.com/r/CoinBase/comments/1hvy18w/)) |
| M12 | Webhooks fail: signature check breaks on a parsed body, deliveries late, missing or out of order, endpoints disabled silently | About 15 (GitHub 10, Trustpilot 2, X 3) | "I having been battling this error for weeks now" ([coinbase-commerce-node #48, 2021](https://github.com/coinbase/coinbase-commerce-node/issues/48)); "We regularly wait 30–45 minutes just to receive an IPN/webhook" ([Goda Vatunyte on CoinPayments, 2026-08-25](https://www.trustpilot.com/reviews/6a8f0a988eee921c79e3bd9d)); "who cares how fast it arrives in the wallet if the webhook is 15 minutes late?" ([@easeev, 2024-04-15](https://x.com/easeev/status/1779858084107870255)) |
| M13 | No sandbox or test mode, and undocumented under- and overpaid states, so developers test with real money | 9 (GitHub) | "I can't test my code, moving to another service." ([moccajoghurt, 2023](https://github.com/coinbase/coinbase-commerce-php/issues/7)); "We had to test with real funds to get the actual payload returned when underpayment and overpayment are made." ([ukor, 2019](https://github.com/coinbase/coinbase-commerce-node/issues/6)) |
| M14 | Breaking changes: products and invoices deprecated, 403 on create, no way back to the merchant page | 10 (Reddit) | "I can no longer add products, it says the product feature is deprecated." ([u/AvatarActivation, 2025-11-03](https://www.reddit.com/r/CoinBase/comments/1onjtiy/)); "there is no way for client to return to merchant page to update their data." ([u/whiz_business, 2025-09-11](https://www.reddit.com/r/CoinBase/comments/1neh1gf/)) |
| M15 | No open amount, top-up or services billing; only fixed products | 7 (Reddit 5, X 2) | "i was running a site that works with custom topup … and now i must declare a amount" ([u/Ok-Blackberry7655, 2024-03-17](https://www.reddit.com/r/CoinBase/comments/1bgheud/)); "Fixed price / fixed offering is a no-go for us since each project is…" ([@jonwu_, 2024-07-04](https://x.com/jonwu_/status/1808835200421396748)) |
| M16 | Reconciling wallet activity with invoices and books | 6 (Reddit 5, X 1 thread with 164k views) | "the headache is usually the bookkeeping once those wallet transactions need to map cleanly into your books." ([u/foresythejones, 2026-03-05](https://www.reddit.com/r/stripe/comments/1rl3u04/comment/o8qqiwz/)); "Reconciliation is a nightmare because each payment on normal rails is attached to an invoice." ([@jonwu_, 2024-07-03](https://x.com/jonwu_/status/1808486596297015614)) |
| M17 | Off-ramp: the bank freezes the account after a cash-out; no single step from crypto to the bank. Plus 5 users who ask for money to "land as dollars" | About 17 (Reddit 5, X 6, HN and Trustpilot 6) | "had his bank account frozen after trying to convert USDT to fiat through a P2P exchange." ([u/lymanra, 2026-01-16](https://www.reddit.com/r/smallbusiness/comments/1qeoh51/)); "I have not found any payment gateway that would accept crypto, convert it into fiat and send it to me as payment as a single step process." ([gethly, 2025-08-04](https://news.ycombinator.com/item?id=44774697)); "i dont want to hold crypto, i want it to accept and land as dollars in the bank, thats it." ([u/Smooth_Buy6230, 2026-08-11](https://www.reddit.com/r/SaaS/comments/1vlf2n9/)) |
| M18 | Customers have no wallet or distrust a crypto button; the option is rarely used, and sales can drop | 9 (Reddit 6, HN 3) | "We tested crypto only, and sales took a nosedive." ([u/RegisterConscious993, 2024-03-14](https://www.reddit.com/r/SaaS/comments/1ber9rk/comment/kuvdbzj/)); "Moved over to Coinbase commerce and sales dropped from ~5k / month to 1k / month." ([czhu12, 2025-08-16](https://news.ycombinator.com/item?id=44926543)) |

Under 3 sources or no evidence:
- Team roles (11.2): no post for or against. Kept because merchants with staff need it, not because anyone asked.
- Embedded React checkout (11.9.3): nobody asked, in any source.
- Fear of tainted sender wallets: 3 users, mostly opinion. **<3 sources** from experience.
- Exchange Travel Rule prompts stall a payment: 1 user. **<3 sources.**
- Wallet flow shows "unlimited" token approval on a crypto invoice page: 1 user. **<3 sources.**
- Merchants who say they moved to stablecoins because of card pain: 4 users, and 2 may be vendor accounts. **<3 solid sources.**

## What competitors have

Read from each company's own docs on 2026-10-21, except where marked "secondary".

| Company | Payment links | Keys and test mode | Webhooks | Exceptions and refunds | Reach and fees |
|---|---|---|---|---|---|
| Stripe | Open amount with min, max, preset; default cap 10,000 USD | `sk`/`rk`, `_test_`/`_live_`, restricted keys, rotate with up to 7 days overlap | HMAC with timestamp, retries 3 days, resend 15 days, events API, secret roll with 24 h overlap | Refund as stablecoin to the original wallet; no disputes | US businesses only; 10,000 USD per payment; 1.5% |
| Coinbase Business | Reusable or single-use, min, max or open | Scoped keys, idempotency key | Success, failed, expired; delivery log capped at 50 in a CLI | Full or partial refund call; destination not documented | Custodial; US and Singapore; Base only |
| BVNK | Links and static channels | Sandbox; 2FA to create keys | Detected, confirmed, late, on hold | Holding account; claim link lives 3 months, then the money goes to the merchant; refund to source; exchange deposits land in the exchange's pool | Fiat or crypto settlement |
| CoinPayments | Hosted invoice, button | Signed requests | HMAC; one event per confirmation | Underpayment limit (fixed or percent) or "Accept Partial Payment"; late money refunded; no refund below the network fee | — |
| CoinGate | Hosted order page | Separate sandbox account | 40 retries over a day; callback log; no HMAC found | Refund by email confirmation; minimum 1.0 EUR | Settles EUR or crypto |
| BitPay | — | SDKs | HMAC; resend endpoint | Automatic refunds of short and excess payments by email claim | — |
| MoonPay Commerce (was Helio) | Open "dynamic" amount; metadata per payment | Devnet | HMAC; 12 retries; replay from the log | Refund by the merchant from the dashboard | 1% to 2% |
| Request Network | Links expire after 7 days | Server and browser keys | HMAC; only 4 tries in 21 seconds; test header | Partial payments; payer screening | Hosted "secure payment page" for the same reason as 11.9.1 |

Gaps that no competitor fills well:
- Proof that the person claiming a refund owns the money. Every email flow trusts whoever reads the mailbox.
- Exchange deposits. Only BVNK warns that the refund lands in the exchange's pooled account.
- Unclaimed refunds. Only BVNK has a rule, and it gives the money to the merchant, which D-26 forbids.
- Wrong-network recovery by transaction hash. Nobody documents it.
- Team roles. Only Stripe documents them in detail.
- Webhook security. OxaPay uses the API key itself as the HMAC key; Radom compares a plain header value.

Plan features that no competitor has: the per-invoice receiver with a delayed refund Safe, wallet-signed refund claims,
two-person refund approval, and wrong-network recovery by transaction hash.
The first three answer M1, M4 and M7. The last one has thin demand (M10 is mostly payer-to-exchange), so keep it small.

## Proposed phase 11

These are the proposals as researched. Where the owner decided otherwise, [Owner decisions](#owner-decisions-2026-10-22)
wins: no underpayment tolerance yet, no wallet connection to pay, and the React package stays in phase 11.

| Item | Verdict | Proposal | Evidence |
|---|---|---|---|
| 11.1 Stores | **Change** | Add an underpayment tolerance per store, off by default: fixed or percent, the smaller wins (owner decision 1). Add "allowed origins", used by the return URL and any later embed | M9; BVNK, CoinPayments, BitPay, OxaPay |
| 11.2 Team | **Keep, sharpen** | Permissions in one map in code; routes ask for a permission, never a role name. A test fails when any route has no policy. Last-Admin check in a locked transaction. Invites hashed, single use, bound to the invited email, 7-day expiry. Append-only audit log | BTCPay shipped routes that skipped the store check ([#7489](https://github.com/btcpayserver/btcpayserver/issues/7489)) |
| 11.3 Payment links | **Change** | Opening `/l/<slug>` only shows the page. Pressing Pay creates the invoice; the same browser reuses its open invoice. Link invoices get their `INV-` number at the first deposit (owner decision 5). Open amount with min, max and a default cap. Optional end date and use cap. The owner list shows "N visits, M paid", not every unpaid invoice | M15; D-50 against D-54; Stripe, Coinbase Business |
| 11.4 API keys | **Change** | Test mode on the testnets, live mode on mainnets: `livemode` on invoices, keys, webhook endpoints and events (owner decision 7). Key text `fw_test_` or `fw_live_` plus a checksum, stored as SHA-256. Scopes at creation; no scope moves money (D-61). Rotation with up to 7 days overlap; last-used time. Apply to GitHub secret scanning before outside merchants. Keep D-63 and 12.1 first | M13; Stripe keys; GitHub token format |
| 11.5 Webhooks | **Change** | Keep D-42. Retries for about 3 days on the Svix schedule; a redirect counts as failure; `410` disables. Email the Admin and show it in 11.7 when an endpoint is disabled. Secret rotation with a 24 h overlap. Secret encrypted at rest; delivery runs in its own process with no signer key. Calls pass an SSRF filter (no private or metadata addresses). Each event carries a per-invoice sequence number and a `test` flag. Resend per event and "recover failed since". Verification helper with snippets that read the raw body. Send `invoice.detected` on first sight. Add held-money and canceled events | M12; Stripe, Svix, Standard Webhooks, OWASP |
| 11.5 event names | **Decide** | The plan lists both `invoice.confirmed` and `invoice.paid`. D-29 names a confirmed state; D-45 makes "paid" mean finalized. Keep one meaning per name before the names are public (owner decision 6) | D-29, D-45 |
| 11.6 Public API | **Change** | Idempotency row in the same transaction as the invoice: same key and body returns the same invoice, another body 422, still running 409. Defaults come from request fields, never the clock. `GET /v1/events` for 30 days; cursor paging; a `metadata` field. Hand-written OpenAPI checked by tests; a thin SDK. A written versioning and deprecation rule before the first outside key (owner decision 9) | M12 to M14; Stripe, IETF draft |
| 11.7 Merchant ops | **Change** | The attention list shows held money with its reason, disabled webhooks, and refund claims "waiting since N days". Actions: accept a short payment (decision 1) and reopen or extend an expired partly paid invoice (decision 2). A short case ID on every item. A reconciliation CSV with store, invoice, chain, transaction hash, settlement and USD value | M7, M9, M11, M12, M16 |
| 11.8 Onboarding | **Keep, add a rule** | Keep D-64: KYB never blocks invoices or test keys, and the status shows a reason and a next step. No fees. Add a decision row for a suspended merchant: what happens to settled money, held money and refunds in flight (decision 10) | M1, M3, M11 |
| 11.9.1 Hosted or embedded | **Decide: hosted** | Redirect and popup to `/pay/<token>`. Record it as a decision row | M6; all competitors host; Request gives the same reason |
| 11.9.2 Pay button | **Keep** | The return URL must match an allowed origin and carries only the invoice id. The quickstart says to fulfil from the webhook, not the redirect (D-29) | M14; Coinbase docs |
| 11.9.3, 11.9.4 React package | **Cut from phase 11** | Defer until a merchant asks. Saves the npm account, versioning and browser support work | No source asked for it |
| 11.9.5 Example merchant | **Keep** | Show raw-body webhook verification and an open-amount top-up, with a browser test | M12, M15 |
| 11.10 Connected wallet | **Change** | A second path: the address and QR stay first. Wallet discovery by EIP-6963 with viem. One plain ERC-20 transfer to the address the page computed itself; no token approval. The watcher alone decides "paid". Block a second send while one is pending. WalletConnect later, after the owner approves a Reown account. No gasless EIP-3009 or permit: the receiver has no pull path, and a relayer is a new hot key | M6, M18; EIP-6963, EIP-3009 |
| 11.10.1 Overpaid | **Keep** | Show the held amount, the next step and the expected time | M7 |
| 11.10.2 Refund claims | **Change** | EIP-712 signature with the chain id in the message. Verify plain wallets, deployed smart wallets (ERC-1271) and undeployed ones (ERC-6492). The signer must be the sender of a booked deposit. Default destination is the signer; any other destination goes to review, and the payer gets a cancel link inside the Safe delay. A visible claim status with an expected time. No ID for a normal refund. Gas and any minimum shown before signing (decision 4). Unclaimed money never goes to the merchant (decision 3). Exchange deposits: return to sender with a pooled-account warning, or an evidence path with two approvers (Q-9) | M7, M8, M10; BVNK; EIP-712, ERC-1271, ERC-6492 |
| 11.10.3 Refund tool | **Change** | A verified refund of held money goes ahead whatever the merchant profile's status: suspended, locked out, or owner lost (decision 11). Show a fee estimate. Keep two-person approval (D-60) | M4 |
| 11.10.4 Wrong network | **Keep, small** | Rate-limit the lookup; unknown tokens are a manual case; say plainly that recovery is not promised (D-33) | M10 |
| 11.10.5 Refund suite | **Add cases** | Payment under the tolerance; refund under the fee floor; smart-wallet signatures; exchange sender with no signature; nonce reuse; changed destination; expired partial reopened and topped up | — |
| Q-11 Team wallet | **Spike now** | Run a one-day Privy key-quorum spike: owner change on an existing wallet, browser signing, gas sponsorship, a lost member, price, Arc support. A Safe as merchant wallet waits until Safe is confirmed on all four chains (D-40). Never put a Forwend key in a quorum (D-46). Before outside merchants, at least prove the owner's own login recovery | M1; Privy and Safe docs |

## Considered and left out

- E-commerce plugins: not in the MVP (owner choice).
- Subscriptions and pull payments: 5 developers ask, but phase 10 retainers cover the safe version.
- Agent payments (x402): only vendor and news posts; no merchant asked.
- Authorize now, capture later: no merchant asked; jobs with deposits cover the main use.
- Base Pay: Base-only USDC, a second integration for one chain.
- Quantity and inventory on payment links: shop features, not Forwend's users.
- Xero or QuickBooks integrations: the CSV comes first; 1 user asked for accounting fit.
- Screening the payer's wallet (Request, CoinGate, BVNK do it): after 11.10, when connected wallets exist.
- A "Moving from Coinbase Commerce" page: useful marketing, but the site is not public yet.

## Checkout levels (follow-up, 2026-10-22)

The owner kept the React package and asked how Stripe does checkout. Stripe's docs and the source of `stripe-js` and
`react-stripe-js` were read on 2026-10-22.

- Stripe offers Payment Links, a hosted Checkout, an embedded Checkout and Elements inside the merchant's own page.
- Forwend maps that to three levels (D-88):
  - a pay button or link to `/pay/<token>`;
  - an embedded checkout at `/embed/<token>`, the full pay page in an iframe;
  - a payment element, the same route with `layout=element`, inside the merchant's own page.
- One iframe is enough. Stripe needs many because the merchant places card fields; Forwend collects nothing the
  merchant places.
- No checkout-session object and no public key are needed. The invoice and its pay token (D-86) do the job of a
  Stripe Checkout Session and its client secret.
- Do not copy Stripe's remote script. Stripe.js loads from Stripe for card rules and fraud signals; none applies here.
  `@forwend/js` (at most 3 KB gzip) only creates the iframe and listens to it; `@forwend/react` adds about 2 KB.
- Stripe users hit lifecycle bugs (Strict Mode, leaked instances) and React 18 and 19 support that lagged for months.
  The Forwend component renders an iframe and one listener, and CI runs React 18 and 19.
- The theme takes `theme` and a few variables, checked for contrast. No free CSS rules or font URLs: they could hide
  the address.
- Today `apps/web/next.config.ts` sends `frame-ancestors 'none'` on every path. The embed route needs its own
  per-store header.
- A merchant page can draw a lookalike over the iframe, as with Stripe. The iframe keeps an "Open on Forwend" link.
- The refund claim connects a wallet, so from an embed it opens the hosted page in a new tab.

## History log and invoice changes (follow-up, 2026-10-22)

The owner asked that a merchant can edit an invoice, and that everything that happens to it is logged.
Stripe, QuickBooks, FreshBooks, Zoho and Xero docs, the EU VAT Directive and HMRC VAT Notice 700 were read.

- Stripe edits only drafts in place; a sent invoice is revised into a new invoice, and the old one is voided.
- EU and UK rules correct an issued invoice with a new document that names the original
  (Directive 2006/112/EC art. 219; HMRC Notice 700 §19.8).
- Forwend's terms are fixed in the receiver (D-41), so any money change needs a new address anyway.
- Proposed edit rules (D-92):
  - Memo, client email, reminders and return link: any time.
  - Reference, note and a due date inside the checkout window: before payment; the payer sees "Updated".
  - Anything else: a Revise before any deposit; the old invoice is canceled as "Replaced by" (D-79).
  - After money arrives: no Revise and no money edits.
- A Revise is not safe for a payer who already copied the old address. Money sent there is held (D-26). The old page
  hides the address and links to the new one, and the owner sees "sent on …, opened N times" before confirming.
- The log is one append-only table written in the same transaction as each change, like the outbox and the ledger.
  A database guard refuses a change that writes no row. Webhook events and the events endpoint read the same rows.
- Privacy: no IP, no user agent, no email-open tracking. Views keep a first time, a last time and a count.
- Reopening an expired, partly paid invoice works only before its settle deadline. Only our executor settles before
  it; after it only the refund Safe can, with a 24–48 h delay and two people.
  - The deadline is 1 day after expiry today, so the grace length is an owner choice.
  - A longer grace delays refunds of short payments by the same time.
- A short payment can never settle: `settle()` pays exactly the amount and reverts below it. So an underpayment
  tolerance needs a new receiver version, and is deferred.

## Owner decisions (2026-10-22)

1. Short payments: top-up only. A tolerance waits for a receiver version that can settle a minimum amount.
2. Reopen an expired, partly paid invoice: yes. The owner may also edit an invoice, and every change is logged (D-92).
3. Unclaimed held money stays held for now; a later decision covers very old claims (D-90).
4. Forwend pays the network fee of refunds; minimum refund 1 USD (D-90).
5. Payment-link invoices are created on Pay and numbered at the first deposit (D-50, D-54).
6. `invoice.confirmed` is dropped; invoice events are detected, partly paid, paid, settled, expired, canceled and held.
7. Test mode is the testnets with `livemode`. Public RPCs by default; a developer can add their own; a profile turns
   chains and tokens on or off (D-75, D-87).
8. Hosted checkout and the React package both ship, in three levels like Stripe (D-88).
9. API changes get 90 days' notice, in a docs changelog with a status page (D-91).
10. Forwend never holds merchant money. Suspension stops new invoices and keys, never settlement (D-89).
11. Refunds of held money go ahead whatever the merchant's status (D-89).
12. Q-11: the Privy key-quorum spike comes first; D-61 holds for the first outside merchants.
13. Approved: viem, `openapi-typescript`, `kin-openapi`, a Reown account and a GitHub secret-scanning application.
- Payers never connect a wallet to pay. A wallet connects only after Claim refund, for money sent from it (D-37).
- Refunds of paid invoices started by the merchant, such as a customer who did not like the product, come after the
  MVP.
- Bank withdrawal stays at the end of phase 12, after send.

## Method

Five research passes ran in parallel on 2026-10-21, and two follow-ups on 2026-10-22 (checkout levels, history log).
Each followed the evidence rule above and dropped vendor posts.

- **Reddit** through the [Arctic Shift](https://arctic-shift.photon-reddit.com) archive; reddit.com answers 403 to automated reads.
  - About 150 title searches in 22 subreddits, 2024-01-01 to 2026-10-21.
  - 3,233 posts loaded; 171 comment trees (1,214 comments); about 60 trees read in full.
  - Comment search timed out on busy subreddits, so pain buried in unrelated threads is missed.
  - Dropped: 98 vendor posts and about 83 vendor mentions in comment trees.
- **X** through the xscraper tools: about 40 searches, about 900 posts scanned, 14 conversations read.
  - Dropped: about 110 promotion, bot and spam posts.
  - Replies to BitPay, CoinGate, NOWPayments, BVNK, MoonPay Commerce, Request, Radom, Loop, Daimo and Sphere were mostly promotion.
- **Hacker News, reviews, GitHub, Stack Exchange.** 23 HN threads and about 60 comments.
  - About 110 Trustpilot reviews listed and 45 used. Trustpilot came through a page fetcher that summarises, so long quotes are not re-checked.
  - About 40 GitHub issues read (Coinbase Commerce SDKs, BTCPay, BitPay); the Coinbase SDK issues date from 2018 to 2023.
  - G2, Capterra, Indie Hackers, Bitcointalk and several help centers blocked automated reads; nothing is cited from them.
- **Competitor docs:** about 60 pages and API files from 17 companies. Pages that could not be read are marked "secondary".
- **Technical sources:** Standard Webhooks, Stripe, Svix, OWASP, the IETF idempotency draft, GitHub's token format, MDN, EIPs 712, 1271, 3009, 4361, 5792, 6492 and 6963, and the Privy and Safe docs.
- **Spot check:** 13 sampled quotes and facts were re-read at the source after the passes: Reddit, X, Hacker News, Stripe and BVNK. All matched.
- **Bias:** many Reddit rows come from r/CoinBase, where Commerce users ask for help. Counts show direction, not market share.
- **Not verified:** the Coinbase Commerce shutdown date from Coinbase itself; Privy key-quorum price and lost-member recovery; Safe on Arc and Tempo.
- **Follow-ups:** Stripe docs and the `stripe-js` and `react-stripe-js` source and issues (about 20 read); Stripe,
  QuickBooks, FreshBooks and Zoho invoice and audit-log docs; the EU VAT Directive (legislation.gov.uk copy) and HMRC
  VAT Notice 700. Reddit timed out for both, and Xero and Wave help pages did not load.
