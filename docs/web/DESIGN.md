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
- Planned networks and stablecoins: one row on wide screens, an equal share each with a line between neighbours;
  narrower, one row that drifts sideways in a loop with fading ends (paused under a pointer; reduced motion leaves a
  still row to swipe). Network and token names share the UI face.
- The sample cards (hero invoice, checkout showcase) keep their timelines side by side, and the checkout's sample QR
  sits beside the address at every width, as on the real checkout.

## Type and color

- Libre Caslon Display at 400 for the landing's large headings; Geist for sign-in, first run, UI, body and money;
  Geist Mono only for addresses, hashes, contract links, raw base units, keyboard hints and code. Money is Geist with
  tabular figures everywhere (medium weight in rows, semibold for headline figures), so amounts read like a statement,
  not like code. No bold display serif or small serif labels.
- Use role tokens for hero, section headings and featured amounts. No eyebrow labels or tracked uppercase kickers.
- Text and primary buttons share the primary ink. River blue identifies links, the focus outline of buttons and links,
  the current step and information; fields focus with an ink border instead (below).
  Completed steps use ink; upcoming steps use line color.
- Success, warning and error use their matching text/background token pairs. Art colors never become UI colors.
- Detected and confirming are pending: a neutral status badge with a turning icon, never the information blue or a
  success color. Only confirmed, paid and settled look done.
- Cool neutral surfaces with a faint green tint, soft hairlines, rounded controls and cards, pill navigation, buttons
  and chips. Shadows are soft and layered in the ink's tint: fields and data panels stay flat, primary and secondary
  buttons have a small resting shadow, and menus and chart readouts float. No hard offset shadows.
- Fields share one edge (the `field` tokens): quiet at rest, a little lighter than the strong line in light mode;
  on focus a gray step toward the ink with a faint ring, never a hard ink outline, and no hover change (text fields,
  selects, search, the code input and email capture). A field's action button takes the field's height.
- A disabled field keeps the surface background, with a lighter border and text, so a row of fields never mixes
  backgrounds.

## Controls

Every control comes from `@forwend/ui-web`; a link that looks like a button uses `buttonClasses`.

- One height scale: 32px (`sm`) in dense rows and panel headers, 40px (`md`, the default) in toolbars, the header and
  forms, 48px (`lg`) for the actions of a standalone screen (sign-in, first run, checkout's Show address and receipt).
  Text fields are 44px. Buttons are pills and icon buttons are circles.
- Primary is filled with the ink. Secondary is the surface with a hairline and a small lift; dark grounds swallow the
  lift, so there its line is the strong one. Ghost has no edge until hovered. Icon buttons tint whatever lies under
  them with the ink on hover and press, so they read the same on a page, a card or a filled row. Anything pressed
  (a nav row, a search trigger) goes one small step past its hover toward the ink, never into a dark well.
- A segmented control is a recessed pill track with the chosen option as a raised segment: the surface in light mode,
  a lighter step of the track in dark mode. With room, every segment is as wide as the widest label; short of room,
  each shrinks to its own label first. It holds a few short options: a chart range, Transactions' direction (All, In,
  Out) and a choice inside a form; 40px in toolbars and forms, 32px beside a chart or in a panel's header. If it still
  can't fit, the track scrolls sideways, fading at the edge that has more (a scroll-driven mask, so no script).
- A longer choice (the status of invoices, requests and activity) is a select menu: a secondary button showing the
  choice with its icon (and the filter's name from small screens up), opening a menu of every option, each with the
  icon its pill or bell event uses (Open a circle, Paid a check in a circle, Settled a wallet, Expired a clock,
  Canceled a ban).
- A long list to choose from (a country, a saved client) is a search select (`ComboboxField`): the field looks like a
  select and opens a panel under it with a search box over the options; typing narrows them, ignoring letter case and
  accents ("cote" finds Côte d'Ivoire), arrow keys move, Enter picks and Escape closes. A short list (a network, a
  token) stays a select.
- Search is a soft filled pill without an outline at rest, with a clear button once it holds text: the list search
  fields and both header search triggers.
- A list's toolbar (Invoices or Requests, Activity, Transactions): the search on the left, the filter beside it, the
  actions at the row's end. On phones the search fills the row up to a status menu at its end; Transactions' direction
  takes the next row at full width with Export as its icon. The new invoice or request action sits beside the page
  title there.
- A form ends with its primary action, then Cancel or Skip as a ghost button. On phones both run the full width,
  primary first.
- A setting that applies when flipped is a row in a panel: what it does on the left, the switch at the row's end and
  a quiet line under it. On, the switch's thumb is the lightest thing on it in both themes (white on the river
  blue, the ink in dark mode); off, it is the quiet gray.

