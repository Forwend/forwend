---
version: 1
slug: "apps-web-src-app-app-app-page-tsx"
primary_target: "apps/web/src/app/(app)/app/page.tsx"
related_targets: ["apps/web/src/components/app","apps/web/src/app/(app)/app"]
---

# Signed-in app surface brief

Scope: `/app` shell and the personal dashboard (Operate), plus `/app/balances`, `/app/activity`, `/app/profiles/new`.
Audience: a signed-in person with one or more profiles (personal, freelancer, merchant) holding stablecoins on several
chains. Task: see what they have and where, receive money, switch or add profiles; later send, transfer between
profiles and withdraw to a bank (shown, disabled until built). Constraints: no fake data or features; every amount
says its token and network; money in Geist Mono tabular; testnet only today.
Owner pinned: a fintech sidebar (references: Linear-like workspace sidebar, neobank dashboards), a profile switcher at
the sidebar top that opens a smooth panel to switch or add, the account at the sidebar bottom opening global settings,
a dashboard led by a total balance card with actions, balances by chain and token, activity; a bottom tab bar on phones.

## Direction contract

THESIS: One account, several money identities: the profile is the frame of everything, switched in place like a workspace; the page answers "how much, where, and what can I do" in that order. Refuses the stock crypto-wallet screen (QR card first, tables of zeros).

OWN-WORLD: Dawn Path product register: cool neutral surfaces, pine-ink type and primary pills, river blue only for focus and links, solid panels with soft shadows, Libre Caslon only for the one big amount heading, Hanken UI, Geist Mono for every amount and address. Sidebar on surface with hairline divider; cards rounded-lg; action buttons as round icon pills with labels underneath.

STORY: They land, see their total (estimated, marked) and per-network balances, tap Receive to get the full address with QR and the exact network and token, check recent activity, switch to another profile from the sidebar top without leaving the page.

FIRST VIEWPORT: Desktop: 16rem sidebar (switcher top, nav middle, account bottom); main shows a wide balance card (amount at display size, pending/held lines when present, four round actions: Send, Receive, Transfer, Withdraw) beside a Networks card listing each chain and token with its amount; below, Recent activity with View all. Phone: compact header (switcher, account), balance card and actions first, networks, activity, bottom tab bar Home, Balances, Receive (center), Activity, Account.

FORM: Brief-pinned by the owner, so no concept roll (a user-pinned direction beats the roll); code-led. Owner pin, verbatim: "i liked with sidebar more ... sidebar something like this ... where account info on the bottom of sidebar with everything else, and when i click it will component with global settings ... we can use selector where we can click and it will open such smooth component where we can add or switch between. this kind of UI/UX i wanna." No seed key: no roll ran.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
