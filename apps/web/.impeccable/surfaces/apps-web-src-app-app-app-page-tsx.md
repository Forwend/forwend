---
version: 1
slug: "apps-web-src-app-app-app-page-tsx"
primary_target: "apps/web/src/app/(app)/app/page.tsx"
related_targets: ["apps/web/src/screens/dashboard","apps/web/src/screens/app-shell","apps/web/src/screens/transactions","apps/web/src/features","apps/web/src/app/(app)/app"]
---

# Signed-in app surface brief

Scope: `/app` shell (sidebar, header, phone top bar and tab bar), the personal overview, the business overview
(merchant and freelancer), `/app/transactions`, `/app/balances`, `/app/activity`, `/app/profiles/new`. Operate mode.
Audience: a signed-in person with one or more profiles (personal, freelancer, merchant) holding stablecoins on several
chains. Task: see how much they have and how it moved, receive money, read transactions, switch or add profiles;
business profiles also read what came in over a period. Send, transfer and withdraw stay shown and disabled until built.
Constraints: no fake data or features; every amount says its token and network; testnet only today.

Owner pins (2026-10-10, redesign after rejecting F071's look): an advanced app dashboard, not a landing page.
References: Revolut mobile home (centered balance, round actions, cards below, bottom tabs), Linear-like workspace
sidebar with grouped nav and a "Dark mode" switch row, a top header (breadcrumb, search, notifications, actions,
references with 8px-ish content gutters, not a centered narrow column), a fintech overview with total balance on the
left and a line chart on the right, a landscape image banner behind it (generated with Codex), Stripe-like business
overview with KPI row, chart and a payments table. Merchant/freelancer UI differs from personal. One theme control
only. No wallet address under the profile name. Header items chosen: breadcrumb + title, ⌘K search, Send/Receive,
notifications bell.

## Direction contract

THESIS: A working money console, not a showcase: the frame (sidebar, header) is dense and quiet like a workspace tool,
and the only image is the dawn sky the balance line is drawn across. Refuses the stack of same-size rounded cards with a
centered narrow column, and refuses the crypto-wallet screen (address and QR as the headline).

OWN-WORLD: Dawn Path product register, tightened: cool neutral grounds, pine ink, hairline dividers instead of
floating cards where data lives (KPI strip and tables are ruled, not boxed), radius md on panels, sm on controls.
Hanken Grotesk semibold for headline figures (proportional), Geist Mono tabular for table amounts, addresses, hashes
and axis ticks. River blue for focus, links and the chart's live point only. Codex dawn/night valley banner only
behind the balance hero.

STORY: They open the app, read the total and how it moved over the chosen range at a glance, press Receive in the
header or the hero, scan the latest transactions, and switch to their merchant profile from the sidebar top, where the
page becomes a business console: received this period, payment count, pending, a received-per-day chart and the
payments table.

FIRST VIEWPORT: Desktop: 15rem sidebar (logo + collapse; profile switcher; grouped nav; bottom: Dark mode switch row,
account row). 56px header: breadcrumb "Profile / Page" left; ⌘K search field, bell, Receive (filled) and Send
(outlined, disabled with reason) right. Content gutter 24px, max 1440px. Personal: full-width hero panel with the
valley banner, balance block left (label, figure, change over range, pill actions), line chart right with range tabs
and crosshair; below, transactions table (2fr) beside "Where your money is" networks list and in/out this month (1fr).
Business: title row with range tabs and Export CSV, ruled KPI strip (Balance, Received, Payments, Pending), received
bars chart beside balance-by-network, payments table with All/In/Out and search. Phone: top bar (account avatar,
search pill, bell), centered balance over the banner with a profile pill, four round actions, cards for recent
transactions and money in this month, bottom tabs Home, Transactions, Balances, Profiles.

FORM: Brief-pinned by the owner with reference images, so no concept roll; code-led. No seed key: no roll ran.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