## App shell

The signed-in app (`/app`) uses these patterns. Menu, sheet, action button, segmented control and switch are in `/kit`.

- Desktop: a fixed full-height sidebar on the surface color with a line divider; it stays in view while the page
  scrolls. From top: one row with the logo mark, a slash and the profile switcher (name only, no wallet address);
  page links in named groups for the profile type (the current page on the second surface); the account menu at the
  bottom.
  The collapse button sits at the start of the header. Collapsed, the sidebar is an icon rail with the profile tile on
  top and names as tooltips; the choice is remembered in the browser.
- Desktop header: a sticky bar across the content. Breadcrumb of links (profile, page, then the invoice number or the
  form under the page) on the left; on the right a search field with the ⌘K hint, notifications, then Send and
  Receive, every control 40px tall. Content uses the header's side padding, with no maximum width, so its edges line
  up with the header.
- On desktop a page does not repeat the breadcrumb's last step as a visible heading; its h1 is for screen readers
  only, except an invoice with no title, whose number is its heading since nothing else names it. Phones have no
  breadcrumb, so they show the h1 (and a back link on an invoice). Page actions, status filters
  and search sit in one slim toolbar row at the top.
- ⌘K (or the search field) opens one command dialog: pages, actions, other profiles and recent transactions,
  filtered as you type. Arrow keys move, Enter opens, Escape closes.
- The account menu holds the app's one theme control, a Dark mode switch item, on desktop and phones.
- Phones: the header becomes a top bar with the account initial, a search pill and notifications. A bottom tab bar has Home, Transactions, Balances and More;
  large icons over labels, with the whole current tab on the second surface. More opens a sheet: first a profile card
  (avatar, name, Switch profile and an up/down selector icon, then Billing details for businesses), then the remaining
  sidebar pages for the profile type as grouped cards of rows with an icon tile (white cards with hairlines, neutral
  tiles; the current page's tile is river blue), then unbuilt pages as small
  Coming soon chips that are not links. Current-page links include nested pages; More stays selected for those pages.
  The bar and page padding include the bottom safe area, and toasts sit above it. A switch opens the new profile's overview (R-76).
- A choice opened from the sidebar is a menu; the same choice on a phone is a bottom sheet, which becomes a centered
  panel from small screens up. Both are solid surface panels with the float shadow; modal backdrops use a scrim without blur. Menus rise from the edge they
  open on and close at once (a fade-out would return focus late and shut a menu reopened meanwhile); the phone sheet
  slides up from the screen edge; the centered panel appears without motion. Reduced
  motion removes the movement. Behind a modal the page darkens with the `scrim` token in both themes.
- Panels are solid surface with a hairline border, large corners and no shadow; a panel's header row is ruled off.
  Figure strips and tables use hairline rules between cells and rows, not separate cards. On phones a panel is a
  full-width section between top and bottom hairlines (no side border or corners, no box inside a box), its title
  unruled above the rows, as in banking apps; panels become cards from small screens up (`fw-panel`, `fw-panel-head`).
- Totals across tokens (the total balance, its chart, the business figures, money in and out) are in USD, each
  stablecoin counted as 1 USD. An info icon after "USD" marks the estimate and explains it in a tooltip. On the
  personal overview the icon hangs after USD and takes no width, so the total sits on the center line on phones. A row
  for one token keeps its symbol.
- Personal overview: one valley in both themes, a pale mint daytime sky in light mode and night in dark mode. In light mode a surface wash over the lower half keeps chart ticks and money actions readable. Pending and held money each use one USD
  summary link to Balances, where exact amounts remain separate by token and network; never list every token in
  the hero. Positive totals below a cent read `<0.01 USD`. The card is at least 20rem tall (24rem on desktop) and grows
  with its content, with the actions right under the total on phones.
  On desktop, the total sits at the top left, the round actions at the bottom left, and the chart fills the right side. The total scales with its column (container units). Phones center the total
  with the actions under it (five equal columns, labels smaller below 360 px so they never touch), and put the chart
  in its own panel below.
- Business overview (merchant, freelancer, R-63): a Summary panel whose ruled header names the range and holds the
  range control, over one figure grid (Balance today, Received, Sent, On its way); then the Received chart (its header
  counts the payments in) beside Balances by network, both stretched to one height; then the latest payments with View
  all. On phones the figures are rows, the label and its note on the left and the value on the right, and the chart is
  shorter. Filters, search and CSV export live on Transactions. A range with nothing received says so in place of an empty
  chart.
- Charts are drawn by us, with no grid lines and no value axis: the readout gives each exact amount and the dates
  (first, middle, last; first and last on phones) sit under the plot. The balance is one smooth ink line (monotone, so
  it never overshoots a real value or dips under zero) over a wash that fades down, from zero with a little headroom;
  it draws itself in. Today's point is a river-blue dot with a soft ring that leaves it now and then (it is live).
  While a point is chosen, the line up to it stays ink and the rest steps back, a dotted vertical cursor drops from
  the point, and the readout floats just above it. Received is the same line over the running total received in the
  range, so it only climbs and its end is the range's Received figure; the readout adds what came in that day.
  Pointer, tap or arrow keys choose a point; only keyboard moves are announced, and a hidden table gives screen
  readers every value. Range choice is a segmented control. Reduced motion shows every chart in place. A failed figure shows "—" with Try again,
  never an endless skeleton.
- Invoices and Activity: a status filter (All, Open, Paid, Settled, Expired, Canceled) and a search; a row opens its
  invoice.
  Transactions has a direction filter (All, In, Out) and a search. The API filters and searches the whole list, and the
  URL keeps both. A confirmed transfer shows its status as a green dot and plain text; only one still confirming gets
  a pill, and phone rows name a status only while it is still confirming. A filter or search with no rows says nothing matched, with a button to clear them. A transaction hash links to the chain's block explorer in a new tab (Transactions, Activity,
  invoice detail, pay page).
