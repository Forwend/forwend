# Design

Direction: Dawn Path marketing, dark Dusk Ledger product bands, Halftone Horizon texture (PROJECT D-13).
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
  - Sign out everywhere (R-137) follows Sign out and asks first: Keep me signed in, or the danger Sign out everywhere.
- Confirm it's you (R-137) opens over any page when a change needs a fresh sign-in.
  - It sends the code to the login email at once and says where; the code boxes are the sign-in page's.
  - Send a new code, Cancel and Confirm sit at its foot. Confirm repeats the change; Cancel leaves it unsaved.
  - A user with no email login reads that they need one, with Close.
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
- Owed to you (R-95) sits under Summary on the business overview:
  - A ruled header with the title and, when something is left, the USD total at its right.
  - Rows like the invoice list's: the client (or title, or number), then the number and "12 days late" (warning
    color), "Partly paid" or "Held for the payer".
  - The amount sits on the right; unpaid rows say "left to pay" under it. Held money is never in the total.
  - Five rows, then Show all n, which moves focus to the first row it adds. Nothing owed says so in one quiet line.
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
- Clients (R-86) is laid out like Invoices: the toolbar's search (name, email, tax ID) with Add client at its end
  (beside the title on phones), then a table of the client with its initials avatar, billing email, country and tax
  ID, where a row opens the client (a long country gives way to the name on phones). New client and Edit client are
  form pages under Clients laid out like New invoice (Contact, Address and tax, and On invoices with the default PO
  or reference and the payment reminders default (R-97), as panels); Delete waits in the More actions menu at the page's top right and asks to confirm in a
  dialog, as Cancel does on an invoice.
- Stores (R-134) sits in a merchant's Payments group after Clients. It is laid out like Clients, without search:
  - The toolbar holds a one-line intro, with Add store at its end (beside the title on phones).
  - The table shows the store, its project ID, when its checkout closes and its allowed origins.
  - New store and Edit store are form pages laid out like New client, with Store and Checkout panels.
  - Edit store shows the project ID with a Copy button. There is no delete yet.
  - A Networks and tokens panel (R-136) has a checkbox per token the profile has on; one must stay checked.
  - A Brand panel holds the logo and the accent color (R-135).
  - The logo shows in a bordered box with Upload or Replace logo, and Remove logo; a chosen file uploads at once.
  - New store says to save first, then add the logo.
  - Accent color is a text field for `#rrggbb` with the browser's color picker as its action.
  - New invoice shows a Store select in Details when the profile has two or more stores.
  - Picking a store sets the close to its default, unless a due date or the owner set one.
  - The return link's hint names the store's origins. The invoice list adds the store after the title.
- Payment links (R-140) sits after Invoices in a merchant's Payments group and a freelancer's Get paid group.
  - It is laid out like Stores: a one-line intro with New link at its end, then a table.
  - The table shows the link with its `/l/<slug>`, the amount, a status badge and "N visits, M paid".
  - The status is On, Off, Ended (past its last day) or Cap reached; only On is green.
  - Test links have a Test mode badge in lists and details, and the invoice warning on their public page.
  - New and Edit are form pages like Edit store, with Link, Amount and Limits panels.
  - Amount has two choice cards: A fixed amount, or The payer enters it with an optional min and max.
  - A new link opens on its page after saving, where the address shows with a Copy button.
- Networks and tokens (R-136) opens from the account menu, after Email notifications, for every profile.
  - It is laid out like Email notifications: one panel with a switch per token, named "USDC on Base Sepolia".
  - A switch saves at once and says so in a toast.
  - The last token on can't be turned off; a quiet line under the panel says one stays on.
  - New invoice offers only the tokens on for the profile and the picked store.
- Developers (R-145) is in the sidebar's Build group for a freelancer's or merchant's owner and Admins. It is laid out like Team.
  - An intro line says keys belong on a server, with a Read the API docs link to `/docs`.
  - The profile ID follows, with Copy: the API's routes name it. API keys is a panel of rows, with New key beside its heading.
  - A row: the name, then `fw_test_…` and the last 4, the store and the scopes, then the last use. A Test mode badge.
  - New key is a dialog: Name, a Store select when there are two or more, and scope checkboxes.
  - After it saves, a dialog shows the key's text once, with Copy focused and Done.
  - A key's More actions menu holds Roll, with an overlap select, and Revoke, which confirms.
  - Roll ends on the new key's text, shown once; a rolled key shows when it stops and offers only Revoke.
  - Webhooks (R-149) follows for owners and Admins: a heading with an intro line, then a panel of endpoint rows.
  - Its row: the description, then the host and path, the store and the events. Off and Test mode badges.
  - With no description, the host and path lead the row, once.
  - The row never shows the URL's query, which may hold the receiver's token.
  - New endpoint is a dialog: URL, Description, a Store select for a merchant, event checkboxes and a Send events switch.
  - An endpoint's More actions menu holds Deliveries, Edit, Turn on or off, Signing secret, Rotate secret and Delete.
  - Signing secret shows the secrets with Copy, the old one with when it stops. Rotate and Delete confirm first.
  - Deliveries is a sheet: Send test event, a window select with Resend failed, then the newest deliveries.
  - While open, the sheet asks for the deliveries again every 15 seconds, so a test event turns Delivered.
  - A delivery row: the event and its invoice number, when, a status badge, Resend, and its attempts in a disclosure.
