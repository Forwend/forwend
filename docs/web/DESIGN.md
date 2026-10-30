# Design

Direction: Signal (PROJECT D-113): white and near-black neutrals, one grotesk, a lime main action, olive marks.
Use `/kit` for the implemented components. This file owns visual use; token source owns values:
[colors and sizes](../../packages/design-tokens/src/tokens.css), [themes](../../packages/design-tokens/src/theme.css),
[base styles](../../packages/design-tokens/src/base.css). Do not copy token values into documentation.

Read only the sections your change touches. Any new control also needs
[Theme and behavior](#theme-and-behavior): touch targets, focus and accessibility.

| Section | Covers |
|---|---|
| [Composition](#composition) | The landing: hero, sections, steps, glass, phone navigation |
| [Type and color](#type-and-color) | Fonts, money and address type, role tokens, status colors, surfaces, fields |
| [Controls](#controls) | Heights, buttons, segmented controls, selects, search, toolbars, forms, settings rows |
| [App shell](#app-shell) | `/app`: sidebar, header, search, sheets, panels, overviews, charts, lists, tables, first run, onboarding, the invoice forms, money actions, toasts |
| [Checkout](#checkout) | The pay page `/pay/<token>`, PDF links, the confirming row, the owner's invoice page |
| [API docs](#api-docs) | The public developer docs `/docs` |
| [Emails](#emails) | The email layout |
| [Theme and behavior](#theme-and-behavior) | Empty lists, theme, loading, motion, touch targets, accessibility, width checks |
| [Interaction and device rules](#interaction-and-device-rules) | Phone titles, filters, Receive, safe areas, skip link |

## Composition

- The landing is white with near-black ink. One container, `max-w-7xl` with the page gutter, sets every section's edges.
- The app icon and favicons are the mark in brand lime on an ink tile (`icon.svg`, `/brand/forwend-icon.svg`); the
  PNG sizes are drawn from that SVG. The plain mark (`LogoMark`) takes the text color.
- Navigation is a fixed bar across the top: the logo, section links, the theme switch and Join waitlist.
  - A hairline under it and a translucent ground keep it readable over the page.
  - On phones the section links sit behind a menu button (a native popover).
- Hero: a left-aligned two-tone headline (ink, then the subtle color), the waitlist form, and the pitch on the right.
- Under the hero sits the product canvas: the Signal artwork, a sample invoice confirming, and the payer's phone checkout.
  - It is a figure with a label; everything on it is marked Sample.
  - Its one motion: the confirmation bar fills once on load. Reduced motion shows it filled.
- Regular section headings align left; the final call to action centers. Fees and FAQ split at desktop widths.
- Step sequences form one connected path, horizontal on wide screens and vertical on phones.
- The checkout showcase is a dark band on the near-black ground, with no photo.
- Footer ridges and halftone dots use the art tokens.
- Planned networks and stablecoins: one row on wide screens, an equal share each with a line between neighbours;
  narrower, one row that drifts sideways in a loop with fading ends (paused under a pointer; reduced motion leaves a
  still row to swipe). Network and token names share the UI face.

## Type and color

- Hanken Grotesk sets every heading, the UI, body text and money; the display role reuses it.
  - Large headings use the medium weight with tight tracking (the `text-hero` and `text-section` roles carry it).
  - Geist Mono only for addresses, hashes, contract links, raw base units, keyboard hints and code.
  - Money uses tabular figures everywhere: medium weight in rows, medium and tight for headline figures.
- No eyebrow labels or tracked uppercase kickers.
- Neutrals are white and near-black with true greys: no green tint in grounds, lines or text.
- Lime (`brand`) is the fill of a view's main action and nothing else. Its olive edge keeps it crisp on white.
  - One lime action per view where possible; the header's Receive is the app's standing one.
- Olive (`accent`) marks focus rings, a switch that is on, the current step and a chosen option's check.
  In dark mode the same role takes the lime.
- Links that lead to another record are underlined ink (`RecordLink`), never colored text.
- Success, warning, error and information use their matching text/background token pairs. Art never becomes a UI color.
- Detected and confirming are pending: a neutral badge with a turning icon, never a success color.
  Only paid and In wallet look done.
- Panels and fields are flat with hairlines. Menus, toasts and the hero canvas float with soft shadows.
- Fields share one edge (the `field` tokens): quiet at rest, a gray step toward the ink with a faint ring on focus,
  no hover change. A field's action button takes the field's height.
- A disabled field keeps the surface background, with a lighter border and text.

## Controls

Every control comes from `@forwend/ui-web`; a link that looks like a button uses `buttonClasses`.

- One height scale: 32px (`sm`) in dense rows and panel headers, 40px (`md`, the default) in toolbars, the header,
  fields and forms, 48px (`lg`) for the actions of a standalone screen (sign-in, first run, checkout).
  On touch screens fields grow to 44px and every control's hit area reaches 44px.
- Buttons, fields, segmented tracks and icon buttons are rounded rectangles (`radius-md`, 10px); panels use
  `radius-lg` (16px). Pills are only for avatars, dots and the round money actions.
- Primary is the lime fill with ink text and an olive inset edge. Secondary is the surface with a hairline and no
  lift; dark grounds use the strong line. Ghost has no edge until hovered. Icon buttons tint whatever lies under
  them with the ink on hover and press, so they read the same on a page, a card or a filled row. Anything pressed
  (a nav row, a search trigger) goes one small step past its hover toward the ink, never into a dark well.
- A segmented control is a recessed rounded track with the chosen option as a raised segment: the surface in light mode,
  a lighter step of the track in dark mode. With room, every segment is as wide as the widest label; short of room,
  each shrinks to its own label first. It holds a few short options: a chart range, Transactions' direction (All, In,
  Out) and a choice inside a form; 40px in toolbars and forms, 32px beside a chart or in a panel's header. If it still
  can't fit, the track scrolls sideways, fading at the edge that has more (a scroll-driven mask, so no script).
- A longer choice (the status of invoices, requests and activity) is a select menu: a secondary button showing the
  choice with its icon (and the filter's name from small screens up), opening a menu of every option, each with the
  icon its pill or bell event uses (Open a circle, Paid a check in a circle, In wallet a wallet, Expired a clock,
  Canceled a ban).
- A long list to choose from (a country, a saved client) is a search select (`ComboboxField`): the field looks like a
  select and opens a panel under it with a search box over the options; typing narrows them, ignoring letter case and
  accents ("cote" finds Côte d'Ivoire), arrow keys move, Enter picks and Escape closes. A short list (a network, a
  token) stays a select.
- Accepted assets (Settings and a store's form) use one selector (`AssetSelection`, `shared/components/chains`).
  - One row per asset with a tri-state checkbox, "n of m networks" and an expand control; each network below it is its
    own exact contract, shown shortened with the full address as its title.
  - A summary line says what is accepted ("Accepting USDC on 3 networks and OUSD on 1").
  - Search matches the name, the network or the contract; All or Selected narrows the list.
  - It renders 30 assets and 12 networks at a time with Show more, so thousands of pairs keep a small page.
  - Measured with 10,000 pairs: about 1,200 DOM nodes, search under 0.1 s in development mode.
- Search is a soft filled field without an outline at rest, with a clear button once it holds text: the list search
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
  - A personal profile's money group: Overview, Transactions, My assets, Payments, Requests and Activity.
- Desktop header: a sticky bar across the content. Breadcrumb of links (profile, page, then the invoice number or the
  form under the page) on the left; on the right a search field with the ⌘K hint, notifications, then Send and
  Receive, every control 40px tall. Content uses the header's side padding, with no maximum width, so its edges line
  up with the header.
  - The bar is the page ground at 88% with a blur, over a hairline.
  - The search field reads "Search or jump to"; the bell's unread dot is the olive mark.
  - Send is the dashed Soon button with a send icon; Receive is the lime button with a QR icon.
- On desktop a page does not repeat the breadcrumb's last step as a visible heading; its h1 is for screen readers
  only, except an invoice with no title, whose number is its heading since nothing else names it. Phones have no
  breadcrumb, so they show the h1 (and a back link on an invoice). Page actions, status filters
  and search sit in one slim toolbar row at the top.
- ⌘K (or the search field) opens one command dialog: pages, actions, other profiles and recent transactions,
  filtered as you type. Arrow keys move, Enter opens, Escape closes.
  - Pages are the role's sidebar pages, then Settings.
  - Actions: Receive, then the create pages the role can use, then New profile and the theme.
  - A business gets New invoice, New payment link and New client; a personal profile gets Request money.
- The bell (R-81) lists the six newest events, each as what happened, then the payment or sender it names.
  - Paid, In your wallet and Held for the payer name the payment (its number, else title) and open its page.
  - Money in that pays nothing reads Received with the sender, and opens it on Transactions.
  - A transfer still confirming says Confirming before its network and time.
  - View all opens Payments for a business and Transactions for a personal profile.
- The account menu holds the email, the app's one theme control (a Dark mode switch item) and Sign out.
  - Sign out of all devices (R-137) lives in Settings, Account and security, never in the menu.
- The sidebar's foot, above the account row: the setup guide while steps remain, then a Settings row.
  - The setup guide is a small card that starts closed: "Get started", "n of m done" and one segment per step.
  - Its title row opens and closes it with a height transition (none under reduced motion); open, it shows the next
    step with its action and Skip. It has no close button.
  - It goes once every step is done or skipped; phones show it at the top of More.
- Settings is one area with a section column beside the page (13rem); phones get a row of text tabs instead.
  - Your account: Account and security, Notifications. This profile (its name): Billing details, Accepted assets, Team.
  - Each section shows only to a role that can open it (D-93). The pages keep their addresses.
  - Account and security lists the sign-in methods (email, Google, passkeys with the device they were made on),
    this device (browser and system from its user agent), Sign out, and Sign out of all devices with its dialog.
  - Privy can't list sessions or end one alone ([freezing users](https://docs.privy.io/user-management/users/managing-users/freezing-users.md)), so no session list is shown.
- Confirm it's you (R-137) opens over any page when a change needs a fresh sign-in.
  - It sends the code to the login email at once and says where; the code boxes are the sign-in page's.
  - Send a new code, Cancel and Confirm sit at its foot. Confirm repeats the change; Cancel leaves it unsaved.
  - A user with no email login reads that they need one, with Close.
- Phones: the header becomes a top bar with the account initial, a search pill and notifications. A bottom tab bar has Home, Transactions, My assets and More;
  large icons over labels, with the whole current tab on the second surface. More opens a sheet: first a profile card
  (avatar, name, Switch profile and an up/down selector icon), then the setup guide while steps remain, then the remaining
  sidebar pages for the profile type as grouped cards of rows with an icon tile (white cards with hairlines, neutral
  tiles; the current page's icon is olive), then Settings, then unbuilt pages as small
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
- Holdings across tokens (the total balance, Moving to wallet, Not final, On hold) are USD at market prices
  (D-115). An info icon after "USD" says so in a tooltip. Pages name no price provider.
  - A value uses the latest known price, even an old one: stablecoins move little.
  - Without any price for a held token, the total is "—": never 1 USD.
  - Payment flows and history (Received, Sent, money in and out, the charts) stay at face value, one USD per
    stablecoin: they are payment amounts, and there is no price history.
  - On the personal overview the icon hangs after USD and takes no width, so the total sits on the center line on
    phones. A row for one token keeps its symbol.
- Personal overview follows the C comp's balance card, in rows of cards like the business overview:
  - Row 1: the balance card beside My assets; then the Balance chart beside Money in and out. The setup guide is in
    the sidebar, never on the overview.
  - Recent transactions spans the width below. Phones stack them in that order.
  - The balance card: Total balance, the total (`BigAmount`, cents subtle), its change over the past month.
  - Under them the pending and held links, the prices line, then the round actions at the card's foot.
  - The valley art sits behind a surface veil: from small screens it shows only on the right, on phones it is faint.
  - The card is at least 16rem tall (20rem on phones). The total scales with its column (container units).
  - Pending and held money each use one USD summary link to Balances; never list every token in the card.
  - Positive totals below a cent read `<0.01 USD`.
  - Phones center the total with the actions under it (five equal columns, labels smaller below 360 px).
  - The Balance chart card holds the range control; beside it Money in and out stacks In over Out.
- Business overview (merchant, freelancer, R-63) follows the C comp, in three rows of cards (`Card`, unruled headers):
  - Row 1: the Balance card and Pending payments.
    - Balance: the personal card's figure over the art with a surface veil: the total, USD and its hint, then
      its change over the past month. Its pending and held links stay off: Pending payments sits beside it.
    - Then round actions: New invoice (lime), Payment link, Checkout (merchants), Receive.
    - Pending payments: payments still confirming (not final), then paid money moving to the wallet.
      Up to three rows open their payment.
    - Money on hold is a separate row at the card's foot, linking to My assets: "0.89 USD on hold".
      - Under it: "Extra or late payments. Not part of your balance." No wording says who owes whom.
    - Every row in the card shares one type: a medium ink line, then a small muted line.
  - Row 2: the Received card (range control in its header, the range total, Sent, the running-total chart) beside
    My assets (a share bar, then each token's amount and market value).
  - Row 3: Unpaid beside Latest payments; each sizes to its rows instead of matching the other's height.
  - Latest payments: six rows from the Payments list's first page, with a source icon (the payment always comes in).
  - Phones stack the cards in that order. Filters, search and CSV export live on Transactions.
  - A range with nothing received draws a flat line at zero, as a real zero should.
  - A failed or missing history keeps the chart's frame and dates, faded, under a centered error or note.
- Pending payments opens with the USD total not in the wallet yet, a two-part bar and its legend:
  Moving to wallet (paid, ink) and Not final (confirming or partly paid, which may still be the payer's).
- My assets' rows each carry their step's dot from the share bar and their share in percent ("<1%" for a sliver).
- Unpaid (R-95, D-114) is a card on the overview's last row. It lists only what customers still owe.
  - The title, a one-line description and, when something is left, the USD total at its right.
  - Rows: the client (or title, or number), then the number and "12 days late" (warning color) or "Partially paid".
  - The amount sits on the right with "left to pay" under it. A checkout row opens its payment, an invoice row its invoice.
  - Money on hold shows as Overpaid on its payment and as On hold in My assets, never here.
  - Five rows, then Show all n, which moves focus to the first row it adds. Nothing unpaid says so in one quiet line.
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
- My assets: Total balance (`BigAmount`), then one row per token.
  - Columns: Asset, In wallet (with its market value), Moving to wallet, Not final, On hold.
  - Moving to wallet is paid money being transferred; Not final is confirming or partly paid money, which may still
    turn out to be the payer's. Each header's title says so.
  - Nothing in a column is a quiet dash on wide screens and no row at all on phones.
- Invoices and Activity: the shared status filter (below) and a search; a row opens its
  invoice. An Activity row is a past-tense event ("Invoice created", "Payment received", "Held for the customer");
  its status column is headed "Status now", because it is where the payment stands today, not what the event did. Activity and Transactions page through the API's cursor, so their history reaches its start.
  Transactions has a direction filter (All, In, Out) and a search. The API filters and searches the whole list, and the
  URL keeps both. A confirmed transfer shows its status as a green dot and plain text; only one still confirming gets
  a pill, and phone rows name a status only while it is still confirming. A filter or search with no rows says nothing matched, with a button to clear them. A transaction hash links to the chain's block explorer in a new tab (Transactions, Activity,
  invoice detail, pay page).
- Record lists (Payments, Invoices, Payment links, Stores, Clients, Jobs) use one `DataTable` (`shared/components`).
  - Plain header labels in the small size over a hairline; rows 44px tall and one line, hairlines between rows, a tint
    on hover; the whole row opens the record.
  - Columns show by the panel's own width (container queries), not the screen's, so a collapsed sidebar shows more.
    A column that drops has its fact in the phone row or on the record's page.
  - Narrower than 48rem the rows become two short lines: what it is, then details; the amount and status on the right.
  - A table never breaks into day bands: the date is a column.
  - Loading shows rows shaped like the real ones; a failed read is one `LoadError` with Try again; an empty list says
    what fills it; a filter with no rows offers to clear it.
- One status filter on every payment list (Payments, Invoices, Activity): `PaymentStateFilter`.
  - All, then the D-114 states: Waiting for payment, Confirming, Partially paid, Paid, Overpaid, Expired, Canceled.
  - Each option has its status pill's label and icon. In wallet is a wallet state, so it is a column, not a status.
  - The URL keeps it as `state`, the same parameter on all three APIs.
  - The Source filter's options carry the source icons the tables show.
- A period is one `DateRangePicker` field, never a From and a To:
  - The trigger reads "Oct 1 – Oct 31, 2026"; empty, "Any time"; Clear sits at its end.
  - Its popover: presets (Last 7 days, Last 30 days, This month, Last month, This year) beside two months.
  - Phones show the presets as a row over one month.
  - The first press starts the period and the second ends it, the days between shaded; a press before the start
    starts again. The time zone is one quiet line in the popover's foot, not in the label.
  - Date popovers are placed by the viewport, so a scrolling dialog never clips them.
- Empty and failed states, everywhere:
  - They sit where the content would, centered on both axes: an icon tile, a one-line title, then the action.
  - A card or panel keeps its loaded size: its body has one minimum height for every state.
  - Error and empty share one shape: `LoadError` (danger tile, Try again) and `EmptyState compact` (grey tile).
  - When the state is the page's whole content (a list with nothing yet, nothing matching, or a failed read), it has
    no frame and fills the workspace under the toolbar (`page`), so no shallow box sits above empty space.
    - It is marked `data-page-empty`: the app's main column then takes the screen's height under the header, and every
      box down to the state grows, so it stands in the middle of what is left on screen.
    - A list with nothing yet hides its toolbar (search, filters, New, Export): the state's own action is the only one,
      and it centers on the whole workspace. Nothing matching keeps the toolbar, so the filter can be cleared.
  - Only when the last data still shows does a failed refresh become a one-line notice above it (`LoadError inline`).
  - A new filter or search keeps the last rows in place, dimmed and busy, until its own answer arrives.
  - Show more sits in the table's footer. A list stays live (polled) only while it shows its first page.
- Transactions table: a ruled table from 48rem of the list's own width, one line per transfer in 44px rows, with a
  Date column (Today or Yesterday, else the short date with the year only for another year, then the time, then the
  explorer link). The network has its own column from 64rem; narrower, its logo sits on the direction icon's corner.
  The type select is 32px in a row with a fine pointer, so the row keeps one line. Phone rows sit under quiet day headings
  (Today, Yesterday, then the weekday and date) and are two lines that never cut: the network is its logo on the
  corner of the direction icon (and in words for screen readers), the time and the explorer link sit under the other
  side, and the amount sits on the right.
- Transactions' Type column (R-109) follows the Transaction column; on phones the type is a line under the row.
  - An invoice payment is an underlined link: the invoice number, then the client after a middle dot.
  - Own transfer and Sent are quiet text.
  - Money in that Forwend can't classify has a compact select: Unclassified, Income, Own transfer, Refund, Other.
  - A label the API refuses or fails to save says so in a warning toast.
  - The overview's Recent transactions keeps its columns, with no type.
- Export opens a dialog: what the file holds, optional From and To days side by side, then the buttons.
  - The buttons are Cancel, Download statement (PDF) and Download CSV.
  - From and To are the browser's date fields, not the kit's DatePicker.
  - The kit's calendar opens inside its field, so the dialog's scrolling body would cut it off.
  - Above the days, a Records currency select (R-111) saves the profile's other currency as soon as it is chosen.
  - It lives here because the export adds its columns, and a phone's toolbar has no room for a second control.
  - Its hint says each amount also shows in it and the export adds it.
  - A failed save or read shows under it as the field's error.
  - Download statement (PDF) (R-113) sits between Cancel and Download CSV, as a secondary button.
  - It needs both days: a missing one is that field's own error.
  - A To before From is To's error, for the statement and the CSV alike.
  - The first field in error takes focus, and nothing is sent.
  - Without billing details the error line says why and ends with an Add billing details link.
  - That link opens billing details with a way back: saving them returns to Transactions.
  - Days with more transactions than one file holds (R-118) say to choose a shorter period.
- With a records currency, each amount has a quiet second line: the value as money in that currency.
  - The line is a small dotted-underline button; its tooltip, opened by hover, focus or tap, gives the ECB rate's day.
- Record pages (payment, invoice, client, store, job, link) open with `DetailHeader`; payments and invoices add an icon
  tile before the title and their amount as the figure beside the actions:
  - A 44px back link on phones, the title with its badges, one quiet meta line and the actions at the row's end.
  - Then the figure with its statuses.
  - The payment page has no next-step sentence: its badges, Amount figures and any notice say the state.
  - The body is the 2:1 grid with a Details panel on the side; phones stack it.
- Checkout (`/app/checkout`, merchants with invoices.write) takes a payment in person:
  - A form page: Store (when more than one), Amount in USD, Order reference and What it's for, then Show QR code.
  - Then the customer's side: the reference, `BigAmount` in USD and one QR code of the pay link.
  - Beside it a Checkout card: the status pill, one sentence and the close time; it checks every 3 seconds until decided.
  - Actions: Open payment, Copy payment link and Cancel checkout; once decided, New sale (lime) starts a fresh form.
  - A retried tap reuses the idempotency key; any change makes a new one.
- Clients (R-86) is laid out like Invoices: the toolbar's search (name, email, tax ID) with Add client at its end
  (beside the title on phones), then a table of the client with its initials avatar, billing email, country and tax
  ID, where a row opens the client (a long country gives way to the name on phones).
  - A client's page is a record page: New invoice (lime, `?client=<id>` fills the client), Edit and More actions.
    Its main column lists invoices that mention the client; Details sit on the side.
  - The form asks "Who is this client?": a person (full name, no tax ID) or a business (legal name, tax ID).
  New client and Edit client are
  form pages under Clients laid out like New invoice (Contact, Address and tax, and On invoices with the default PO
  or reference and the payment reminders default (R-97), as panels); Delete waits in the More actions menu at the page's top right and asks to confirm in a
  dialog, as Cancel does on an invoice.
- Stores (R-134) sits in a merchant's Payments group after Clients. It is laid out like Clients, without search.
  A store's page is a record page (project ID with Copy, View payments, Edit for stores.write) with its payments:
  - The toolbar holds a one-line intro, with Add store at its end (beside the title on phones).
  - The table shows the store, its project ID, when its checkout closes and its allowed origins.
  - New store and Edit store are form pages laid out like New client, with Store and Checkout panels.
  - Edit store shows the project ID with a Copy button. There is no delete yet.
  - An Accepted assets panel (R-136) uses the accepted-assets selector over the tokens the profile has on; one must
    stay chosen.
  - A Brand panel holds the logo and the accent color (R-135).
  - The logo shows in a bordered box with Upload or Replace logo, and Remove logo; a chosen file uploads at once.
  - New store says to save first, then add the logo.
  - Accent color is a text field for `#rrggbb` with the browser's color picker as its action.
  - New invoice shows a Store select in Details when the profile has two or more stores.
  - Picking a store sets the close to its default, unless a due date or the owner set one.
  - The return link's hint names the store's origins. The invoice list adds the store after the title.
- Payments (R-166, R-177) is the merchant's list of every customer payment: invoices, checkouts and link purchases.
  - All payments, Issues and Reconciliation use the segmented control; Export sits at the row's end.
  - One toolbar row: the search (order, invoice, customer or amount), then Status, Source and, with two or more
    stores, Store as select menus. Every filter stays in the URL.
  - Columns: Payment (the order reference, else the invoice number, else the title), Customer, Source, Store, Amount,
    Received, Status, Wallet, Created. Issues shows the issue in place of Wallet and Created: a warning
    dot, the problem in ink with its full text as the title, and "+n" for more.
    - Source and Store show only on the widest tables; the phone row and the payment page still name them.
    - Testnet is a neutral badge on each row, so it never outshouts a status that needs action.
  - The payment status and the wallet transfer are separate (D-114): a status badge, then quiet wallet text
    (Pending, In wallet, Delayed, Needs review, or a dash before anything is due).
  - Unpaid attempts stay visible; requested amounts never imply received or settled money.
  - Payment details use `DetailHeader` with the source's icon tile, the status and wallet badges by the title, and
    the requested amount as the header's figure beside Open checkout or Open receipt and Export (both 40px).
  - A notice under the header names each problem no other part shows, once (R-192).
    - Payment records to review, an unexpected transfer, a webhook that fails, money held on another option.
    - Extra money in Amount, the wallet transfer and what is still due are never repeated.
  - The body is two columns from extra-large screens: three fifths for the main column, two fifths (at least 24rem) beside it.
    - Main: Amount (Received with "Confirming, not final" or "Final",
      Returned to the payer once refunded, Extra held for the customer in the warning color or Still due while the
      checkout is open, and Paid with), Transfers, and the items.
    - Before money arrives the last figure is Accepts: an `AssetStack` and "4 options, the customer picks", or
      "Paying with" and the token once the customer locked one. "Paid with" only follows money.
    - Transfers is one table: Transfer (From customer or To your wallet, its time under it), State, Amount and the
      explorer link. Network shows from 2xl screens; on phones the state sits under the time.
    - State is a badge: Confirmed, "Confirming (n/m)" with the time left in an info tooltip, Confirming with
      "being verified", In wallet, or a warning such as Held for the customer. Amounts stay on one line.
    - Side: Details (reference, invoice, link, store, customer, checkout close, metadata, PDFs) and a Timeline:
      Created, Payment detected, Paid, In your wallet (or Checkout closed), done or current or next by the API's facts.
  - No ledger table or contract panel: a webhook that fails shows as a notice whose action opens Developers.
  - A list's Received amount over the request is in the warning color, with its reason as the cell's title.
  - Beside the money (two fifths of the width from extra-large screens) a Details panel links the order reference, the
    invoice, the payment link and the store, then the customer, the token, the checkout close, metadata and the PDFs.
  - Open checkout or Open receipt opens the pay page in a new tab, marked as the owner's preview.
  - Desktop rows stay on one line; phone rows show the same payment and wallet states in a compact stack.
  - The used token and network appear first; transaction links stay beside received amounts.
  - Payment detail uses "Confirming (9/599)" for each pending deposit; an info icon opens the estimated time remaining.
  - Wallet transfers use one compact state: Preparing transfer, Confirming or In your wallet.
  - Settlement transaction links remain visible while pending and after completion.
  - Finality estimates use observed receipt blocks and chain time; missing evidence never produces a countdown.
  - Normal confirmation waits never repeat as payment problems. Actual failures keep their required action.
  - A missing total shows "Confirming"; its info tooltip keeps remaining blocks and estimated time when available.
  - Normal detail polling requests only used options and options with money or actionable errors.
  - Test payments have a small Testnet label in lists, details and the public checkout header.
  - Layout references: [Stripe payment records](https://support.stripe.com/questions/view-payment-records-in-the-dashboard?locale=en-GB), [Adyen payment management](https://docs.adyen.com/account/manage-payments/), and [BitPay payments](https://support.bitpay.com/hc/en-us/articles/205769245-View-Payments-in-the-merchant-dashboard).
  - These examples separate payment identity, amounts and status from investigation details.

  - Each token and network keeps its own receive balance, merchant payable, payer-held funds and observed returns.
  - Movement rows show network, contract and signed receiver/payable/held changes; allocation rows never imply another token transfer.
  - Unused pending history creates no merchant warning. Conflicting evidence shows a short explanation and the required action.
  - Shared wallet transactions and invoice activity explicitly name their profile-wide scope.
  - Reconciliation follows recorded UTC periods; opening, changes and closing remain separate per store and token.
    - One row per token and store: Asset, Store, Status (a dot and Verified, Still checking or Needs review), the
      closing balance of each account, and Moved to wallet in the period. It shows no read time.
    - Search is always there; a segmented control filters by status with counts. Rows show 20 at a time.
    - A row's button opens its breakdown: each account's opening, changes and closing, then the checks.
    - The period is one `DateRangePicker`, as on both exports (Payments, Transactions).
    - Built for thousands of tokens: a search past 10, tokens with nothing in them folded away, 20 groups at a time.
    - The count line (verified, still checking, needs review) covers only the tokens the table lists.
  - Export follows validated filters and uses the existing date dialog pattern; invalid or unresolved filters disable export.
  - Invoices identify a customer by name or email; business tax fields remain optional, and personal requests retain their simpler flow.
  - Failed store, billing or token loads show explicit retry actions; empty acceptance never restores disabled tokens.
- Payment links (R-140) sits after Invoices in a merchant's Payments group and a freelancer's Get paid group.
  - It is laid out like Stores: a one-line intro with New link at its end (for roles that can make links), then a table.
  - The table shows the link with its `/l/<slug>`, the amount, a status badge and visits, paid purchases and reserved slots.
  - The status is On, Off, Ended, Cap reached or Setup needed; only On is green.
  - Test links keep their mode label in lists and details; public checkout shows Testnet beside the payee.
  - The link page reads one link (`GET /links/{id}`) and opens with `DetailHeader`: a link icon tile, the title with
    status and mode badges, "Payment link · Created …", the price as the figure and Edit payment link.
  - Main column: Visits, Paid (with its share of visits) and Checkouts open, then the purchases.
  - Side column (first on narrower screens): Share, with the address on its own row, Copy and Open (a new tab) and a
    QR code; then Details with the store, last day, payment cap and last update.
  - Open in Payments shows the same purchases on the Payments page with search and filters.
  - New and Edit use existing store-form panels; `/app/links/<id>/edit` edits the offer, while the existing detail URL remains valid.
  - Amount has two choice cards: A fixed amount, or The payer enters it with an optional min and max.
  - A new link opens on its page after saving, where the address shows with a Copy button.
  - Editing keeps the store selector disabled; failed store loading blocks the form with a retry action.
- Settings opens from its row at the sidebar's foot (see App shell); its sections share one frame.
  - Developers keeps the full content width: its tables need the room.
- Accepted assets (R-136) uses the accepted-assets selector: one row per asset, its networks under it.
  - A change saves at once; one quiet status line says Saving or Changes saved, never a toast per box.
  - The last token on can't be turned off; a quiet line under it says one stays on.
  - New invoice offers only the tokens on for the profile and the picked store.
- Developers (R-145) is in the sidebar's Build group for a freelancer's or merchant's owner and Admins. It is laid out like Team.
  - An intro line says keys belong on a server, with a Read the API docs link to `/docs`.
  - The profile ID follows, with Copy: the API's routes name it. API keys is a panel with a table, New key (lime) in its head.
  - Columns: Name, Key (`fw_test_…` and the last 4), Store (merchants), Access, Last used. Test mode shows once, on the panel.
  - New key is a dialog: Name, a Store select when there are two or more, and scope checkboxes.
  - After it saves, a dialog shows the key's text once, with Copy focused and Done.
  - A key's More actions menu holds Roll, with an overlap select, and Revoke, which confirms.
  - Roll ends on the new key's text, shown once; a rolled key shows when it stops and offers only Revoke.
  - Webhooks (R-149) follows for owners and Admins: a panel whose head holds the intro and New endpoint (secondary).
  - Columns: Endpoint (the description over the host and path), Store, Events, Status (On or Off), Last delivery.
  - With no description, the host and path lead the row, once.
  - The row never shows the URL's query, which may hold the receiver's token.
  - New endpoint is a dialog: URL, Description, a Store select for a merchant, event checkboxes and a Send events switch.
  - An endpoint's More actions menu holds Deliveries, Edit, Turn on or off, Signing secret, Rotate secret and Delete.
  - Signing secret shows the secrets with Copy, the old one with when it stops. Rotate and Delete confirm first.
  - Deliveries is a sheet: Send test event, a window select with Resend failed, then the newest deliveries.
  - While open, the sheet asks for the deliveries again every 15 seconds, so a test event turns Delivered.
  - A delivery row: the event and its invoice number, when, a status badge, Resend, and its attempts in a disclosure.
  - Results and errors in the sheet show in its status line, not as toasts.
- Team (R-139) is a Settings section for a merchant profile's owner and members.
  - It is laid out like the other sections: a title, an intro line, then panels.
  - An Admin sees Members, then Open invites, each a panel with a compact table (Member or Email, Stores, Role).
  - Invite sits beside the Members heading and opens a dialog: Email, a Role select with a hint, and store checkboxes.
  - The checkboxes show for Developer and Finance only.
  - A member's More actions menu holds Change role, a dialog like Invite without the email, and Remove, which confirms.
  - An open invite has a Revoke button. A member who isn't the owner sees their role and Leave team, which confirms.
- The invite page (`/invite/<token>`) is laid out like Stop reminders: the logo, then one centered panel.
  - Signed out, it shows the sign-in form under a line asking for the invited address.
  - Signed in, it names the team, then a details list (Role, Sent to, Signed in as, Expires), then Accept invite.
  - Signed in with another address, it says so in red with Sign out in place of Accept.
- Navigation by role (D-93): the sidebar, the phone tabs, ⌘K and the account menu show only the pages a role can use.
  - A role without the money pages has no Receive button and a bell with invoice events only.
- Jobs (R-101) sits in a freelancer's Get paid group after Invoices. It is laid out like Clients:
  - The toolbar searches the title and client, with New job at its end (beside the title on phones).
  - The table shows the job, client, total, state and created day.
  - Below xl the rows stack, as on Clients: the title, then the client and state, with the total on the right.
  - The state is "Waiting for acceptance" or "Accepted · 1 of 3 paid".
- New job is a step form under Jobs: Work, Client and Payments, with the client's quote as its preview.
  - Client works as on New invoice: a saved client fills the fields, and Name and Billing email are required.
  - Payments are rows like an invoice's items: title, Amount in USD and Days to pay, with a remove button each.
  - Add payment and the total follow the rows; a checkbox makes the first payment the deposit.
  - Without billing details it shows the same empty state as New invoice, which comes back here.
- A job's page opens with `DetailHeader`, as payments and invoices do: a briefcase tile, the title with Waiting for
  acceptance (neutral) or Accepted (success), "For <client> · Made <day>", the total as the figure and, until the client
  accepts, Delete job in the More actions menu. It has no next-step sentence: each payment's row says what to do.
  - From extra-large screens, Payments and Scope take two thirds; Client's link, Record and Billed to take the rest.
  - A delete the client's acceptance beat says so in a toast, and focus moves to the heading.
  - Once accepted, the next payment without an invoice has a small secondary Mark done button (R-103).
  - It opens a dialog: what it bills and to whom, an optional delivery link, Not yet and Mark done and send.
  - Marked done, focus moves to the new invoice's number, and a toast says whether the email went.
  - A payment marked done shows "Done <day>" and its Delivery link, which opens in a new tab.
  - Once accepted, a secondary Propose a change button sits under the total while no change waits (R-106).
  - It is gone once the job is finished: the last agreed payment is done. A deposit-only job keeps it.
  - It opens a dialog: what the change is for, Amount in USD, Days to pay, then Cancel and Propose change.
  - A change's line adds "Change ·" and either that it waits for the client, out of the total, or who accepted it.
  - A waiting change the client was emailed about adds where its link was sent.
  - A waiting change has a small secondary Withdraw instead of Mark done; focus moves to it once proposed.
  - Withdrawn, a toast says so and focus moves to the Payments heading.
  - While a change waits, the final payment says in quiet text that its invoice waits for the change, instead of Mark done.
  - Proposed, the toast names the address the link went to, or says to send the link when no email went.
  - Refused because a change waits or the job is finished: the dialog closes, a warning toast says why, focus goes to Payments.
  - Payments (left) list how each is invoiced and its due days, then its invoice number and status pill. Once
    accepted, its header says "n of m paid".
  - Scope follows Payments when there is one.
  - Client's link (right) is the shared `CopyValue`: the quote address on its own row, Copy and Open (a new tab), and
    who has to accept or who accepted as its note.
  - Record (R-104) follows Client's link as the kit `Timeline`, as on the payment and invoice pages: one done entry per
    event, oldest first, with its time.
  - Its events: Quote made, Accepted by (with the email here), each step marked done with its Delivery link, each
    invoice made, each invoice paid.
  - A change adds Change proposed (its title and amount) and its acceptance (with the client's email here).
  - Billed to follows Record, like an invoice's.
- Invoices table: the client has a round initials avatar. Phone rows lead with the client (or a request's note) beside
  that avatar carrying the network's logo, with the number and a short due date (no year within this year) under it,
  and the amount over the status pill on the right. From small screens up (and for requests, which have no table) a
  row is one line: the status in its own column before the amount. A request's note is no name, so its avatar keeps
  the document icon.
- Activity rows name what happened, then who and what for: "Payment · Mara Ilić", "Invoice created · INV-0042",
  "Held for the payer · order-1042". A deposit split between the owner and the payer reads "Payment, extra held for
  the payer". Pages follow the API's cursor.
  - Activity is a one-line table like Payments and Transactions: Event, Network, When, Status, Amount.
  - Narrower than the table, rows are two short lines; the whole row opens it.
  - A deposit opens its payment, an invoice row its invoice.
  - Requests use the Invoices table without Client, Due and Store; the note fills the Title column.
  - Money held for the payer is theirs: its amount and icon stay ink, never the success green.
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
- Onboarding checklist: the setup guide at the sidebar's foot (see App shell), never a card on the overview.
  Steps come from data: passkey linked, billing details (freelancer), first invoice or request, first paid in full,
  first final money in. Skipped steps are remembered per profile in the browser.
- Form pages stop at 56rem (`max-w-4xl`), so a field never runs across a wide screen; step forms use 72rem for the
  preview beside them, and settings pages sit in the settings frame.
  - The 56rem pages are Billing details, New profile and Email notifications.
  - Each field group is a full-width panel with its title ruled off. Billing details has Contact, then Address and tax.
  - Inside a panel, short fields pair up in two columns from small screens up.
  - The pairs: network and amount, title and reference, the dates, name and email, country and tax ID.
  - Request money pairs Your name with the return link.
  - A note, an address, an invoice's return link, a choice row or a list of rows takes the whole row.
  - A lone date keeps one column, in line with the dates above it. Phones keep one column.
- New invoice and Request money are steps: Customer, Items, Details, Review (a request has no Customer step).
  - A `Stepper` heads the form: a check on finished steps, which go back to them, the current one ringed.
  - Every step stays mounted, so Back keeps what was typed and the last submit reads every field.
  - Continue checks only its step (a customer name or email; the amount or items). Create invoice checks
    everything and returns to the step that holds the first error.
  - Review lists the customer, amount, network, due date and payment window, each with Edit.
  - The footer holds Back (or Cancel), then Continue or Create invoice at its end.
- New invoice, clients, stores, payment links and jobs share the step form layout (`StepForm`, `SPLIT_CLASSES`):
  - The form is one card: the stepper in its head, the step's fields, the footer with its buttons at its foot.
  - Inside it a field group is a titled section, not a panel of its own (`FlatFieldGroups`).
  - From extra-large screens the card and the preview fill the screen under the intro: the fields and the preview
    each scroll on their own, so the buttons never leave the screen.
  - Narrower screens scroll the page; the footer sticks to the bottom, above the phone tab bar.
  - The form takes 40rem; the preview takes the rest. A preview of a PDF (a client's Billed to) is light paper in both
    themes; a preview of a page (the pay page, the quote) follows the theme, as the page does.
  - Clients: Contact, Address and tax, On invoices; the preview is the Billed to block as invoices print it.
  - Stores: Store (name, checkout close, allowed origins), Brand, Accepted assets (when the profile has any).
    - A new store can pick its logo in Brand; it previews at once and uploads right after the store saves.
    - The preview is the pay page header, an `AssetStack` of what a payer can use, and the checkout close.
  - Payment links: Link, Amount, Limits; the preview is the pay page with the amount or range and the limits.
  - Jobs: Work, Client, Payments; the preview is the quote with its schedule and total.
  - Editing opens every step from the stepper (numbers, no checks) and puts Save on each step beside Continue.
  - Continue checks the step on screen; Save checks everything and opens the step of the first error.
- New invoice and Request money: each field group is a panel with its title ruled off.
  - New invoice opens with Customer, because who is billed comes first; then Amount, Details and Dates.
  - Customer asks "Who are you billing?": a business (Legal name, tax ID) or a person (Full name, no tax ID).
    Both have email, address and country, as on the client form. A saved client sets the choice.
  A freelancer or merchant without billing details sees, in place of the form, an empty state that says the invoice
  needs them with an Add billing details button (R-92); saving them there, or Cancel, comes back to New invoice.
  Dates on New invoice holds Supply date (R-89, optional, any day), then Due date, then Checkout closes after, so the
  due date sits next to the close it moves; the invoice page lists Supply date in Details after Created. Last in
  Dates, a Send payment reminders checkbox with a quiet line under it (R-97): a saved client sets it from its
  default, Duplicate copies it unless the client stopped them, and checked without a due date or client email it
  shows an error there. Then Repeat every month (R-99), the same kind of checkbox and line; checked, it shows Last
  due date (optional, from the due date on). Duplicate leaves it unchecked. Details on
  New invoice holds PO or reference (R-90) after Title, filled from the saved client's default when the client has
  one; the invoice page lists Reference first in Details. Add agreed value (secondary, small, last in Amount; not on
  Request money) shows Agreed in (a searchable currency list), Agreed amount and Agreed on (today, no later day) in
  one row from small screens up, with a remove button and a quiet line that the client still pays the amount above
  (R-93); the invoice page lists Agreed value in Details after Supply date.
  Picking a due date switches Checkout closes after to Custom on the due date plus 60 days (D-80), with one quiet line
  saying why; a close the owner picks before that day stays allowed, with a warning line (icon and warning text, as on
  the pay page) that a later payment would be held for the payer.
  Add item (secondary, small, under the amount; not on Request money) turns the amount into item rows (R-88), the
  amount typed so far becoming the first item's price: Item, Qty, Price (in the amount's unit) and the line's amount,
  with a remove button. From small screens up the rows line up under one header row and the field labels are for
  screen readers only; on phones each item stacks (description, then Qty and Price with the remove button, then its
  amount). A ruled footer holds Add item and the Total, which is the invoice's amount; a line the token can't hold
  shows its error under the field it belongs to. Removing the last item leaves its total as the amount.
  The invoice page lists the items in an Items panel: each row the description with "qty × unit price" quietly under
  it and the line's amount on the right, then Total, Received and Still due, the same on every width.
  - Without items the panel is Summary, with those three rows only. Received counts money sent before the close.
  - Received and Still due show only on a one-token invoice: other tokens' money is in other units.
  - The side column holds Details, then a Timeline: Created, Emailed to the client (once sent), Pay page opened (with
    how many times), Paid, In your wallet (or Checkout closed, or Canceled).
  It uses the step form layout below: the card and the preview fill the screen and scroll on their own.
  - Its tabs are Invoice, Payer page and Email; switching keeps every typed value.
  - Invoice draws the PDF (`InvoiceDocument`): A4 pages in mm with the PDF's blocks, sizes, Noto Sans face and page
    breaks, on white paper in both themes. The number reads Draft until the invoice exists.
  - When the payer picks the token, Pay this invoice says "Pay <amount> in one of the available options." and how
    to pick; it never lists the networks. A fixed token says the exact amount, network and contract.
  - Payer page shows the pay page's first screen; Email shows the invoice email's layout.
  - Narrower screens switch between Edit and Preview with a segmented control; the form stays mounted.
- Money actions are round icon buttons with the label underneath, on desktop and phones. Only the view's main
  action is filled with the lime; other working actions are surface circles, and coming ones are subtle.
  In the header, Send is a dashed outline button in the subtle color until it is built.
- Personal overview actions: Receive (lime, the QR icon), Request, Send, Transfer, Withdraw, in one row with a narrow
  gap on phones.
  Request (also in ⌘K) opens the Request money page (R-71) with amount, note, checkout expiry and the name the payer
  sees, then opens the new request with its pay link. A personal profile's invoices are Requests in the sidebar, list
  and breadcrumb.
- In the desktop sidebar, a feature that is not built yet keeps its place in the subtle text color, with "Soon" as
  plain text at the end: no badge, no link. A disabled action says why in its accessible name and shows "Coming soon" in a tooltip on
  hover, focus or tap; no notice text is added to the page.
- A toast is only for an event the user did not just do on that spot: a payment detected or settled while the app is
  open, or a save that leaves the page (billing details, a client saved or deleted). A payment toast uses the bell's
  words and names the payment: "Payment received" or "In your wallet". Errors and anything that needs an answer stay inline beside
  their field or form. Toasts sit top right on desktop and above the tab bar on phones, as solid surface panels with
  the float shadow; at most three, each gone after 5 s unless hovered, focused or the tab is hidden, with a close
  button. They enter from the edge they sit on and leave faster than they came. Screen readers hear them through a
  polite live region.

## Checkout

- Document-free checkout shows "Checkout" under the payee and offers no invoice PDF.
- Issued invoices and legacy link documents keep their existing invoice labels and PDF access.
- Both workflows offer a receipt after canonical payment success.

- `/l/<slug>` (R-142), a payment link's page, is split as the invoice checkout below, with the same backdrop and footer.
  - Left: the payee tile and name with "Payment link" and the Testnet badge, the link's title, then the amount in
    USD (fixed) or its range (open).
  - Right, in a card in the middle of the screen's height: "Pay with stablecoins", "You pick the token and network on
    the next page", an Amount (USD) field for an open link, then Pay.
  - A link that is off, ended, full or unready explains why, with no Pay.
  - Pay first records one purchase identity, original amount and offer version in the URL.
  - Returning or refreshing offers Continue this checkout and Start another purchase; independent visitors never share an attempt.
  - Uncertain failures preserve that identity; changed offers require reviewing a new purchase.
  - Focus moves to the pending heading, then to the amount or offer heading when starting another purchase.
  - A bad amount shows on the field and focuses it; a busy or failed Pay says so under the button.
- `/pay/<token>` (R-68) is the payee's page, laid out as hosted checkouts split it. It has no Forwend header: Forwend
  shows only in the footer.
  - From large screens the page is two halves that fit one screen, with no page scroll for a usual invoice.
    - Left half: the summary on surface-2 (the pay card's surface in the dark theme). The landing footer's ridges
      run along its foot at 70%, under one soft wash in the store's color or brand lime. Its content is at most 26rem
      and ends 4rem left of the center.
    - The payee row leads it, with the Testnet badge at its right; then the amount, the items as plain rows, the
      reference, dates, note and PDF link. "Payments by Forwend · Need help?" sits at the half's foot.
    - Right half: "Closes in …" at its top right like a header while the checkout can take money (warning color in the
      last 30 minutes). The pay panel, at most 28rem and starting 4rem right of the center, stands in the middle of the
      screen's height.
    - "Send only <token> on <network>." is one line, small, on its own row under the code and amount.
  - Phones: the pay panel comes right after the amount; the title, dates, note and PDF link follow it. The payer reaches
    the address first.
  - Left, top. It says only who asks and how much:
    - The payee name beside a square ink tile with its initial in the page color. No border or ring.
    - A merchant store's logo (R-135) takes the tile's place, in a light box as tall as the tile, without a border.
    - The box stays light in the dark theme too, since most logos are drawn for a light page.
    - "Invoice INV-0001" under the name; a payment-link invoice before its first deposit reads "Invoice" alone (R-141).
    - A test-mode invoice (R-143) starts the column with a warning box: its testnet tokens have no value.
    - The amount (tabular figures, featured size) and "on <network>". USD until the payer picks.
  - Left, then, as a hosted invoice page lists them:
    - Title, reference (R-90), agreed value (R-93) and due date: quiet rows with a small icon, no rules.
    - The note.
    - Replaced (R-129): under the canceled line, "This invoice was replaced by INV-0012. Pay that one instead." and a
      small Open INV-0012 button to its pay page.
    - Updates (R-128), when the issuer edited before payment: a small quiet heading over one line per change.
      - Newest first. Each line is the time, then "Due date moved from … to …", "Note updated" or "Reference updated".
    - Download invoice PDF: an underlined link with a file icon.
  - Right: one panel. While money is due, top to bottom:
    - Pay with: the one option as a token mark, or Network and Token selects (they scale to many chains and tokens).
    - A Show address button.
    - The QR, and beside it the exact amount and the warning line "Send only USDC on Base Sepolia." with a warning
      icon. The warning uses the small size on phones, so it stays on one line beside the QR down to 360 px. Where a
      bridged look-alike exists, it adds "Native USDC, not USDC.e."
    - The address, full width.
    - The token contract as a short explorer link, and one exchange hint that names the network to withdraw on.
  - Amount and address boxes:
    - On the surface, with the fields' quiet edge. Icon-only Copy actions. No nested button outlines.
    - The address is Geist Mono. First 6 and last 4 characters in the ink (medium weight); the rest quieter.
    - The address is always whole and on one line (R-78). Text scales with the field's width.
    - The copy icon sits beside the label, so the address keeps its full width on phones and in Receive.
    - A successful copy turns the icon into a check and announces the result.
  - After the address shows:
    - The picked network and token fold into one row with a quiet Change.
    - Change turns into "Confirm change". Only a second press starts over; leaving the button cancels. A payer who
      already sent can't switch by accident.
    - Under the address, one row: "Waiting for payment…" with a pulsing dot, and Check status on its right.
    - "This page updates on its own." sits quietly under the waiting line.
    - What a check found, and when the next check is allowed, take their own line below. The button never moves.
    - Nothing waits before the address shows.
  - Once money is seen:
    - The panel keeps its place ("Paying with" while nothing more is due).
    - With nothing more due, the status leads the panel: "Payment detected".
      - Then the steps, one status line beside them, and "Don't pay again. This page updates on its own."
      - The Paying with row follows, folded to one line.
    - The steps are Detected, Confirming and Paid. Partially paid is tinted on Paid.
      - Confirming stays current until the API books the money: final on chain but not booked is still Confirming.
      - A delay changes the line, never the steps: "Confirmation is taking longer than usual." No time is promised.
    - One line for what the steps can't say: the block count, "Awaiting confirmation.", or what is left to pay.
    - Money over the amount: "You sent X more than asked. The extra is held for you; ask <payee> to get it back."
      It shows under the payments while confirming and on the receipt once paid (D-24).
    - Each payment with its amount, time, short hash and explorer link.
    - The address stays only while money is still due.
  - Receipt email, once money is seen and once paid:
    - The panel's last row is "Email me a receipt" with a mail icon.
    - Pressing it opens the optional field there, with Send inside its row and a line that the address is used for this
      receipt only (R-82).
    - Before any money the row is not there: there is nothing to send a receipt for.
  - Confirmed returns show their recorded amount, network and latest transaction beside the payment record.
  - Conflicting evidence and exceptional authority movements show a short review notice and block sending.
  - Empty pending history does not hide the payment address. Observed money stays Confirming until its evidence passes.
  - Testnet appears beside the Forwend header as a warning badge instead of a warning paragraph.

  - A closed option keeps the selector when another option remains available. Each address uses its own effective close.
  - Closed: one line that says so.
  - Paid: a left-aligned receipt replaces the panel.
    - A check that scales in, beside "Paid" and "You can close this page."
    - Ruled label and value rows: Amount, Paid to, Date, and Transaction with a View transaction link to the explorer.
    - Download receipt, a full-width button. Primary; or secondary under a full-width primary Back to <host> when the
      invoice has a return link.
  - The payer never sees the wallet transfer, status badges or an overpaid line (PLAN 11.10.1).
  - Copy names the payee, or "the invoice's creator". Never "the sender".
  - Footer: one quiet line.
    - "Payments by" with the mark and Forwend, opening the site in a new tab.
    - "Need help?" opens a dialog with the rules (where you are, refunds, scams, the unverified name), so the pay box
      never grows.
- No image and no glass; it follows the system theme. When a refresh fails the page keeps the last read and says it
  may be out of date. The invoice PDF link stays in every state; the receipt link appears once paid.
- PDFs open through the same-origin `/api` path. The invoice detail lists them under Documents: the invoice PDF
  always, the receipt PDF once paid.
- While a payment confirms, the step label stays "Confirming"; one full-width row below the steps shows "Confirming (4/12)"
  and a small info icon whose tooltip says "About 19 min left". Keep the count out of the narrow
  step columns on both payer and owner pages, including four-digit counts on phones. Its ring fills as blocks pass
  (a turning quarter until the first block passes); done, the step reads "Confirmed". The count is blocks passed of those the
  payment had to wait when first seen, from the API, so a reload keeps it (R-73). The live status announces the count; the estimate opens on hover, keyboard focus or tap.
  The owner's steps are Waiting, Detected, Confirming, Paid and In wallet.
  - Done, now and next differ by shape: a filled ink disc with a check, a ring, and an empty circle.
  - The line to the next step is ink once a step is done.
  - The current ring fills only by real evidence (blocks passed, or the share received when partly paid, R-69).
  - Without a known share it turns; reduced motion keeps a still quarter. Nothing fills because time passed.
  Up to four steps always sit side by side (the payer's timeline, the landing's samples). The owner's five don't fit a
  phone, so in a container narrower than 28rem they stack into one upright list of markers beside larger labels.
- A test-mode invoice's page (R-143) has a warning Test mode badge under its header's name.
- The invoice page (R-60) says each thing once.
  - The header names the invoice by its number, with its status badges (the confirming count while confirming).
  - One line under it: the title, Billed to, the due date, "Received X of Y" when partly paid, and who picks the token.
  - Details says the times: when the checkout closes ("Checkout closed" once past) and, once canceled, Canceled on.
  - At its top right sits one More
  actions menu: Copy link and Open pay page (a new tab) while the checkout can take money, Edit always (R-127),
  Revise while it can still be canceled (R-129), Duplicate always (New invoice filled from this one, R-91), and while
  it can still be canceled, Cancel in the danger color, which asks to confirm in a dialog. Copying keeps the menu
  open and the item says Link copied; if the clipboard refuses, the whole link shows there to select. Below, two
  columns from extra-large screens up: the amount ("Received X of Y" under it when partly paid) with the timeline, where
  the Paid step reads "Partially paid" as a warning-tinted label when partly paid, the status line (only the confirming
  count or why settling waits; the state itself is the timeline's), one Transactions list (each payment, then the
  settlement to the wallet, later refunds: kind, amount, the other side, time and hash with its explorer link, no status
  pill of its own; Details repeats none of them) and Check status only while the checkout can take money.
  - The main column then holds the Items panel, then Billed to and From side by side, as on a paper invoice.
  - History (R-124) ends the main column: a ruled table of changes, newest first, like the other tables.
    - Columns: Event, By (You, Payer, Forwend), Details and Time, which sits on the right.
    - Event is the short name in medium weight after a dot in its category's color: payments success, changes subtle,
      emails info.
    - Details holds what the name leaves out: the amount with its token, the network, a settle's hash and explorer link.
      Without any, a quiet dash.
    - An email's Details say who it went to, or a reminder's step: "On the due date".
    - A Revise's rows name the other invoice: "By INV-0012" on Replaced, "Replaces INV-0007" on the new one's Created.
    - Reminders stopped says it came from the reminder email's stop link.
    - Time is the short date and time; the year shows only for another year.
    - Under 36rem of panel width each change is two lines: the event with the time on the right, then By and Details.
    - A small segmented control in the head shows All, Payments, Changes or Emails.
    - Under the table, ruled off, one quiet line says how often the pay link was opened, first and last (R-125).
    - An invoice made before pay links (R-114) has no such line.
  - Billed to and From share one height. They stack while the column is under 36rem; a request's From fills it.
  - Beside the main column, a third of the width, sits the details panel (empty rows left out).
  - Your memo (R-127) is a Details row after the note: the owner's own text, stacked under its term.
  - Replaced by and Replaces (R-129) are Details rows after Canceled on, each the other invoice's number as a link.
  - From shows "None on this invoice" with a link to add billing details when there are none.
  - Narrower screens stack the amount, Items, Billed to, From, History, then the details.
  - A transaction is one row once its list is 42rem wide. Narrower, the list's own width, not the screen's, splits it
    in two lines.
- Under the title, an exception says what happened and offers its next step (R-77).
  - A checkout that closed partly paid offers New invoice for the rest.
  - While the API's `reopenUntil` is set, Reopen checkout sits before it (R-130).
  - Reopen asks to confirm in a dialog that names the new close and says it happens once.
  - Once reopened, focus moves to Details' Checkout closes row, which shows the new close.
- Revise (R-129) opens New invoice filled from the invoice, under a warning-tinted notice:
  - "This replaces INV-0007", then that creating it cancels the old one and its pay link shows the new one.
  - When the old one was emailed or its link opened, when and how often, and that money still sent to it is held.
  - Too late (money arrived, the checkout closed or it was already canceled): the form's error says it can't be
    replaced now.
  - When the invoice to replace can't be read, the page shows an alert with Try again and no form.
- Edit (R-127, R-128) opens one dialog in two groups, each a small bold heading over its fields.
  - Any time: Memo (a text area with "Only you see it"), Client email and Return link.
  - Before payment: Reference, Note and Due date, with a line that the payer sees these under Updates.
  - A request shows only Note there, as its form has no reference or due date.
  - The due date picker runs from today to the day the checkout closes, which its hint names.
  - Once money arrived or the checkout closed, the group is disabled and its line says why.
  - A request has no Client email field.
  - Edit shows once the owner's read is in, so it never starts from another invoice's values.
  - Save changes saves every field and closes with a toast.
  - A refused value shows its error under its field.
  - However the dialog closes, it opens next time on what is saved.
- Billed to ends with Send to client (R-94), ruled off under the client:
  - Each send in a quiet list: "Emailed · <time>", "Sending to <address>…" or "Could not email · asked <time>".
  - A past send names no address: the client email can change after it (R-127). The list stays without an email.
  - While the checkout can take money, a small secondary Send to client button. A day after the last send it returns;
    until then a quiet line says when.
  - Without a client email, while the checkout can take money, one quiet line says it can't be emailed.
- Payment reminders (R-96) follow Send to client in Billed to, ruled off, as a settings row:
  - They show with a client email, or while on after it was cleared, so they can be turned off.
  - The Payment reminders switch at the row's end, saved when flipped, with a toast.
  - Under it one quiet line: the schedule, "Reminders need a due date", or when the client stopped them.
  - Then each reminder: its step and "emailed <time>", "sending…" or "could not be sent".
  - Stopped by the client, the switch stays off and can't be turned on.
- Repeats every month (R-99) follows Payment reminders on each invoice of a retainer, ruled off:
  - Under its title one quiet line: the next due date and the day it is emailed.
  - With a Last due date, the line adds that no invoice is due after it.
  - Once no more invoices are made, the line says so; once stopped, it says when.
  - While it runs, a small secondary Stop repeating button. It asks in a dialog, since it can't be undone.
  - Once stopped, focus moves to that line.
- The stop reminders page `/reminders/<token>` is public, like the pay page: the logo, then one centered panel.
  - It asks "Stop payment reminders?" with one primary button, since mail scanners open links.
  - Once stopped, focus moves to the heading "Reminders stopped", and one line names the invoice and its sender.
- The quote page `/w/<token>` (R-102) is public too, split as the checkout pages, with Forwend only in the footer.
  - Left half, on the same backdrop: the issuer tile and name with "Quote", the job's title as the heading, the total
    with "in n payments", then Payments, The work and From as plain sections.
  - Payments list how each is invoiced, its due days and amount, with the total under them.
  - Right half, in the middle of the screen's height: Accept this quote (what accepting agrees to, Your name, Your
    email, Accept quote), then the Record.
  - Once accepted, Quote accepted takes the form's place and focus: who accepted and when.
  - Pay the deposit is then the page's main button.
  - Another made payment shows a small Pay button while it takes money, else its number and status pill.
  - A delivered step links "See the delivered work" under its line.
  - A change's line adds "Change ·" and either that it waits, out of the total, or who accepted it and when.
  - A waiting change has its own bordered form under its line: what accepting agrees to, the name, email, Accept change.
  - Accepted, focus moves to the change's line, which now says who accepted it.
  - A change withdrawn before the accept: a notice in danger text opens the Payments panel and takes focus.
  - The quote's and the change's forms are one consent form: the change's is the compact one.
  - Record is the job page's timeline, without the client's email.

## API docs

- The public API docs at `/docs` (R-155) need no sign-in. A slim header holds the logo, linked home, and the theme switch.
  - One column of reading width: the heading, an intro, then an On this page panel of links to each section.
  - From large screens the On this page links sit in a sticky column beside the text instead.
  - Each section is a heading, short text and bullets, with `code` set in mono, and a code block where it helps.
  - Links use the shared link style: accent and underlined, as `buttonClasses({ variant: "link" })` gives.
  - The changelog closes the page, newest date first. The landing page's developer section links here.

## Emails

- Every email is one layout (`apps/backend/internal/notify/layout.html.tmpl`) in the Signal look.
  - The logo and name above one white card with a hairline and 16px corners, on the light grey ground.
  - A status badge in the tone pairs; the title semibold; the amount large with tabular figures.
  - Detail rows ruled like a statement; links are underlined ink.
  - One action: the lime button with its olive edge and 10px corners. Its padding sits on the link, so the whole
    button is the target; it is text, never an image.
  - Type is the system stack: mail clients don't load Hanken Grotesk.
  - The logo is decorative (`alt=""`): the name beside it says Forwend with images off. No fact lives in an image.
  - Colors are the token values for both schemes, with `[data-ogsc]` rules for the Outlook app's dark mode.
  - Dates read "30 Nov 2026", as in the PDFs. `html/template` drops HTML comments, so no Outlook conditionals.
- Invoice and receipt PDFs (`apps/backend/internal/document`) keep Noto Sans: it covers Greek and Cyrillic names.
  - Labels are sentence case, never tracked capitals; dates read "28 Oct 2026, 13:00 UTC".

## Theme and behavior

- An empty list, or one filtered to nothing, is one centered block in the list's place (R-75): an icon in a soft
  circle, a title ("No invoices yet", "Nothing matches"), a line or the next step under it ("Clear filter and
  search"), as wide as the list and at least about half the screen tall. Inside an overview card it drops its frame
  and most of its height.
- A notice (`Notice`) is one short warning line across the view's full width.
  - At most one action sits at its end, such as Try again.
  - It is for what concerns the whole view: a refresh that failed, or a problem the view shows nowhere else.
  - Plain words, never blame: say what happened and what to do, not whose money it is.

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
- Motion rules (the motion tokens; the only ones the app uses):
  - Press: a button scales to 0.98 (a round action to 0.95) on `duration-fast`; color changes use the same.
  - Enter from an edge: menus, toasts and the phone sheet rise from where they open on `duration-base` with
    `ease-out`, and close at once.
  - Disclosure: the chevron turns on `duration-fast`; the content appears without a height animation, since
    tables inside can be long.
  - Data: typing, filtering, polling and new rows never animate. A list waiting for a new filter dims its last rows
    (opacity, `duration-fast`) and keeps their place.
  - Progress: a bar fills once with `ease-out` on `duration-slower`; a spinner turns while work runs.
  - Reduced motion removes movement and keeps every state change (color, text, the filled bar).
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
- Receive uses one token/network summary, a centered QR on a surface-2 tile that follows the theme (the code alone stays
  dark on light), the full address with a copy icon, the network warning and
  a short note. Avoid nested cards around the QR.
- Fixed navigation and page edges respect safe-area insets; zoom stays enabled and touch text inputs use the base
  font size. Amounts and addresses remain selectable.
- A keyboard skip link moves directly to app content. Focused content clears sticky navigation. Native modal
  dialogs contain scrolling and lock the page behind them; the scrollbar's room stays reserved, so the page never
  shifts sideways when one opens. Close buttons use the shared icon control.