- Tables: plain header labels in the small size over a hairline (no tinted band), rows about 60px tall with the outer
  columns inset to the panel's padding, hairlines between rows, a tint on hover. A table never breaks into day bands:
  the date is a column.
- Transactions table: ruled table from medium screens, one body with a Date column (Today or Yesterday, else the
  short date with the year only for another year, then the time, then the explorer link); the network has its own
  column only on the widest screens and sits under the counterparty otherwise. Phone rows sit under quiet day headings
  (Today, Yesterday, then the weekday and date) and are two lines that never cut: the network is its logo on the
  corner of the direction icon (and in words for screen readers), the time and the explorer link sit under the other
  side, and the amount sits on the right.
- Clients (R-86) is laid out like Invoices: the toolbar's search (name, email, tax ID) with Add client at its end
  (beside the title on phones), then a table of the client with its initials avatar, billing email, country and tax
  ID, where a row opens the client (a long country gives way to the name on phones). New client and Edit client are
  form pages under Clients laid out like New invoice (Contact, Address and tax, and On invoices with the default PO
  or reference, as panels); Delete waits in the More actions menu at the page's top right and asks to confirm in a
  dialog, as Cancel does on an invoice.
- Invoices table: the client has a round initials avatar. Phone rows lead with the client (or a request's note) beside
  that avatar carrying the network's logo, with the number and a short due date (no year within this year) under it,
  and the amount over the status pill on the right. From small screens up (and for requests, which have no table) a
  row is one line: the status in its own column before the amount. A request's note is no name, so its avatar keeps
  the document icon.
- Activity on phones: one network rides on the row icon as its logo, so the detail line is only the time and never
  cuts; a confirmed payment names no status, as on Transactions.
- Invoice detail on phones: above a title the number is a small quiet label; with no title it is the heading, as on
  desktop. The invoice's actions wait in one More actions menu at the header's top right
  (see the invoice page under Checkout). Details are statement rows, the term on the left and its value on the right;
  a note stacks under its term.
- Email notifications: one settings row in a panel (see Controls).
- First run: while `/v1/me` has no `onboardedAt`, `/app` shows one standalone screen instead of the shell: the logo,
  "What do you want to do?" in the UI heading face, four choice cards (checkboxes, any number; two columns from small
  screens up) with an icon, a hint and the profile each one adds, then Continue and Skip for now. Continue with nothing
  picked is Skip. Afterwards the app opens on the overview of the new freelancer profile, else the new merchant, else
  the personal one (D-73).
- Onboarding checklist: a "Get started" panel on the personal overview (under the balance card) and the freelancer
  overview (above the figure strip), with "n of m done", a short ink meter (from small screens up) and a close button
  in its ruled header. Each step is a row
  with a round mark (filled ink with a check when done), title and hint (a done step shows its title only); a step not done has its action (secondary
  button or link) and Skip. Steps come from data: passkey linked, billing details (freelancer), first invoice or
  request, first paid in full, first final money in. Skipped steps and the closed card are remembered per profile in
  the browser; the card hides when closed or when every step left is done.
- New invoice and Request money: each field group (Amount, Details, Dates, Client) is a panel with its title ruled off.
  Dates on New invoice holds Supply date (R-89, optional, any day), then Due date, then Checkout closes after, so the
  due date sits next to the close it moves; the invoice page lists Supply date in Details after Created. Details on
  New invoice holds PO or reference (R-90) after Title, filled from the saved client's default when the client has
  one; the invoice page lists Reference first in Details.
  Picking a due date switches Checkout closes after to Custom on the due date plus 60 days (D-80), with one quiet line
  saying why; a close the owner picks before that day stays allowed, with a warning line (icon and warning text, as on
  the pay page) that a later payment would be held for the payer.
  Add item (secondary, small, under the amount; not on Request money) turns the amount into item rows (R-88), the
  amount typed so far becoming the first item's price: Item, Qty, Price (in the amount's unit) and the line's amount,
  with a remove button. From small screens up the rows line up under one header row and the field labels are for
  screen readers only; on phones each item stacks (description, then Qty and Price with the remove button, then its
  amount). A ruled footer holds Add item and the Total, which is the invoice's amount; a line the token can't hold
  shows its error under the field it belongs to. Removing the last item leaves its total as the amount.
  The invoice page lists the items in an Items panel under Amount: each row the description with "qty × unit price"
  quietly under it and the line's amount on the right, then a ruled Total row, the same on every width.
  From extra-large screens a sticky Preview panel beside the form echoes it in the pay page's order: title, amount with
  how it is paid, then Billed to (Shown as for a request), Due and Checkout closes after as ruled rows, and the note. It
  is hidden from screen readers, since the fields already say all of it.