- Team (R-139) opens from the account menu, after Networks and tokens, for a merchant profile's owner and members.
  - It is laid out like Networks and tokens: an intro line, then panels.
  - An Admin sees Members, then Open invites, each a panel of rows with the email, its stores and a role badge.
  - Invite sits beside the Members heading and opens a dialog: Email, a Role select with a hint, and store checkboxes.
  - The checkboxes show for Developer and Finance only.
  - A member's More actions menu holds Change role, a dialog like Invite without the email, and Remove, which confirms.
  - An open invite has a Revoke button. A member who isn't the owner sees their role and Leave team, which confirms.
- The invite page (`/invite/<token>`) is laid out like Stop reminders: the logo, then one centered panel.
  - Signed out, it shows the sign-in form under a line asking for the invited address.
  - Signed in, it names the team and role, with Accept invite.
  - Signed in with another address, it says so in red with Sign out in place of Accept.
- Navigation by role (D-93): the sidebar, the phone tabs, ⌘K and the account menu show only the pages a role can use.
  - A role without the money pages has no Receive button and a bell with invoice events only.
- Jobs (R-101) sits in a freelancer's Get paid group after Invoices. It is laid out like Clients:
  - The toolbar searches the title and client, with New job at its end (beside the title on phones).
  - The table shows the job, client, total, state and created day.
  - Below xl the rows stack, as on Clients: the title, then the client and state, with the total on the right.
  - The state is "Waiting for acceptance" or "Accepted · 1 of 3 paid".
- New job is a form page under Jobs, laid out like New invoice, with Work, Client and Payments panels.
  - Client works as on New invoice: a saved client fills the fields, and Name and Billing email are required.
  - Payments are rows like an invoice's items: title, Amount in USD and Days to pay, with a remove button each.
  - Add payment and the total follow the rows; a checkbox makes the first payment the deposit.
  - Without billing details it shows the same empty state as New invoice, which comes back here.
