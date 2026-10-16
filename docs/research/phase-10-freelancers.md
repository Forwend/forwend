# Phase 10 research: how freelancers get paid

Research for PLAN phase 10, 2026-10-16. It proposes a phase 10 with fewer, deeper items; the owner approved the proposals on
2026-10-16 and PLAN.md and PROJECT.md now carry them. Sources are raw: Reddit threads, low-star reviews, competitor docs and primary legal text.

## Summary

1. **Freelancers lose most money at the end of a job, not the start.** The large unpaid amounts on Reddit are
   final invoices after delivery ($10k, $25k, $70k), and clients on net 30 often pay at 45–60 days or later. Deposits
   and milestones are the fix freelancers already use; the plan should build them as one flow.
2. **Forwend has a gap that hurts exactly this user.** An invoice's checkout closes after 7 days by default
   (`DEFAULT_EXPIRY = "week"` in `apps/web/src/features/invoices/constants/invoices.ts`), and the due date is a separate
   field with no check against it. A net-30 client who pays on day 25 sends money that is held for the payer (D-26),
   and refunds only come in 11.10. This needs fixing before freelancers use invoices with payment terms.
3. **Stablecoin freelancers have a different top pain: records.** They need the USD (or EUR) value of each payment
   at the moment it arrived, matched to an invoice, in a form their accountant or bank accepts. The IRS and the EU
   VAT rules both require that value. Cash-out to a bank is the next pain, and phase 12 already plans it.
4. **The work page with its own states and approval log has thin evidence** (one Reddit user asked for it). The
   proposal keeps only what payment needs: the client accepts a quote, and a milestone invoice follows when the work
   step is done.
5. **Chargebacks and frozen accounts are where stablecoins help most.** 11 users lost card payments to chargebacks
   after the client had approved the work, and 8 had money frozen by Wise, PayPal, Stripe or a bank. An on-chain
   payment cannot be charged back. The planned card provider brings chargebacks back, and the consumer on-ramps
   forbid paying someone else's address; see [Card payers](#card-payers-paying-by-card-receiving-stablecoins).