- Money actions are round icon buttons with the label underneath, on desktop and phones; only working actions are
  filled with the primary ink. In the header, Send is a dashed outline pill in the subtle color until it is built.
- Personal overview actions: Receive, Request, Send, Transfer, Withdraw, in one row with a narrow gap on phones.
  Request (also in ⌘K) opens the Request money page (R-71) with amount, note, checkout expiry and the name the payer
  sees, then opens the new request with its pay link. A personal profile's invoices are Requests in the sidebar, list
  and breadcrumb.
- In the desktop sidebar, a feature that is not built yet keeps its place in the subtle text color, with "Soon" as
  plain text at the end: no badge, no link. A disabled action says why in its accessible name and shows "Coming soon" in a tooltip on
  hover, focus or tap; no notice text is added to the page.
- A toast is only for an event the user did not just do on that spot: a payment detected or settled while the app is
  open, or a save that leaves the page (billing details, a client saved or deleted). Errors and anything that needs an answer stay inline beside
  their field or form. Toasts sit top right on desktop and above the tab bar on phones, as solid surface panels with
  the float shadow; at most three, each gone after 5 s unless hovered, focused or the tab is hidden, with a close
  button. They enter from the edge they sit on and leave faster than they came. Screen readers hear them through a
  polite live region.

## Checkout

