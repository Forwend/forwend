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
  panel from small screens up. Both are solid surface panels with the float shadow and rise from the edge they open
  on; reduced motion removes the movement.
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
- Business overview (merchant, freelancer): title and range control, a ruled figure strip, received-per-day bars,
  networks and money flow, then the payments table with direction filter, search and CSV export.
- Charts: one ink line (or ink bars) with a faint wash, a few hairline grid lines, round tick values from zero.
  The river blue marks the latest or chosen point. Pointer or arrow keys show a readout; a hidden table gives screen
  readers every value. Range choice is a segmented control.
- Invoices and Activity: a status filter (All, Open, Paid, Settled, Expired) and a search over the loaded rows; a row
  opens its invoice. A transaction hash links to the chain's block explorer in a new tab (Transactions, Activity,
  invoice detail, pay page).
- Transactions table: ruled table from medium screens; the network has its own column only on the widest screens and
  sits under the counterparty otherwise. Phone rows show the network first and cut the time, never the network.
- First run (planned, not built): one "What do you want to do?" screen with four choice cards (any number) and Skip,
  shown once after the first sign-in.
- Onboarding checklist (planned, not built): a card on the overview listing the profile's steps, each done or not
  from real data, with a link to the step; it hides when every step is done or the user closes it.
- Money actions are round icon buttons with the label underneath, on desktop and phones; only working actions are
  filled with the primary ink. In the header, Send is a dashed outline pill in the subtle color until it is built.
- Personal overview actions: Receive, Request, Send, Transfer, Withdraw, in one row with a narrow gap on phones.
  Request (also in ⌘K) opens a sheet with amount, note, checkout expiry and the name the payer sees, then the pay link
  with Copy and View request. A personal profile's invoices are Requests in the sidebar, list and breadcrumb.
- A feature that is not built yet keeps its place in the subtle text color, with "Soon" as plain text at the end:
  no badge, no link. A disabled action says why in its accessible name and shows "Coming soon" in a tooltip on
  hover or focus; no notice text is added to the page.

## Checkout

- `/pay/<id>` is one centered column on every width: logo, the issuer name as the one display-serif heading over the
  invoice number and title (a request without an issuer: "Name requests 12.50 USDC" over "Request INV-0001"), then
  solid hairline panels: the amount (Geist Mono, featured amount size) with token mark
  and status pill, before-you-pay notes, the network confirm button, the send panel with wallet and exchange tabs (QR
  beside the full address from small screens up), and the status timeline with each payment received (amount, status,
  transaction and explorer link). No image and no glass; it follows the system theme.
- While a payment confirms, the timeline's step fills as blocks pass (a sweep until the first block passes) and the
  status line stays short: "Confirming · about 19 min left", the blocks left smaller beside it. The invoice detail uses
  the same timeline, line and payments, and no status pill: the timeline carries the status.

## Theme and behavior

- Apply the saved theme, otherwise the system choice, before first paint using `data-theme` on `<html>`.
  Product sections can force dark with their own `data-theme="dark"`. Use the theme variant for theme-only differences.
- Status changes keep row geometry stable. Labels accompany status colors. Mark all demonstration data as Sample.
- Use motion tokens; respect reduced motion. No scroll hijacking or layout jumps during state changes.
- Target WCAG 2.2 AA, including text contrast, keyboard access and accessible status announcements.
- Keyboard focus stays visible. Errors identify the field and explain the correction; loading and success states are
  accessible to screen readers. Copy controls confirm successful copying and handle unavailable clipboard access.
- Responsive behavior, accessibility and money formatting have tests. Review composition and typography in screenshots.

Product wording: [PRODUCT.md](PRODUCT.md). Code rules: [rules.md](rules.md). Image prompts: [images.md](images.md).