- A job's page has the title as its heading and, until the client accepts, Delete job in the More actions menu.
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
  - Payments (left) list how each is invoiced and its due days, then its invoice number and status pill.
  - Scope follows Payments when there is one.
  - Client's link (right) says who has to accept or who accepted, and shows the link with Copy link and an open link.
  - Record (R-104) follows Client's link: one line per event, oldest first, the time in quiet text before what happened.
  - Its events: Quote made, Accepted by (with the email here), each step marked done with its Delivery link, each
    invoice made, each invoice paid.
  - A change adds Change proposed (its title and amount) and its acceptance (with the client's email here).
  - Billed to follows Record, like an invoice's.
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
- Form pages fill the content width, as lists do, with no fixed narrow column beside empty space.
  - They are New invoice, Request money, New job, New and Edit client, Billing details, New profile and Email
    notifications.
  - Each field group is a full-width panel with its title ruled off. Billing details has Contact, then Address and tax.
  - Inside a panel, short fields pair up in two columns from small screens up.
  - The pairs: network and amount, title and reference, the dates, name and email, country and tax ID.
  - Request money pairs Your name with the return link.
  - A note, an address, an invoice's return link, a choice row or a list of rows takes the whole row.
  - A lone date keeps one column, in line with the dates above it. Phones keep one column.
- New invoice and Request money: each field group (Amount, Details, Dates, Client) is a panel with its title ruled off.
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
  The invoice page lists the items in an Items panel under Amount: each row the description with "qty × unit price"
  quietly under it and the line's amount on the right, then a ruled Total row, the same on every width.
  From extra-large screens a sticky Preview panel takes a third of the width beside the form. It echoes the form in
  the pay page's order: the title, then the amount with how it is paid. Billed to (Shown as for a request), Due and
  Checkout closes after follow as ruled rows, then the note. It is hidden from screen readers, since the fields
  already say all of it.
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

- `/l/<slug>` (R-142), a payment link's page, is one narrow column with the pay page's logo and footer.
  - Top: the pay page's payee tile and name, "Payment link" under it, then the link's title.
  - A fixed link shows its amount in USD; an open one has an Amount (USD) field whose hint gives the limits.
  - Pay is the one button, with "You pick the token and network on the next page" under it.
  - A link that is off, ended or full shows why in a quiet box, with no Pay.
  - A bad amount shows on the field and focuses it; a busy or failed Pay says so under the button.
- `/pay/<token>` (R-68) is one short screen. The logo links home.
  - Wide screens: the invoice on the left, how to pay on the right.
  - Phones: the pay panel comes right after the amount; the title, dates, note and PDF link follow it. The payer reaches
    the address first.
  - Left, top. It says only who asks and how much:
    - The payee name (no display serif) beside a square tile with its initial, on a bordered surface tile.
    - A merchant store's logo (R-135) takes the tile's place, in a bordered box as tall as the tile.
    - The box stays light in the dark theme too, since most logos are drawn for a light page.
    - The store's color is that box's or tile's edge. It never sits behind text, so any color keeps the contrast.
    - "Invoice INV-0001" under the name; a payment-link invoice before its first deposit reads "Invoice" alone (R-141).
    - A test-mode invoice (R-143) starts the column with a warning box: its testnet tokens have no value.
    - The amount (Geist, tabular, featured size) and "on <network>". USD until the payer picks.
  - Left, then, as a hosted invoice page lists them:
    - Title, reference (R-90), agreed value (R-93), due date and "Closes in …": quiet rows with a small icon, no rules.
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
    - What a check found, and when the next check is allowed, take their own line below. The button never moves.
    - Nothing waits before the address shows.
  - Once money is seen:
    - The panel keeps its place ("Paying with" while nothing more is due).
    - The steps Detected, Confirming and Paid fade in; the waiting one moves. Partially paid is tinted on Paid.
    - One line for what the steps can't say: "Final check", or what is left to pay.
    - Each payment with its amount, time, short hash and explorer link.
    - The address stays only while money is still due.
  - Receipt email, once money is seen and once paid:
    - The panel's last row is "Email me a receipt" with a mail icon.
    - Pressing it opens the optional field there, with Send inside its row and a line that the address is used for this
      receipt only (R-82).
    - Before any money the row is not there: there is nothing to send a receipt for.
  - Closed: one line that says so.
  - Paid: a left-aligned receipt replaces the panel.
    - A check that scales in, beside "Paid" and "You can close this page."
    - Ruled label and value rows: Amount, Paid to, Date, and Transaction with a View transaction link to the explorer.
    - Download receipt, a full-width button. Primary; or secondary under a full-width primary Back to <host> when the
      invoice has a return link.
  - The payer never sees Settled, status pills, testnet notes or an overpaid line (PLAN 11.10.1).
  - Copy names the payee, or "the invoice's creator". Never "the sender".
  - Footer: one quiet line.
    - "Payments by" with the mark and Forwend, opening the site in a new tab.
    - "Need help?" opens a dialog with the rules (where you are, refunds, scams, the unverified name), so the pay box
      never grows.
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
- A test-mode invoice's page (R-143) has a warning Test mode badge under its header's name.
- The invoice page (R-60) says each thing once: the header only names the invoice (its title, or its number when there
  is none); the timeline says the status, and Details the times: when the checkout closes ("Checkout closed" once
  past) and, once canceled, Canceled on. So the header has no status pill or time. At its top right sits one More
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
- The quote page `/w/<token>` (R-102) is public too: the logo, then one column of panels, like the stop reminders page.
  - "Quote from" the issuer in quiet text over the job's title as the heading.
  - Payments list how each is invoiced, its due days and amount, with the total under them.
  - The work (the scope) and From (the issuer, as an invoice shows it) follow.
  - Before acceptance, Accept this quote ends the page: what accepting agrees to, Your name, Your email, Accept quote.
  - Once accepted, Quote accepted comes first and takes focus: who accepted and when.
  - Pay the deposit is then the page's main button.
  - Another made payment shows a small Pay button while it takes money, else its number and status pill.
  - A delivered step links "See the delivered work" under its line.
  - A change's line adds "Change ·" and either that it waits, out of the total, or who accepted it and when.
  - A waiting change has its own bordered form under its line: what accepting agrees to, the name, email, Accept change.
  - Accepted, focus moves to the change's line, which now says who accepted it.
  - A change withdrawn before the accept: a notice in danger text opens the Payments panel and takes focus.
  - The quote's and the change's forms are one consent form: the change's is the compact one.
  - Record follows The work, as on the job page, without the client's email.

## API docs

- The public API docs at `/docs` (R-155) need no sign-in. A slim header holds the logo, linked home, and the theme switch.
  - One column of reading width: the heading, an intro, then an On this page panel of links to each section.
  - Each section is a heading, short text and bullets, with `code` set in mono, and a code block where it helps.
  - Links use the shared link style: accent and underlined, as `buttonClasses({ variant: "link" })` gives.
  - The changelog closes the page, newest date first. The landing page's developer section links here.

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