Proposed phase 10: 6 items instead of 8. Each item, its evidence and what changed are in
[Proposed phase 10](#proposed-phase-10).

## Method

- **Reddit, through the [Arctic Shift](https://arctic-shift.photon-reddit.com) archive.** Reddit answers 403 to
  automated reads and web search cannot reach it, so all Reddit text comes from that archive. Collected: every
  r/freelance post title from 2023-01-01 to 2025-03-24 (17,121 posts) plus 307 later posts found by keyword search
  up to 2026-10-12; every r/USDC post from 2023-01-01 to 2026-10-16 (3,108); 114 r/tax posts by keyword; full
  comment trees of 121 threads (3,309 comments). A second pass ran title searches in r/Upwork, r/smallbusiness,
  r/digitalnomad, r/Entrepreneur, r/freelanceWriters, r/webdev and r/graphic_design (about 45 searches, 946 posts,
  44 threads read) and dumped r/payments (700 posts, almost all from 2026; 43 threads read).
- **Tagging.** A keyword pass picks candidate posts and comments for each pain label. Every quote below was then
  read by hand; the evidence table counts only quotes that were read and that report the pain from experience.
  Vendor posts selling a product (common in r/USDC) are left out of the counts.
- **Rule from the brief:** a pain counts only when at least 3 different users report it in separate threads.
  Claims below that rule are marked **<3 sources**.
- **Cost.** Money and time come from the numbers people wrote in their own posts. They are examples, not a
  statistic.
- **Competitors** were read from their own docs and help centers; no accounts were opened (that needs owner
  approval).

## Money cycle map

Both sides: the freelancer, and the client's finance team (AP, accounts payable: the people who set up vendors,
approve bills and run payments). Pains are numbered as in the [evidence table](#evidence-table).

| Step | Freelancer pain | Client finance side | What Forwend has today |
|---|---|---|---|
| Quote | Clients ask for a quote and disappear; scope is unclear (P7) | Needs a written agreement; NY law requires one ([§1412](https://www.nysenate.gov/legislation/laws/GBS/1412)) | Nothing |
| Deposit | Deposit is the main protection (P3); a few clients refuse and leave | An EU business must get an invoice for a payment on account ([art. 220(1)(5)](https://www.legislation.gov.uk/eudr/2006/112/article/220)) | A normal invoice can be used, but nothing links it to the final one |
| Work | Scope creep and extra revisions (P7) | — | Nothing |
| Delivery and acceptance | Client uses the work and does not pay the final invoice (P2) | Approval often sits with a different person than the one who ordered the work (P6) | Nothing |
| Final invoice | The largest unpaid amounts are here (P2) | Vendor forms, W-9/W-8BEN, PO numbers and payment runs slow payment (P6) | Invoice with number, client name, email, address, issuer tax ID (R-42, R-43); no client tax ID, no line descriptions, no PO |
| Chasing | Net 30 becomes 45–60+ days (P1); chasing is stressful (P5) | Pays on its own cycle | Owner emails on paid/settled/held; no client reminders; checkout may close before the due date |
| Cash-out | Stablecoin users move money through exchanges to a bank (S2) | — | Phase 12.5 |
| Records | Stablecoin users need the fiat value at receipt and invoice matching (S1) | Needs the invoice, the VAT in national currency and a receipt | Invoice and receipt PDFs (R-61); no fiat value, no export |

## Evidence table

Quotes are verbatim, trimmed with "…". "Users" counts different authors whose text was read; "keyword hits" is the
rough count of posts the keyword pass found in r/freelance or r/USDC before reading.

### Freelancers paid in fiat money (r/freelance)

| # | Pain | Users / threads read | Keyword hits | Quotes |
|---|---|---|---|---|
| P1 | Clients pay late; net 30 stretches to 45–60 days or more | 8 / 7 | 74 posts | "they told me their terms were net 30 … they are now saying net 60" ([u/tourdepiss, 2024-10-08, score 67](https://www.reddit.com/r/freelance/comments/1fz4aeo/)); "The terms are Net30, but they always pay late and it's more like Net45-Net60" ([u/Emotional_Money8694, 2024-08-23](https://www.reddit.com/r/freelance/comments/1ezosrm/)); "clients know they have leverage and can push smaller vendors to the bottom of the AP list. I'll need to dip into savings" ([u/Icy-Conclusion8117, 2023-03-14](https://www.reddit.com/r/freelance/comments/11r9p3n/)); "agreed to pay me Net 30 and there's still a balance … some 80+ days after" ([u/EmanAvan, 2024-07-24](https://www.reddit.com/r/freelance/comments/1eb40fw/)); "75% of my clients take 30 days or more to pay, But they do, eventually" ([u/sf8as, 2023-04-19](https://www.reddit.com/r/freelance/comments/12pys35/comment/jgv3n3i/)); "I have had payments often arrive 3-4 months later" ([u/HamiltonBrand, 2024-10-09](https://www.reddit.com/r/freelance/comments/1fz4aeo/comment/lr3qfg3/)) |
| P2 | Final invoice unpaid after the work is delivered or used | 6 / 6 | 133 posts | "they paid the first two invoices that accounted for a little over 50% … The final invoices still owed are close to $10k" ([u/mellamolaura6, 2024-05-14, post score 1,082](https://www.reddit.com/r/freelance/comments/1crvx5m/comment/l43ia5f/)); "when I submitted my final invoice, the owner refused to pay unless I handed over all my working files" ([u/TruthseekerTO, 2025-06-02](https://www.reddit.com/r/freelance/comments/1l1vhwi/)); "sends me 1k of 6k owed, then ghosts me … 7 months overdue" ([u/poopinion, 2024-05-16](https://www.reddit.com/r/freelance/comments/1ctpjqw/)); "Client owes me 25k. What are my options?" ([u/nodeymcdev, 2024-03-15](https://www.reddit.com/r/freelance/comments/1bflhh9/)); "the client owed me over $70k … In total, it took like 9 months to recoup all of the money" ([u/atdsf, 2024-05-16](https://www.reddit.com/r/freelance/comments/1ctpjqw/comment/l4djzuo/)) |
| P3 | A deposit before work is the main protection; some clients refuse it | 9 / 7 | 43 posts | "No deposit, no work." ([u/random_dude_1s, 2023-02-18](https://www.reddit.com/r/freelance/comments/11548cf/comment/j8zn8tx/)); "signed agreement on work, scope, goal, deadline … Plus a retainer or 25%-50% upfront." ([u/Wisewordsforlater, 2026-09-24](https://www.reddit.com/r/freelance/comments/1wo1fkg/comment/pbrtxjq/)); "you have a contract, with half paid up front" ([u/callmeishmael517, 2023-02-11](https://www.reddit.com/r/freelance/comments/10zrd1m/comment/j84x0yz/)); "I ask for 60% upfront as a deposit then 40% upon completion" ([u/Fantastic-Toe9905, 2026-05-26](https://www.reddit.com/r/freelance/comments/1to9m9h/)). Against: "They say paying my 50% deposit 'is an issue'" and then the client left: "our respective policies don't give either of us the flexibility to find middle ground" ([u/PracticalThing, 2023-02-18](https://www.reddit.com/r/freelance/comments/11548cf/comment/j91kq0s/)) |
| P4 | Milestone payments keep the unpaid amount small | 6 / 6 | 16 posts | "25% Deposit 25% @ Design Approval 25% @ Development Finished 25% BEFORE Launching or handing over code" ([u/redlotusaustin, 2024-10-08, score 69](https://www.reddit.com/r/freelance/comments/1fz4aeo/comment/lqyxd4n/)); "contract + deposit + clear milestones and deliverables. or no work." ([u/nycprofessor5, 2025-06-03](https://www.reddit.com/r/freelance/comments/1l1vhwi/comment/mvt750j/)); "A tight schedule with milestones and partial payments is your friend. Never build and hope." ([u/arno14, 2026-07-31](https://www.reddit.com/r/freelance/comments/1va9vtx/comment/p0xrv2g/)); "60% down before new scope is added" ([u/drakonlily, 2026-05-26](https://www.reddit.com/r/freelance/comments/1to9m9h/comment/oo09uuv/)); "Client is asking to pay the project in monthly installments rather than milestones" ([u/BraveBookCash, 2024-12-15](https://www.reddit.com/r/freelance/comments/1hexdxr/)) |
| P5 | Chasing payment is stressful and takes time | 6 / 6 | 54 posts | "Chasing payments is stressful and not worth the time." ([u/atdsf, 2024-05-17](https://www.reddit.com/r/freelance/comments/1ctpjqw/comment/l4e0mie/)); "a month after I send the invoice, and with weekly follow ups" ([u/Futureisbright14, 2023-01-20](https://www.reddit.com/r/freelance/comments/10h7lto/)); "I've been doing that each month since August" ([u/mellamolaura6, 2024-05-14](https://www.reddit.com/r/freelance/comments/1crvx5m/)); "I hate asking for payment when we have a contract!" ([u/Curious-Qent206, 2024-02-24](https://www.reddit.com/r/freelance/comments/1ayo30a/)); "3 Months of Chasing Payment" ([u/Zealousideal-Tap-834, 2024-08-12](https://www.reddit.com/r/freelance/comments/1eqa7hx/)); "continually pays late and this month has decided to ignore all reminders" ([u/o-TheFlash-o, 2024-03-15](https://www.reddit.com/r/freelance/comments/1bf8mwa/)) |
| P6 | The client's finance process slows or blocks payment | 6 / 6 | 36 posts | "they have a whole department for paying out to vendors" ([u/HamiltonBrand, 2024-10-08](https://www.reddit.com/r/freelance/comments/1fz4aeo/comment/lqz15db/)); "finally got a bill put in through bill.com and then - radio silence" ([u/Hollywoodlivin, 2023-05-05](https://www.reddit.com/r/freelance/comments/138zser/)); "I filled out the W9 … the new client sent me a check made out to My Name, dba My Small Business, LLC. My bank won't let me deposit the check" ([u/olily, 2023-04-25](https://www.reddit.com/r/freelance/comments/12yl3a8/)); "Harvest for a couple of smaller clients, Timesheet for another client, Airtable for another, Bill.com for pay for one … a hassle to track … when I can expect to get paid" ([u/Lovamelin, 2024-02-03](https://www.reddit.com/r/freelance/comments/1ai6515/)); "They pay at 30 days despite what their purchase orders say." ([u/Organic-Technology10, 2024-10-08](https://www.reddit.com/r/freelance/comments/1fz4aeo/comment/lqzxqt8/)) |
| P7 | Scope creep and extra revisions without extra pay | 6 / 6 | 106 posts | "He will constantly add things, change his mind, remove things" ([u/Fantastic-Toe9905, 2026-05-26](https://www.reddit.com/r/freelance/comments/1to9m9h/)); "a 'countdown to launch' page, which was not in scope either" ([u/dingo_dev, 2023-01-08](https://www.reddit.com/r/freelance/comments/106qkew/)); "The first revision required 13 hours and the 2nd revision 10 hours" ([u/hungrycameleon4data, 2023-05-11](https://www.reddit.com/r/freelance/comments/13e9tfj/)); "I limit revisions to 3 per milestone" ([u/drakonlily, 2026-05-26](https://www.reddit.com/r/freelance/comments/1to9m9h/comment/oo09uuv/)) |
| P8 | A link where the client reviews and signs off the work | 1 / 1 — **<3 sources** | 5 posts | "something where you can just send a link to the client and they can view and sign off on it in their own time" ([u/Clear-Time-9815, 2024-07-06](https://www.reddit.com/r/freelance/comments/1dwx30p/)) |

Money and time named in r/freelance posts tagged late or unpaid (keyword pass, not hand-read): median $1,025 owed
(8 amounts) and 35 days late (18 durations) for late posts; median $715 (19 amounts) and 29 days (14 durations)
for unpaid posts. The hand-read cases above range from $250 to over $70k and up to 9 months.

### Freelancers paid in stablecoins (r/USDC, r/freelance)

| # | Pain | Users / threads read | Quotes |
|---|---|---|---|
| S1 | Records: the fiat value at receipt, matching payments to invoices, proof for the accountant, bank or landlord | 7 / 6 | "our bookkeeper is losing their mind … downloading raw CSVs from block explorers" and "We have to log the exact historical USD cost basis in QuickBooks at the exact minute it arrives" ([u/Large-Move-1611, 2026-02-23](https://www.reddit.com/r/USDC/comments/1rcozt4/comment/o707akt/)); "how people are handling reconciliation when they're receiving USDC but still paying most expenses in USD" ([u/Still_Lunch_3374, 2026-09-06](https://www.reddit.com/r/USDC/comments/1w92nvp/comment/p87r6lk/)); "I'd need to convert them to EUR to be able to tackle everyday expenses and for accounting" ([u/InvestigatorKey5640, 2025-08-29](https://www.reddit.com/r/USDC/comments/1n39u8l/)); "Both the exchange and the bank will want to know where and why you got the USDC." ([u/trelayner, 2025-08-29](https://www.reddit.com/r/USDC/comments/1n39u8l/comment/nbdrfyz/)); "The biggest pain is always matching on-chain transactions to invoices because wallet addresses don't carry invoice metadata" ([u/Impressive-Dust5395, 2026-04-27](https://www.reddit.com/r/USDC/comments/1ssol7p/comment/oijgj9u/)); "My accountant got us to use Kryptos io, which has quickbooks integration" ([u/pdasigner, 2026-04-24](https://www.reddit.com/r/USDC/comments/1ssol7p/comment/ohzmuv7/)); "income in stablecoins (USDC) … How to Prove Crypto Income to Landlords?" ([u/LemonLikesArt, 2025-02-12](https://www.reddit.com/r/freelance/comments/1iny98s/)) |
| S2 | Cash-out to a local bank costs steps and fees | 5 / 5 | "Metamask > Coinbase > Bank to convert the USDC to cash. Of course I pay all the gas fees" ([u/HonestManTrying, 2025-01-01](https://www.reddit.com/r/USDC/comments/1hqs42d/)); "they charge 1.5 cents for each USDC I convert to Euros, which quickly adds up" ([u/fanboy_killer, 2024-06-27](https://www.reddit.com/r/USDC/comments/1dpuay5/)); "best option for converting to CAD$ and avoiding high fees" ([u/Willing-Philosopher7, 2024-02-12](https://www.reddit.com/r/USDC/comments/1ap8pr3/)); "accept USDC payments for my business and have it instantly settled to fiat (CAD)" ([u/Bawtyboy, 2025-12-03](https://www.reddit.com/r/USDC/comments/1pdj3zm/)); InvestigatorKey5640 above |
| S3 | Wrong token or network | 4 / 4 | "What if he sends in usdt" ([u/luckyrichi, 2026-09-14](https://www.reddit.com/r/USDC/comments/1wgadep/)); "my Coinbase USDC wallet will not accept the ERC-20 USDC" ([u/futbolpool, 2023-03-05](https://www.reddit.com/r/USDC/comments/11iyfkm/)); "USDT was just what the client preferred to pay me in" ([u/Dependent_Charge_713, 2026-08-10](https://www.reddit.com/r/USDC/comments/1vkny4q/)); "usdc sent to my PayPal on ethereum … they pretty much are dead ending me saying that the funds are just lost" ([u/titytatt, 2026-02-05](https://www.reddit.com/r/USDC/comments/1qwmtrq/comment/o3r4atu/)) |
| S4 | Fiat rails cost too much, which is why clients and freelancers switch | 4 / 4 | "exhausted by Stripe and PayPal fees … A client in the EU recently asked if they could just pay their next invoice in USDC" ([u/Overall_Ad9737, 2026-05-15](https://www.reddit.com/r/USDC/comments/1tdjcdd/)); "wire fees and 3day bank delays are ridiculous" ([u/Large-Move-1611, 2026-02-23](https://www.reddit.com/r/USDC/comments/1rcozt4/)); "You'll get your money faster with USDT instead of waiting for ACH" ([u/unituned, 2023-03-02](https://www.reddit.com/r/freelance/comments/11fzk9y/comment/jan6ab6/)); "I received €205 for my work, but Payoneer left me with €197 … another €8 withdrawal fee" ([Chukwunweike Nmakwe, Trustpilot, 2026-10-10](https://www.trustpilot.com/reviews/6aca2f3484b6655505bf9d36)) |

Evidence against, and what it means here: in r/freelance, being paid in crypto draws refusals. "Do not accept
payment in anything other than actual currency." ([u/borks_west_alone, score 17](https://www.reddit.com/r/freelance/comments/1i68fsr/comment/m8abt01/));
"If they can pay you in crypto, they can pay you in real money." ([u/DanzillaTheTerrible](https://www.reddit.com/r/freelance/comments/1i68fsr/comment/m8ad2pi/));
"Sorry, I only accept money." ([u/the-bright-one, 2023-03-02](https://www.reddit.com/r/freelance/comments/11fzk9y/comment/jamy4cv/)).
The cases that go well are clients who already pay in crypto: "it's a web3 design project, they prefer to pay in
crypto" ([u/Equivalent-Fee1174, 2025-01-21](https://www.reddit.com/r/freelance/comments/1i68fsr/comment/m8a700s/)).
These refusals are about the freelancer holding volatile coins or a client asking for a crypto-only deal. Forwend's
model answers part of it: the freelancer always receives a USD stablecoin, and a later payment provider lets a payer
without crypto pay by card, Apple Pay or Google Pay while USDC still arrives at the invoice. Until that provider
exists, the payer must already hold stablecoins, so today's users are freelancers whose clients already pay in
crypto. See [Card payers](#card-payers-paying-by-card-receiving-stablecoins) for what a card provider adds.

Low-star reviews of money tools (Trustpilot, page 1 of 1–3 stars, 2026-10-16) add the fiat side's holds and fees:
Payoneer verification "ongoing for almost 2 monthts … I can't recieve payments for my freelance activity"
([review](https://www.trustpilot.com/reviews/6acf82aed55e5d3904b78c4c)); Wise "2 days without access to my own funds"
([review](https://www.trustpilot.com/reviews/6ad1ded994a79c7e11068d46)); FreshBooks "customer payments … taking 5 to 10
days to reach our bank account" ([review](https://www.trustpilot.com/reviews/6a2960df6aee953402efefd5)) and card fees
"from 2.9% to 3.5%" ([review](https://www.trustpilot.com/reviews/6a72309f2266f1ce97a59819)). Request Finance has 12
Trustpilot reviews and none below 4 stars, so it gives no complaint evidence.

### Second pass: seven more subreddits

r/smallbusiness and r/Entrepreneur are mostly shop owners; only service providers (designers, developers,
consultants, agencies) are counted. Every quote was checked as an exact substring of the archived text.

| # | Pain | New users / threads | Quotes |
|---|---|---|---|
| P1, P5 | Late payment and chasing (confirms) | 8 / 5 | "I deliver projects on time (sometimes even early), but then clients take their sweet time paying me." ([u/Fit_Register2849, r/smallbusiness, 2024-11-24, score 420](https://www.reddit.com/r/smallbusiness/comments/1gyu8dr/)); "the headache of begging for payment is just not worth the hassle." ([u/Easterncoaster, 2026-08-09, score 79](https://www.reddit.com/r/smallbusiness/comments/1vjlz67/comment/p2msjsa/)); "I get paid late, I hate chasing invoices" ([u/datawazo, r/Entrepreneur, 2025-12-11](https://www.reddit.com/r/Entrepreneur/comments/1pjtqd9/comment/ntgc5wx/)); "I've spent far too much time chasing some of the external clients around for overdue invoices." ([u/_BigMacStack_, r/Upwork, 2025-02-15, score 54](https://www.reddit.com/r/Upwork/comments/1iprv02/)) |
| P6 | The client's finance team (confirms; now 13 users) | 7 / 5 | "the person I engage with and send my invoice to is rarely the person who pays it" ([u/carrie-wildstack, r/Entrepreneur, 2025-12-11](https://www.reddit.com/r/Entrepreneur/comments/1pjtqd9/comment/ntjy9dt/)); "if I'm a day late on my invoice I have to wait until the next batch goes out." ([u/Proper_Watercress_78, r/smallbusiness, 2026-08-09](https://www.reddit.com/r/smallbusiness/comments/1vjlz67/comment/p2mvhyk/)); "their AP portal quietly bins anything it can't match." ([u/akl773, 2026-08-31](https://www.reddit.com/r/smallbusiness/comments/1w33g2r/comment/p6y6jt3/)); "Some only cut checks twice or once a month." ([u/MsRachyBee, r/Entrepreneur, 2025-12-11](https://www.reddit.com/r/Entrepreneur/comments/1pjtqd9/comment/ntjcwmi/)) |
| P2, P4 | Final invoice unpaid; milestones as the fix (confirms) | 8 / 5 | "Site's done, looks great honestly, we send the invoice. Nothing. No response." ([u/Grouchy_Ad6228, r/smallbusiness, 2026-07-29](https://www.reddit.com/r/smallbusiness/comments/1va9tzn/)); "We started doing 30/40/30 splits (upfront, mid-project, final delivery) and it massively reduces exposure." ([u/jfranklynw, 2026-03-01](https://www.reddit.com/r/smallbusiness/comments/1ri2yhq/comment/o83gtv0/)); "we moved repeat accounts to a 50% deposit system" ([u/TopSydeWP, 2026-08-09, score 163](https://www.reddit.com/r/smallbusiness/comments/1vjlz67/comment/p2mjlld/)) |
| P9 | **New: card chargebacks after delivered and approved work** | 8 here + 3 in r/payments / 7 | "client loved the site, sent me a message saying looks perfect and then three weeks later disputed the charge." ([u/Steven-Leadblitz, r/smallbusiness, 2026-03-01](https://www.reddit.com/r/smallbusiness/comments/1ri2yhq/comment/o83gmy7/)); "Some clients use chargebacks as a negotiation tactic" ([u/Soft-Analyst-9452, 2026-03-02](https://www.reddit.com/r/smallbusiness/comments/1ri2yhq/comment/o860emr/)); "dispute the charges on his card (money was in escrow) with the bank and upwork took the $12k back from me" ([u/its_all_down-hill, r/Upwork, 2026-06-05](https://www.reddit.com/r/Upwork/comments/1twvgdl/comment/opvvjfo/)); "the bank/credit card companies always side the the customer regardless of proof" ([u/Rare_Analyst5671, r/smallbusiness, 2026-06-20](https://www.reddit.com/r/smallbusiness/comments/1u98tm3/comment/osohvnd/)); "I've learned the hard way and lost 20k +" ([u/Ornery_Recording3192, 2026-06-25](https://www.reddit.com/r/smallbusiness/comments/1u98tm3/comment/ots29zz/)) |
| P10 | **New: money frozen by a payment company or bank** | 8 / 6 | "This completely shut down my business as I couldn't access funds." ([u/Anica85, r/digitalnomad, 2026-04-22, score 428](https://www.reddit.com/r/digitalnomad/comments/1ssjy5m/)); "I currently have $50k+ USD held by them in a business account" ([u/RayRayLoL, 2025-12-10](https://www.reddit.com/r/digitalnomad/comments/1pi2kp4/comment/nt8p1ih/)); "they came and closed my account with the 60K in it" ([u/algrowl, 2026-02-02, score 145](https://www.reddit.com/r/digitalnomad/comments/1qu3oay/)); "I had about $10k stuck pending an ID check" ([u/Weird_Ad7634, 2025-12-09](https://www.reddit.com/r/digitalnomad/comments/1pi2kp4/comment/nt395db/)) |
| S5 | Freelancers in countries without PayPal take stablecoins; finding willing clients is the hard part | 7 / 4 | "paypal and other online payment platforms are banned in my country, so it's always easier to get paid in cryptocurrencies" ([u/Sylerb, r/freelanceWriters, 2023-01-11](https://www.reddit.com/r/freelanceWriters/comments/108ykzc/)); "The difficulty, however, is finding clients from other continents willing to pay in crypto." ([u/rv8n8, 2024-12-21](https://www.reddit.com/r/freelanceWriters/comments/1h5dbjp/comment/m357bk1/)); "Some clients pay me in crypto" ([u/Fit-Locksmith-9226, r/digitalnomad, 2026-04-22](https://www.reddit.com/r/digitalnomad/comments/1ssjy5m/comment/ohnbls0/)) |

Evidence against from the second pass:

- Automatic reminders: "I've turned off automatic reminder features." ([u/datawazo](https://www.reddit.com/r/Entrepreneur/comments/1pjtqd9/comment/ntgc5wx/));
  "I never send automated reminders about invoices." ([u/carrie-wildstack](https://www.reddit.com/r/Entrepreneur/comments/1pjtqd9/comment/ntjy9dt/)).
  This changes D-69 below.
- Advance payment loses some clients: "Offering worse terms such as your advice of advance payment, isn't going to
  win OP any additional clients." ([u/NotTheFakeJeff, r/smallbusiness, 2026-03-12](https://www.reddit.com/r/smallbusiness/comments/1rrmph2/comment/oa0z89b/));
  "you just have to deal with the net 30 or they'll find someone who doesn't charge interest." ([u/TheHoodedTurtle, 2026-09-22](https://www.reddit.com/r/smallbusiness/comments/1wnelf3/comment/pbesgv4/)).
  Net-30 invoices must work well (D-80), not only deposits.
- Large clients and crypto: "I require all invoices above 20k to be a wire transfer or ACH." ([u/Kamikazepyro9, score 21](https://www.reddit.com/r/smallbusiness/comments/1ri2yhq/comment/o83drky/));
  clients "want nothing to do with crypto and it's not allowed" ([u/Fit-Locksmith-9226](https://www.reddit.com/r/digitalnomad/comments/1ssjy5m/comment/ohnbls0/));
  "100% of my invoices are paid by bank transfer." ([u/Bimblelina, r/freelanceWriters](https://www.reddit.com/r/freelanceWriters/comments/15tuh93/comment/jwo72sa/)).
- Payment loss is rare for some: "I've worked over 14k hours on Upwork and have been paid for every minute of it"
  ([u/Pet-ra, r/Upwork, 2026-02-12](https://www.reddit.com/r/Upwork/comments/1r2bco8/comment/o4xxfnl/)).

What the second pass means: P9 and P10 are where stablecoins help most. A payment that arrived on-chain cannot be
charged back by the payer's bank, and no payment company sits between the receive address and the freelancer's
wallet. P5 (chasing) is real, but freelancers split on automating it.

### Jobs to be done

- When I agree a project, I want the client to accept the scope, price and payment schedule in writing, so I have a
  contract if they stop paying (P2, P3, NY §1412).
- When the client accepts, I want the deposit invoice to go out at once, so I don't start work for free (P3).
- When I finish a work step, I want its milestone invoice to go out, so the unpaid amount stays small (P4).
- When I send the final invoice, I want it to show what was already paid, so the client and their finance team see
  only the rest (P2, art. 220).
- When a client pays on net 30 or later, I want the money to still arrive into the invoice, so it is not held
  (P1, Forwend gap).
- When an invoice is overdue, I want something other than me to remind the client, so I don't have to chase (P5).
- When the client's finance team processes my invoice, I want it to carry their PO number and my tax details, so it
  is not sent back (P6, art. 226).
- When a stablecoin payment arrives, I want its USD or EUR value at that moment recorded against the invoice, so my
  accountant and bank accept it (S1, IRS A10, art. 91).

## Card payers: paying by card, receiving stablecoins

The owner's model: the freelancer always receives USDC; a later provider lets a payer without crypto pay by card,
Apple Pay or Google Pay. This is not phase 10 work (PLAN keeps "bank/card on-ramp" deferred), but it changes two
phase 10 choices, so the research checked it. Provider terms read 2026-10-16.

**The consumer on-ramps forbid this use.** They sell crypto to the cardholder for the cardholder's own wallet:

- Stripe Onramp: "you are the sole owner of the Crypto Wallet … You may not use the Onramp Services to buy
  cryptocurrencies for business purposes, or on behalf of any other person or entity."
  ([terms](https://stripe.com/legal/crypto-onramp)). Its docs say Stripe is merchant of record and "assumes full
  liability for all fraud and disputes" ([docs](https://docs.stripe.com/crypto/onramp)).
- MoonPay: "you represent and warrant that you own and control the Wallet"; unacceptable use includes payments that
  "are by payment processors to collect payments on behalf of merchants" ([US terms](https://www.moonpay.com/legal/terms_of_use_usa)).
- Crossmint takes cards, Apple Pay and Google Pay and carries chargeback liability, but asks for proof that the payer
  owns the receiving wallet above "$1,000" per transaction or 30-day volume, for users verified outside the US
  ([docs](https://docs.crossmint.com/onramp/guides/proof-of-ownership.md)).
- Ramp asks for a wallet "owned by you"; Coinbase's guest checkout is US-only with weekly limits; Transak, Banxa and
  Coinbase's full terms could not be read (403). Unconfirmed.

**The path the terms allow is a card acquirer, not an on-ramp:** a card processor takes the card payment with the
freelancer (or Forwend's platform) as the merchant, then the money is converted to USDC (for example Stripe's
stablecoin financial accounts, custodied by Bridge: [docs](https://docs.stripe.com/crypto/stablecoin-financial-accounts.md)).
Then the merchant, not the provider, carries chargebacks, and the processor may hold reserves:
"If this exists any amount would be under reserve for 180 days" ([u/UnderHost, r/payments, 2026-08-30](https://www.reddit.com/r/payments/comments/1w2a93v/comment/p6rkpom/)),
replying to "customers pay by card, I receive crypto" ([u/ExtremBarzi](https://www.reddit.com/r/payments/comments/1w2a93v/)).

**Chargebacks on delivered services are real (P9: 11 users in 7 threads; three from r/payments here):** "Delivered the photos
digitally, they downloaded the whole gallery … and then disputed the charge as not received"
([u/Frequent_Estimate_77, 2026-04-06](https://www.reddit.com/r/payments/comments/1sdqfda/comment/oenhwmg/));
"uses the service for nearly a month … file a chargeback for unauthorized transaction"
([u/Opposite-Chicken9486, 2026-05-18](https://www.reddit.com/r/payments/comments/1tgdg46/));
"Mine was 800, delivered and signed. Refunded by the bank and customer kept a custom made product."
([u/Ok-Needleworker-3486, 2026-04-07](https://www.reddit.com/r/payments/comments/1sdqfda/comment/oestdqb/)).
Account freezes are reported more often (about 8 users, mostly Stripe, mostly high-risk categories), e.g. a marketing
agency: "Both Stripe and PayPal recently shut down/restricted our accounts"
([u/Anxious-Golf6450, 2026-08-19](https://www.reddit.com/r/payments/comments/1vsrmne/)). On-ramp low-star reviews
(Trustpilot, 2026-10-16) most often report frozen funds and crypto charged but not delivered; quotes there were capped
at 125 characters by the fetch tool, so they are not used here.

What it changes for phase 10:

1. A stablecoin payment cannot be charged back; a card payment can. Once card payers exist, the job's records (quote
   accepted by name and time, each milestone invoiced and paid, delivery links) are the freelancer's dispute evidence.
   10.3 keeps those timestamps for that reason, though the separate work states stay cut.
2. Records (10.6) must tell a card-funded payment from an on-chain one, because only the first can be reversed.

r/payments itself gave little freelancer evidence: 700 posts, almost all from 2026, many by vendors; no first-hand
freelancer report of an unpaid invoice.

## Law: what an invoice must carry

Primary text, read 2026-10-16. The EU text is the copy on legislation.gov.uk (EU law as it stood on 2020-12-31);
later EU amendments, such as the 2025 e-invoicing package, are not checked here. EUR-Lex answered with an empty page.

| Rule (verbatim) | Source | What it means for phase 10 |
|---|---|---|
| An invoice is needed for "any payment on account made to him by another taxable person or non-taxable legal person before the provision of services was completed." | [VAT Directive art. 220(1)(5)](https://www.legislation.gov.uk/eudr/2006/112/article/220) | A deposit from an EU business needs its own invoice; the final invoice bills the rest. |
| Details include "a sequential number", "the customer's VAT identification number" when the customer is liable for the VAT, "the full name and address of the taxable person and of the customer", "the extent and nature of the services rendered", the supply date, and "the mention 'Reverse charge'" when the customer is liable. | [art. 226](https://www.legislation.gov.uk/eudr/2006/112/article/226) | Saved clients need a VAT/tax ID; invoices need a description of the work and a supply date. Forwend has the number (D-50) and the issuer's tax ID (R-43), but not the client's tax ID, line descriptions or a reverse-charge line. |
| "The amounts which appear on the invoice may be expressed in any currency, provided that the amount of VAT payable … is expressed in the national currency of the Member State, using the conversion rate mechanism provided for in Article 91." | [art. 230](https://www.legislation.gov.uk/eudr/2006/112/article/230) | A USDC invoice is lawful; any VAT must also show in EUR (or the national currency). |
| "Member States shall accept instead the use of the latest exchange rate published by the European Central Bank at the time the tax becomes chargeable." | [art. 91(2)](https://www.legislation.gov.uk/eudr/2006/112/article/91) | The ECB's free daily reference rates ([eurofxref-daily.xml](https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml), checked 2026-10-16) are a lawful source. No paid rate API is needed. |
| UK: amounts "can be expressed in any currency"; "the total amount of VAT chargeable — this must be expressed in sterling". | [HMRC VAT Notice 700, 16.3.1 and 16.4](https://www.gov.uk/guidance/vat-guide-notice-700) | Same as the EU. |
| Every UK invoice must include "a unique identification number", both parties' names and addresses, "a clear description of what you're charging for", the supply date, the invoice date and "the total amount owed". | [GOV.UK](https://www.gov.uk/invoicing-and-taking-payment-from-customers/invoices-what-they-must-include) | Line descriptions and a supply date are needed even without VAT. |
| The contract "shall be reduced to writing" and include "an itemization of all services", "the value of the services", "the rate and method of compensation" and "the date on which the hiring party must pay". Without a date, pay "no later than thirty days after the completion of the freelance worker's services". A violation of §1411 gives "double damages". | NY GBL [§1412](https://www.nysenate.gov/legislation/laws/GBS/1412), [§1411](https://www.nysenate.gov/legislation/laws/GBS/1411), [§1414](https://www.nysenate.gov/legislation/laws/GBS/1414) | An accepted quote with services, price, payment method and pay dates is the written contract NY asks for. NYC adds a $800 per 120 days threshold ([DCWP](https://www.nyc.gov/site/dca/workers/workersrights/freelancer-workers.page); the city code text could not be read). |
| "the fair market value of virtual currency received for services performed as an independent contractor, measured in U.S. dollars as of the date of receipt, constitutes self-employment income" | [IRS virtual currency FAQ, A10](https://www.irs.gov/individuals/international-taxpayers/frequently-asked-questions-on-virtual-currency-transactions) | Records need the USD value per payment at receipt, not per invoice. |

## Competitor teardown: quote → deposit → invoice → payment

| Step | Request Finance (crypto) | HoneyBook (fiat) | Bonsai (fiat) |
|---|---|---|---|
| Quote | No quote in the API docs | "Smart files": the client is "selecting services, paying, and signing all at once" ([help](https://help.honeybook.com/en/articles/5776807-the-differences-between-smart-files-and-legacy-files)) | "Client e-approval: Let your clients approve your proposals in just one click" ([proposals](https://www.hellobonsai.com/proposals)) |
| Deposit | Not found | A payment schedule inside the file; the total "must equal the total of all payments in the payment schedule"; autopay can be required ([help](https://help.honeybook.com/en/articles/8729489-invoice-troubleshooting-late-fees-and-common-scenarios-in-honeybook), [autopay](https://help.honeybook.com/en/articles/2209040-understanding-and-managing-autopay)) | "Deposit capture: Require a deposit when your client approves a proposal" ([proposals](https://www.hellobonsai.com/proposals)) |
| Invoice | "invoices can be denominated in USD, but buyers can pay in crypto"; buyer `taxRegistration`; `dueDate`; `recurringRule` ([API](https://docs.request.finance/invoices.md)) | "Purchase order (PO)" field; quantity, unit price, tax; recurring weekly, monthly or custom ([help](https://help.honeybook.com/en/articles/5189729-add-customize-and-share-invoices-in-honeybook)) | Branded invoices, custom fields, recurring billing ([invoicing](https://www.hellobonsai.com/invoicing)) |
| Client finance | The buyer can approve: "Approved invoices … indicate that the invoice has been accepted by you and is ready for payment"; or reject ([API](https://docs.request.finance/invoices.md)) | Client portal | Not found |
| Payment | Crypto detected automatically; an outside payment can be "declared paid" ([API](https://docs.request.finance/invoices.md)) | Card and ACH; card 2–3 business days, ACH 7–8 days ([help](https://help.honeybook.com/en/articles/2209043-payment-statuses-processing-times)) | "2.9% + $0.30" card, ACH "as low as 1%" ([invoicing](https://www.hellobonsai.com/invoicing)) |
| Reminders | `overdue` status; no reminder in the API docs | Automatic and on by default once booked; "Only one payment reminder can be sent per day"; late fees capped at 10% ([help](https://help.honeybook.com/en/articles/2209077-send-manual-or-automatic-payment-reminders-in-honeybook)) | "Automatically send payment reminders to clients for overdue invoices" ([invoicing](https://www.hellobonsai.com/invoicing)) |
| Records | Xero sync (user review on [Trustpilot](https://www.trustpilot.com/review/request.finance)) | CSV for "your bookkeeper", QuickBooks | Two-way QuickBooks and Xero sync |

Shared by all three, so expected by users: the client accepts something before money moves; the deposit is part of
that acceptance; invoices recur; reminders are automatic. Only the crypto tool has a fiat-denominated invoice paid in
a stablecoin and a buyer-side approve step. Bonsai's public feature board
([hellobonsai.canny.io](https://hellobonsai.canny.io/feature-requests?sort=top)) is mostly project management; its
top payment request is "Have different payment settings for invoices, allow for invoice templates" (14 votes).

Blocked: help.request.finance, request.finance, help.hellobonsai.com, G2 and Capterra answer 403 to automated reads.

## Proposed phase 10

Gate, changed: one freelancer runs quote → accepted → deposit → milestone → final invoice paid on testnet; the
final invoice shows the deposit and milestone already paid; the records export matches the chain for every payment.

| Now | Verdict | Proposed item | Reason and evidence |
|---|---|---|---|
| 10.1 Saved clients | **Keep, deepen** | **10.1 Clients.** Saved clients with legal name, billing email (the finance contact), address, country, tax/VAT ID and an optional default PO or reference. An invoice copies them and the copy never changes, like the issuer block (R-43). | P6; art. 226(4)–(5); HoneyBook's PO field |
| 10.2 Line items, duplicate, agreed value | **Change** | **10.2 Invoice terms.** Line items with a description; supply date; PO/reference; the fiat "agreed value" the user types (as now planned); duplicate. New: an invoice with a due date keeps its checkout open until at least the due date plus 60 days, and the form warns before saving an earlier close. | Forwend gap; P1; art. 226(6)–(7), art. 230; GOV.UK list |
| 10.3 Recurring retainers | **Keep** | **10.4 Retainers.** As planned (D-58), plus: each cycle's invoice is created and emailed before the period starts, with the due date at its start, and its checkout follows 10.2. | Retainer pain: "how far in advance do you send your retainer invoices?" ([u/New_Beat3329](https://www.reddit.com/r/freelance/comments/114k2h2/)); competitors all recur |
| 10.4 Jobs | **Merge with 10.5** | **10.3 Jobs.** A quote lists the work, price and a payment schedule (deposit, milestones, final) with pay dates. The client accepts it on its page with a typed name and email; the time is kept. Acceptance issues the deposit invoice. Each milestone invoice goes out when the freelancer marks the step done. The final invoice lists every earlier payment and bills the rest. A change in scope is a new milestone the client accepts the same way. The job keeps a dated record of acceptance, each invoice, each payment and each delivery link: the freelancer's evidence in a dispute. | P2, P3, P4, P7, P9; art. 220(1)(5); NY §1412; Bonsai and HoneyBook |
| 10.5 Shared work page | **Cut, merged into 10.3** | Keep only the quote acceptance, the job's invoice list and the dated record on the page. Cut the separate work states (in progress, delivered, changes requested, approved). | P8 has one source; payment needs only "accepted", "milestone invoiced" and "paid" |
| 10.6 Action list | **Merge with 10.7** | **10.5 Getting paid on time.** "Send to client" emails the invoice to the client's billing email. An "Owed to you" list shows overdue (days past due), partly paid and held money. Reminders: see C below. | P1, P5, P6 |
| 10.7 Reminders | **Change, merged** | (in 10.5) | P5; freelancers split on automatic reminders, so the freelancer chooses |
| 10.8 Records | **Keep, deepen** | **10.6 Records.** Each payment keeps time, token, network, transaction, invoice and client, and its USD value at receipt (1 USD per USD stablecoin, D-75). A profile can add EUR, GBP or another ECB currency: the value at that day's ECB reference rate. CSV export with a classification column; "own transfer" and "Unclassified" labels as planned; a payment statement PDF as proof of income. | S1; IRS A10; art. 91(2) |

Not in phase 10, but the evidence moves it up: cash-out to a bank (S2) is the stablecoin users' second pain after
records. Phase 12.5 holds it; the owner may want to bring it forward. Wrong token or network (S3) is mostly covered by
phase 9 (R-78) and payer-chooses invoices (D-75).

Considered and left out: late fees (freelancers write them in contracts but rarely charge them: "I never charge
those late fees even if they are late" — [u/FuseFuseboy](https://www.reddit.com/r/freelance/comments/1fz4aeo/comment/lr007pf/); a fixed
stablecoin amount cannot grow without a new invoice); a client-side approve step like Request Finance's (no Reddit
evidence); file delivery (D-66 already defers it).

## PROJECT decision rows

Approved 2026-10-16 and moved to PROJECT.md: A is D-80, B is D-81, C rewrote D-69, D is D-82.

| Proposal | Decision | Reason |
|---|---|---|
| A | An invoice with a due date keeps its checkout open until at least the due date plus 60 days (within D-18's 365-day limit). The form warns before saving an earlier close. Without a due date, today's default stays. | Net 30 often becomes 45–60+ days (P1); money after close is held (D-26) and refunds wait for 11.10. |
| B | A job is a quote the client accepts (typed name, email, time) with a payment schedule; each scheduled payment is a normal invoice with its own receive address (D-22); the final invoice lists earlier payments and bills the rest. | P2–P4; art. 220(1)(5); NY §1412. Keeps one payment per address. |
| C | Replaces D-69 (owner decides): the freelancer turns reminders on per client or per invoice (off by default); the client does not have to opt in. At most 3 (before the due date, on it, 7 days after), each with a one-click stop for the recipient. | P5 (14 users hate chasing); two freelancers turn automatic reminders off on purpose, so the freelancer chooses; HoneyBook and Bonsai default on. D-69's client opt-in would leave the feature nearly unused. An invoice reminder to a business's billing contact is a transactional email, but this needs a legal check before launch. |
| D | Records value each payment at receipt: USD at 1 per USD stablecoin (D-75); other currencies at the ECB reference rate of that day. No paid exchange-rate API. | IRS A10; art. 91(2); S1. |

D-55 needs no change for phase 10. The payer-by-card provider widens the audience later; its decision belongs with
that provider's spike, not here.

## Questions added to owner research

For 5–10 freelancers paid in stablecoins (now in [owner research](../owner-research.md)):

6. Your last late payment: what terms, how many days late, and what did you do?
7. Do you take a deposit? What share? Has a client refused it, and did you lose the client?
8. Which steps did a client's finance team ask for: vendor form, W-9 or W-8BEN, PO number, portal, approval? Did any
   delay payment?
9. Who reminds clients today, you or a tool? Would you let a tool email your client's finance contact on its own?
10. How do you record a stablecoin payment's USD or EUR value, and what did your accountant, bank or exchange ask for?
11. Here is the job flow (quote → deposit → milestones → final). Would you use it with your next client? What would
    stop you?

For 2–3 people who approve or pay vendor invoices (a client's finance side):

1. What must a contractor invoice show before you can pay it?
2. Could your team pay an invoice in USDC? Who would have to approve that, and what would they need to see?
3. Would an automatic reminder from a contractor's invoicing tool help you, or annoy you?

## Metrics after release

| Metric | Why |
|---|---|
| Days from invoice sent to paid: median and 90th percentile | P1 |
| Share of invoices paid by the due date | P1, P5 |
| Share of invoices whose money arrived after checkout closed (target 0) | D-80 |
| Share of jobs whose deposit was paid before the first milestone was invoiced | P3 |
| Share of final invoices paid within 30 days of being sent | P2 |
| Reminders sent per paid invoice, and stop clicks per reminder | P5, D-69 |
| Share of payments with a recorded fiat value that matches the chain | S1 |

## Check

Below the 3-source rule:

- P8, a review and sign-off link: 1 user. This is why 10.5 is cut.
- Wanting reminders automated: 1 Reddit user for (u/sf8as), 2 against, plus two competitors' defaults. The pain of
  chasing (P5) has 14 users; the specific fix is split, which is why D-69 leaves it to the freelancer.
- A PO field: competitor evidence (HoneyBook) and 1 Reddit mention of purchase orders. The finance-side interviews
  should confirm it.
- A client-side approve step: no Reddit evidence; left out.
- Money and time figures from the keyword pass are examples from a small number of posts.

Still needs confirmation:

- **Owner interviews:** deposit share and refusals (interview question 7), reminder default (D-69, question 9), whether the job flow fits real
  clients (question 11), records needs per country (question 10).
- **A client's finance person:** required invoice fields, PO numbers, whether they can pay in USDC at all. No Reddit
  source shows a company finance team paying a freelancer in USDC; the stablecoin payers in the data are founders or
  small businesses.
- **Legal:** D-69 (reminder emails without opt-in) and the EU text after 2020.

Coverage limits: r/freelance titles are complete only to 2025-03-24; about 84% of r/freelance post bodies are
removed by moderators, so most voices come from comments. The second pass covered r/Upwork, r/smallbusiness,
r/digitalnomad, r/Entrepreneur, r/freelanceWriters and r/webdev by title search only (60 posts per search), and
r/payments only for 2026; r/graphic_design returned 1 post, and r/CryptoCurrency and r/Bookkeeping were not
collected. No thread mentions W-9 or W-8BEN in the second pass, and records evidence outside r/USDC is thin. The
r/tax posts found were about trading, not freelance income.
