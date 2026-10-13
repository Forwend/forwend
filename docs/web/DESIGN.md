# Design

Direction: Dawn Path marketing, dark Dusk Ledger product bands, Halftone Horizon texture (PROJECT D-13).
Use `/kit` for the implemented components. This file owns visual use; token source owns values:
[colors and sizes](../../packages/design-tokens/src/tokens.css), [themes](../../packages/design-tokens/src/theme.css),
[base styles](../../packages/design-tokens/src/base.css). Do not copy token values into documentation.

## Composition

- Dawn landscape with an open sky and a path toward the horizon. Center the serif headline in the upper third;
  keep badges, logos and metrics out of the sky. Sample invoice sits low over the river.
- Hero, dark checkout showcase and closing call-to-action run edge to edge, without inset corners.
- Regular section headings align left; hero and final call-to-action center. Fees and FAQ split at desktop widths.
- Step sequences form one connected path, horizontal on wide screens and vertical on phones.
- Light/dark hero images share their composition. Footer ridges and halftone dots use art tokens; paper grain is light-only.
- Glass sits over landscape art; floating navigation is the exception. Elsewhere use solid panels and soft shadows.
- On phones the floating navigation keeps its section links behind a menu button (a native popover).

## Type and color

- Libre Caslon Display at 400 for large headings; Hanken Grotesk for UI and body; Geist Mono for money, addresses,
  hashes and event names. Money uses tabular figures. In the app, headline figures (the total balance and the
  overview figure strip) use Hanken Grotesk semibold with proportional figures; table amounts, addresses, hashes and
  chart ticks stay Geist Mono with tabular figures. No bold display serif or small serif labels.
- Use role tokens for hero, section headings and featured amounts. No eyebrow labels or tracked uppercase kickers.
- Text and primary buttons share the primary ink. River blue identifies links, focus, the current step and information.
  Completed steps use ink; upcoming steps use line color.
- Success, warning and error use their matching text/background token pairs. Art colors never become UI colors.
- Detected and confirming are pending: a neutral status pill with a turning icon, never the information blue or a
  success color. Only confirmed, paid and settled look done.
- Cool neutral surfaces, rounded controls and cards, pill navigation/buttons/chips. No hard offset shadows.

## App shell

The signed-in app (`/app`) uses these patterns. Menu, sheet, action button, segmented control and switch are in `/kit`.

- Desktop: a fixed full-height sidebar on the surface color with a line divider; it stays in view while the page
  scrolls. From top: one row with the logo mark, a slash and the profile switcher (name only, no wallet address);
  page links in named groups for the profile type (the current page on the second surface); the account menu at the
  bottom.
  The collapse button sits at the start of the header. Collapsed, the sidebar is an icon rail with the profile tile on
  top and names as tooltips; the choice is remembered in the browser.
  Switching a profile keeps the current page.
- Desktop header: a sticky bar across the content. Breadcrumb of links (profile, page, then the invoice number or the
  form under the page) on the left; on the right a search field with the ⌘K hint, notifications, then Send and
  Receive. Content uses the header's side padding, with no maximum width, so its edges line up with the header.
- On desktop a page does not repeat the breadcrumb's last step as a visible heading; its h1 is for screen readers
  only. Phones have no breadcrumb, so they show the h1 (and a back link on an invoice). Page actions, status filters
  and search sit in one slim toolbar row at the top.
- ⌘K (or the search field) opens one command dialog: pages, actions, other profiles and recent transactions,
  filtered as you type. Arrow keys move, Enter opens, Escape closes.
- The account menu holds the app's one theme control, a Dark mode switch item, on desktop and phones.
- Phones: the header becomes a top bar with the account initial, a search pill and notifications. A bottom tab bar has Home, Transactions, Balances and Profiles (Profiles
  opens the profile sheet); icon over label, the current tab's icon on the second surface. Pages show the active
  profile as a pill that opens the same sheet.
- A choice opened from the sidebar is a menu; the same choice on a phone is a bottom sheet, which becomes a centered
  panel from small screens up. Both are solid surface panels with the float shadow. Menus rise from the edge they
  open on and the phone sheet slides up from the screen edge; the centered panel appears without motion. Reduced
  motion removes the movement. Behind a modal the page darkens with the `scrim` token in both themes.