- `/pay/<id>` (R-68) is one short screen: the logo (links home), then on wide screens the invoice on the left and how
  to pay on the right. Left: the payee name (no display serif) beside a square tile with its initial on a bordered
  surface tile, "Invoice INV-0001" under the name, the amount (Geist, tabular, featured size; USD until the payer picks)
  and "on <network>": the top says only who asks and how much. Then, as a hosted invoice page lists them, the title,
  the due date and "Closes in …" as quiet rows with a small icon (no rules), the note, and Download invoice PDF as an
  underlined link with a file icon. On phones the pay panel comes right after the amount and the title, dates, note and PDF
  link follow it, so the payer reaches the address first. Right: one panel. While money is due it holds Pay with (the one option as a token mark,
  or Network and Token selects, which scale to many chains and tokens), a Show address button, then the QR beside the
  exact amount and the warning line "Send only USDC on Base Sepolia." with a warning icon (the small size on phones, so it
  stays on one line beside the QR down to 360 px) (plus "Native USDC, not
  USDC.e." where a bridged look-alike exists), then the address full width, then the token contract as a short explorer
  link and one exchange hint that names the network to withdraw on. The amount and address sit in boxes on the surface with the fields' quiet edge, with icon-only Copy actions and no nested button outlines. The address is Geist Mono with its first 6 and last 4
  characters in the ink (medium weight) and the rest quieter, always whole and on one line (R-78): the copy icon sits beside the label so the address keeps its full width on phones and in Receive. Text scales with the field's width; successful copying changes the icon to a check and announces the result. Once money is seen and once paid, the panel's last row is "Email me a receipt" with a mail icon; pressing it
  opens the optional field there, with Send inside its row and the line that the address is used for this receipt
  only (R-82). Before any money there is nothing to send a receipt for, so the row is not there. Once the address shows, a picked network and token fold into one row with a quiet Change; it turns
  into "Confirm change" and only a second press starts over (leaving the button cancels), so a payer who already sent
  does not switch by accident. Under the address one row: "Waiting for payment…" with a pulsing dot, and Check status on its right; what a check
  found and when the next check is allowed take their own line under them, so the button never moves; nothing waits before the address shows. Once money is seen the panel keeps its place ("Paying with" while nothing more is due): the steps
  Detected, Confirming and Paid fade in, the waiting one moving (Partially paid tinted on Paid), one line for what the
  steps cannot say ("Final check", or what is left to pay), and each payment with its amount, time,
  short hash and explorer link. The address stays only while money is still due. Closed says so in one line. Paid
  replaces the panel with a receipt, left aligned: a check that scales in beside "Paid" and "You can close this page.",
  then ruled label and value rows (Amount, Paid to, Date, and Transaction with a View transaction link to the
  explorer), then Download receipt as a full-width button (primary, or secondary under a full-width primary Back to
  <host> when the invoice has a return link). The payer never sees Settled, status pills,
  testnet notes or an overpaid line (PLAN 11.10.1). Copy names the payee, or "the invoice's creator", never "the
  sender". The footer is one quiet line: "Payments by" with the mark and Forwend, opening the site in a new tab, and
  "Need help?", which opens a dialog with the rules (where you are, refunds, scams, the unverified name), so the pay
  box never grows.
- No image and no glass; it follows the system theme. When a refresh fails the page keeps the last read and says it
  may be out of date. The invoice PDF link stays in every state; the receipt link appears once paid.
- PDFs open through the same-origin `/api` path. The invoice detail lists them under Documents: the invoice PDF
  always, the receipt PDF once paid.
- While a payment confirms, the step label stays "Confirming"; one full-width row below the steps shows "4 / 12
  blocks confirmed" and a small clock icon whose tooltip says "About 19 min left". Keep the count out of the narrow
  step columns on both payer and owner pages, including four-digit counts on phones. Its bar fills as blocks pass
  (a sweep until the first block passes); done, the step reads "Confirmed". The count is blocks passed of those the
  payment had to wait when first seen, from the API, so a reload keeps it (R-73). A screen-reader-only live line
  announces the count and time left.
  The owner's steps are Waiting, Detected, Confirming, Paid and Settled. The step that waits always moves, so it never
  reads as stuck: a sweep on Waiting before any money and on Settled while the money is on its way to the wallet, a
  fill by the share received when partly paid (R-69).
  Up to four steps always sit side by side (the payer's timeline, the landing's samples). The owner's five don't fit a
  phone, so in a container narrower than 28rem they stack into one upright path, the same bars running down beside
  larger labels, so no label is squeezed against the next.
- The invoice page (R-60) says each thing once: the header only names the invoice (its title, or its number when there
  is none); the timeline says the status, and Details the times: when the checkout closes ("Checkout closed" once
  past) and, once canceled, Canceled on. So the header has no status pill or time. At its top right sits one More
  actions menu: Copy link and Open pay page (a new tab) while the checkout can take money, Duplicate always (New
  invoice filled from this one, R-91), and while it can still be canceled, Cancel in
  the danger color, which asks to confirm in a dialog. Copying keeps the menu open and the item says Link copied; if
  the clipboard refuses, the whole link shows there to select. Below, two columns from large screens up: the
  amount ("Received X of Y" under it when partly paid) with the timeline, where the Paid step reads "Partially paid"
  as a warning-tinted label when partly paid, the status line (only the confirming count or why settling waits; the
  state itself is the timeline's), one Transactions list (each payment, then the settlement to the wallet, later refunds: kind, amount, the other side,
  time and hash with its explorer link, no status pill of its own; Details repeats none of them) and Check
  status only while the checkout can take money; beside it the details (empty ones left out), Billed to, and From (or "None on this invoice" with a link to add
  billing details).

## Emails

- Every email is one layout (`apps/backend/internal/notify/layout.html.tmpl`) in the app's look: the logo and name
  above one card with the panel's edge and large corners; a status badge in the pill tones; the title in the UI
  heading face (Geist semibold, never the display serif); the amount large with tabular figures; detail rows ruled like
  a statement; one primary pill as the action; a quiet footer. Colors are the token values for both color schemes.

## Theme and behavior

- An empty list, or one filtered to nothing, is one centered block in the list's place (R-75): an icon in a soft
  circle, a title ("No invoices yet", "Nothing matches"), a line or the next step under it ("Clear filter and
  search"), as wide as the list and at least about half the screen tall. Inside an overview card it drops its frame
  and most of its height.

- Apply the saved theme, otherwise the system choice, before first paint using `data-theme` on `<html>`.
  Product sections can force dark with their own `data-theme="dark"`. Use the theme variant for theme-only differences.
- A loading button shows only a centered spinner, at its own size and colors, and keeps its accessible name.
- Status changes keep row geometry stable. Labels accompany status colors. Mark all demonstration data as Sample.
- Use motion tokens; respect reduced motion. No scroll hijacking or layout jumps during state changes. Loading
  spinners (`data-motion="essential"`) keep turning under reduced motion; everything else stops. A pressed button
  scales to 0.98 on a fast ease-out (a round money action to 0.95), like a physical key; reduced motion keeps only the
  color change. Landing sections rise into place as they scroll in, driven by the scroll itself (no script); without
  scroll timelines or with reduced motion everything is simply in place. The ⌘K dialog opens with no animation: it is
  opened by keyboard many times a day.
- Touch targets are at least 44px on touch screens; small controls keep their look and grow only their hit area. A
  segmented track, the list search and the header search triggers grow to 44px themselves (a scrolling track would
  clip a hit area beyond it).
  Icons that sit side by side on a phone use the 40px size, so their hit areas don't overlap.
- Target WCAG 2.2 AA, including text contrast, keyboard access and accessible status announcements.
- Keyboard focus stays visible. Errors identify the field and explain the correction; loading and success states are
  accessible to screen readers. Copy controls confirm successful copying and handle unavailable clipboard access.
- Width checks (no sideways scroll at the R-7 and R-66 widths), accessibility and money formatting have tests. Review composition and typography in screenshots.

Product wording: [PRODUCT.md](PRODUCT.md). Code rules: [rules.md](rules.md). Image prompts: [images.md](images.md).

## Interaction and device rules

- Keep the overview landscape and breadcrumb-only desktop page headers. Phone page titles use one size on every
  page; the new invoice or request action sits beside its title.
- Filters stay one row, never a grid (see Controls); a segmented control keeps native radio keyboard behavior, a
  select menu the menu's arrow keys.
- Receive uses one token/network summary, a centered QR, the full address with a copy icon, the network warning and
  a short note. Avoid nested cards and large blocks around the QR.
- Fixed navigation and page edges respect safe-area insets; zoom stays enabled and touch text inputs use the base
  font size. Amounts and addresses remain selectable.
- A keyboard skip link moves directly to app content. Focused content clears sticky navigation. Native modal
  dialogs contain scrolling and lock the page behind them; the scrollbar's room stays reserved, so the page never
  shifts sideways when one opens. Close buttons use the shared icon control.