- Panels are solid surface with a hairline border, medium corners and no shadow; a panel's header row is ruled off.
  Figure strips and tables use hairline rules between cells and rows, not separate cards.
- Totals across tokens (the total balance, its chart, the business figures, money in and out) are in USD, each
  stablecoin counted as 1 USD. An info icon after "USD" marks the estimate and explains it in a tooltip. A row for one
  token keeps its symbol.
- Personal overview: the dawn (night in dark mode) valley image is the page's one image moment. A surface wash keeps
  the total, its change over the range and the money actions readable over the sky. In light mode, mute the image
  and strengthen the pale wash toward the bottom so action labels and chart ticks need no text outline. On desktop the card keeps the
  4:1 shape within a minimum and maximum height: the total sits at the top left, the round actions at the
  bottom left, and the chart fills the right side. The total scales with its column (container units). Phones center
  the total and put the chart in its own panel below. The card has one padding on all sides.
- Business overview (merchant, freelancer, R-63): a Summary panel whose ruled header names the range and holds the
  range control, over one figure grid (Balance today, Received, Sent, On its way); then the Received chart (its header
  counts the payments in) beside Balances by network, both stretched to one height; then the latest payments with View
  all. Filters, search and CSV export live on Transactions. A range with nothing received says so in place of an empty
  chart.
- Charts: one ink line (or ink bars) with a faint wash, a few hairline grid lines, round tick values from zero.
  The river blue marks the latest or chosen point. Pointer, tap or arrow keys show a readout; only keyboard moves are
  announced, and a hidden table gives screen readers every value. Range choice is a segmented control. Received bars
  group into weeks or months when a day would be too thin to see or touch. On phones the balance chart keeps its top
  tick and its first and last dates. A failed figure shows "—" with Try again, never an endless skeleton.
- Invoices and Activity: a status filter (All, Open, Paid, Settled, Expired) and a search; a row opens its invoice.
  Transactions has a direction filter (All, In, Out) and a search. The API filters and searches the whole list, and the
  URL keeps both. A confirmed transfer shows its status as plain text; only one still confirming gets a pill. A filter or search with no rows says nothing matched, with a button to clear them. A transaction hash links to the chain's block explorer in a new tab (Transactions, Activity,
  invoice detail, pay page).
- Transactions table: ruled table from medium screens; the network has its own column only on the widest screens and
  sits under the counterparty otherwise. Phone rows show the network and the time on lines of their own, so neither is cut.
- First run: while `/v1/me` has no `onboardedAt`, `/app` shows one standalone screen instead of the shell: the logo,
  "What do you want to do?" in the display serif, four choice cards (checkboxes, any number; two columns from small
  screens up) with an icon, a hint and the profile each one adds, then Continue and Skip for now. Continue with nothing
  picked is Skip. Afterwards the app opens on the overview of the new freelancer profile, else the new merchant, else
  the personal one (D-73).
- Onboarding checklist: a "Get started" panel on the personal overview (under the balance card) and the freelancer
  overview (above the figure strip), with "n of m done" and a close button in its ruled header. Each step is a row
  with a round mark (filled ink with a check when done), title and hint (a done step shows its title only); a step not done has its action (secondary
  button or link) and Skip. Steps come from data: passkey linked, billing details (freelancer), first invoice or
  request, first paid in full, first final money in. Skipped steps and the closed card are remembered per profile in
  the browser; the card hides when closed or when every step left is done.
- Money actions are round icon buttons with the label underneath, on desktop and phones; only working actions are
  filled with the primary ink. In the header, Send is a dashed outline pill in the subtle color until it is built.
- Personal overview actions: Receive, Request, Send, Transfer, Withdraw, in one row with a narrow gap on phones.
  Request (also in ⌘K) opens the Request money page (R-71) with amount, note, checkout expiry and the name the payer
  sees, then opens the new request with its pay link. A personal profile's invoices are Requests in the sidebar, list
  and breadcrumb.
- A feature that is not built yet keeps its place in the subtle text color, with "Soon" as plain text at the end:
  no badge, no link. A disabled action says why in its accessible name and shows "Coming soon" in a tooltip on
  hover, focus or tap; no notice text is added to the page.
- A toast is only for an event the user did not just do on that spot: a payment detected or settled while the app is
  open, or a save that leaves the page (billing details). Errors and anything that needs an answer stay inline beside
  their field or form. Toasts sit top right on desktop and above the tab bar on phones, as solid surface panels with
  the float shadow; at most three, each gone after 5 s unless hovered, focused or the tab is hidden, with a close
  button. They enter from the edge they sit on and leave faster than they came. Screen readers hear them through a
  polite live region.

## Checkout

- `/pay/<id>` (R-68) is one short screen: the logo (links home), then on wide screens the invoice on the left and how
  to pay on the right, one column on phones. Left: the payee name (no display serif), "Invoice INV-0001 · title" with
  a small PDF link, the amount (Geist Mono, featured size; USD until the payer picks), "on <network>", the due date,
  "Closes in …" and the note. Right: one panel. While money is due it holds Pay with (the one option as a token mark,
  or Network and Token selects, which scale to many chains and tokens), a Show address button, then the QR beside the
  address and the exact amount, each with Copy (on phones Copy comes before the QR), one warning line "Send only USDC
  on Base Sepolia." and one exchange-fee hint. Under it one status line with a pulsing dot while pending: "Waiting for
  payment…", "Payment received · Confirming (n/m) · about X left", "Payment received · final check", partly paid with
  what is left, or closed; Check status sits under the waiting line and says when the next check is allowed. Paid
  replaces the panel with a check that scales in, "Paid", the amount, payee and time, View transaction, Download
  receipt and Back to <host> when the invoice has a return link. The payer never sees Settled, a timeline, status
  pills or testnet notes. The rules (where you are, refunds, scams, the unverified name) sit behind "Need help?". The
  footer is one quiet line, "Payments by" with the mark and Forwend, opening the site in a new tab.
- No image and no glass; it follows the system theme. When a refresh fails the page keeps the last read and says it
  may be out of date. The invoice PDF link stays in every state; the receipt link appears once paid.
- PDFs open through the same-origin `/api` path. The invoice detail lists them under Documents: the invoice PDF
  always, the receipt PDF once paid.
- While a payment confirms, the timeline's step fills as blocks pass (a sweep until the first block passes) and the
  status line stays short: "Confirming (4/12) · about 19 min left", blocks passed of the most left seen on the page.
  The step that waits always moves, so it never reads as stuck: a sweep while waiting for payment or while the money
  is on its way to the wallet (Settled), a fill by the share received when partly paid (R-69).
- The invoice page (R-60) says its state at once: a header with the title, one status pill and when it closes, closed,
  was paid or settled (a paid invoice never shows its close time). Below, two columns from large screens up: the
  amount ("Received X of Y" under it when partly paid) with the timeline, where the Paid step reads "Partially paid"
  as a warning-tinted label when partly paid, the status line (only the confirming count or why settling waits; the
  state itself is the pill's), the payments (amount, sender, time and hash, no status pill of their own) and Check
  status until paid; beside it the pay link as one row (host and short id, Copy, Open in a new tab; only while the checkout can
  take money), the details (empty ones left out), Billed to, and From (or "None on this invoice" with a link to add
  billing details).

## Theme and behavior

- Apply the saved theme, otherwise the system choice, before first paint using `data-theme` on `<html>`.
  Product sections can force dark with their own `data-theme="dark"`. Use the theme variant for theme-only differences.
- A loading button shows only a centered spinner, at its own size and colors, and keeps its accessible name.
- Status changes keep row geometry stable. Labels accompany status colors. Mark all demonstration data as Sample.
- Use motion tokens; respect reduced motion. No scroll hijacking or layout jumps during state changes. Loading
  spinners (`data-motion="essential"`) keep turning under reduced motion; everything else stops. Buttons do not
  shrink on press. The ⌘K dialog opens with no animation: it is opened by keyboard many times a day.
- Touch targets are at least 44px on touch screens; small controls keep their look and grow only their hit area.
- Target WCAG 2.2 AA, including text contrast, keyboard access and accessible status announcements.
- Keyboard focus stays visible. Errors identify the field and explain the correction; loading and success states are
  accessible to screen readers. Copy controls confirm successful copying and handle unavailable clipboard access.
- Responsive behavior, accessibility and money formatting have tests. Review composition and typography in screenshots.

Product wording: [PRODUCT.md](PRODUCT.md). Code rules: [rules.md](rules.md). Image prompts: [images.md](images.md).
