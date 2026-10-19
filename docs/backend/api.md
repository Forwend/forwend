# Backend API rules

Routes: `apps/backend/api/openapi.yaml`; each module mounts its own in `internal/httpapi/<module>api/routes.go`.

## Contract first

- `apps/backend/api/openapi.yaml` (OpenAPI 3.1) describes every route except `/healthz`; change it before code.
- Go request and response types are written by hand in each module's `model.go` (`internal/httpapi/invoiceapi/model.go`)
  until a generator is added (oapi-codegen for Go); the web app's are Zod schemas in its features
  (`apps/web/src/features/*/schemas/`, see docs/web/architecture.md). Keep them equal to the spec.

## Routes

- Prefix `/v1` (except `/healthz`). A breaking change means `/v2`.
- Plural nouns, IDs in the path: `/v1/profiles/{profileId}/invoices`, `/v1/invoices/{payToken}`.
- `GET` reads and never changes state. `POST` creates or runs an action (`POST /v1/invoices/{payToken}/recheck`).
- `PUT` creates or replaces a whole editable resource (billing details).
- Invoice terms and ledger entries are immutable. Transfer and invoice statuses change through validated worker
  transitions. Clients cannot edit money records with `PUT` or `DELETE`.

## Requests and responses

- JSON fields in camelCase. Unknown fields are rejected. Bodies go through `http.MaxBytesReader` (1 MB).
- The server sets `ReadHeaderTimeout`, `ReadTimeout`, `WriteTimeout` and `IdleTimeout`.
- Every answer carries `Cache-Control: no-store` and `X-Content-Type-Options: nosniff`; the PDFs set their own cache
  rule.
- Money: decimal string in base units (`"5000000"`) next to `chainId` and `token` (contract address), as in R-19.
- Times: RFC 3339 in UTC. IDs and addresses: strings.
- Lists: `?limit=` (max 100) and `?cursor=`; response `{ "items": [...], "nextCursor": "…" }`.
- The owner's invoice, activity and transaction lists also take a filter (`?status=` open | paid | settled | expired |
  canceled on invoices and activity, where a closed checkout (`closed`, R-77) counts as expired, `?direction=` in | out on transactions) and `?q=`, a search of 1–100 characters (blank or
  longer: 422). Both narrow the list before paging, so `nextCursor` continues the filtered list. A field matches when
  it contains `q` in any letter case. When `q` is a decimal number (digits and one point; thousands commas are
  dropped) it also matches an amount equal to it in whole tokens: `amount = q × 10^decimals` in Postgres `numeric`,
  exact, never a float. `internal/search` parses it; the fields per list are in openapi.yaml.

## First run

R-50 and D-53; the full schema is in openapi.yaml. `POST` and `GET /v1/me` return `onboardedAt`: null until the user
makes or skips the first-run choice, and the web app shows the choice while it is null. Users who signed up before the
column existed were set to their signup time (migration 00013), so they never see it.

- `POST /v1/me/onboarding` with `{ "choices": [...] }`, any of `receive_and_send` (the personal profile every user
  has), `get_paid_by_clients` (a freelancer profile), `accept_business_payments` and `build_integration` (one merchant
  profile for either or both: an integration runs on a merchant profile). An empty list is Skip. A missing or unknown
  choice is 422 `invalid_value`.
- One transaction locks the user row, makes the profiles and sets `onboarded_at`, so concurrent calls make them once.
  Then each new profile gets its wallet through the signup path (R-31, R-32). The first call answers 201; later calls,
  with any choices, change nothing and answer 200 with the same `Me`. Later profiles come from `POST /v1/profiles`;
  a user has at most 10 profiles, the personal one included (each makes a Privy wallet the watcher scans): 422 above.
- Names, titles, notes, client and billing fields refuse control and invisible format characters (line breaks only in
  notes and addresses, zero-width joiners allowed), and sender, profile and billing names that read as Forwend: 422.
  The pay page says the name is not checked, and so does the PDF of a request without billing details. Onboarding
  counts toward the 10 profiles too.

## Notifications

R-80, D-65; the full schema is in openapi.yaml. Owner only.

- `GET` and `PUT /v1/profiles/{profileId}/notifications`: `{email, address}`. `PUT` takes `{"email": true|false}`
  only. The address is the account's verified login email (email account, else Google), read from Privy once on
  `POST /v1/me` and kept in `users.login_email` (`''` when the account has none, so it is not read again); a request
  can never set it, so nobody can point another person's notifications at an inbox.
- The ledger and the signer queue `invoice.paid`, `invoice.held` (with the amount newly held) and `invoice.settled` in
  `outbox_events`, in the transaction that makes the change (`internal/outbox`). The worker sends them through Resend
  (`internal/notify`) with `forwend-<invoiceId>-<eventId>-<address hash>` as the Idempotency-Key, one at a time with `FOR UPDATE SKIP
  LOCKED`; a failed send is retried after 1 min doubling to 1 h, given up after 10 tries.
  - A failed send ends that round, except when Resend refused the message as sent (400 or 422, such as a bad
    address). Then the round goes on, so one bad address can't hold up the other emails (R-115).
- Email off or no address: the event is marked done and nothing is sent. Without `RESEND_API_KEY` the worker sends
  nothing and events wait; `scripts/with-env.sh` gives the key to the worker alone.
- `PUT /v1/invoices/{payToken}/payer-email` (R-82, D-68, public like the checkout): the payer's address for this
  invoice's receipt only, kept on the main row, trimmed and lowercased; it changes until the receipt is sent (then 409
  `receipt_sent`). The ledger queues one `invoice.receipt` when the invoice becomes paid (a unique index keeps one per
  invoice); an address given after that queues it at once. The worker sends it to that address whatever the owner's
  setting: the amount, the payee, the transaction and the receipt PDF. Limited per invoice (3, then one per 10 s) and
  for everyone together; per IP belongs to the edge (Q-8).
  - The limit for everyone is spent only when the receipt goes out now (R-117).
  - A bad body or an unknown link answers before it, so junk can't block Send to client, which shares it.
- Payment reminders (R-96): each worker round (`invoice.QueueReminders`) queues `invoice.reminder` rows.
  - Steps: `before` 3 days before the due date, `due` on it, `after` 7 days after, in UTC days.
  - Only the latest step whose day has come is queued, once per invoice and step (a unique index on the step).
  - They fit in what is left of the client email cap (R-116), earliest due first; the rest wait for room.
  - It needs reminders on and not stopped, a client email, and the `open` status filter.
  - At delivery the worker checks the same again, and that something is left; otherwise it sends nothing.
  - The email names the issuer, number, what is left and the due date, with the pay page and `invoice.pdf`.
  - Reply-To is the issuer's billing email. The footer links `/reminders/<token>`.
  - `List-Unsubscribe` and `List-Unsubscribe-Post` headers point at the stop route (RFC 8058).
- Scope change emails (R-107): a proposed change queues one `job.change` row with the job and the change's key.
  - It goes to the email the client typed accepting the job, whatever the owner's setting.
  - It names the issuer, the job, the change, its amount and days to pay, with a button to `/w/<token>`.
  - Reply-To is the issuer's billing email.
  - The Idempotency-Key starts `forwend-job-<jobId>`.
  - At delivery a change withdrawn or accepted sends nothing.
  - In any 24 hours a job queues at most 5 (withdrawn changes count too), within the client email cap (R-116).
  - Past a cap the change is still added, and the owner's read has `clientEmailed: false` for it.
- Retainers (R-98): each worker round (`invoice.MakeRetainerInvoices`) makes a running retainer's next invoice.
  - Each later month is due on the first due date's day, or the month's last day when it is shorter.
  - It is made 7 UTC days before that due date, from the stored request, with its own number and receive address.
  - A month whose due date passed unmade is skipped: a past first due date or an outage sends no late invoices.
  - Its checkout stays open to the end of the 60th day after the due date (D-80).
  - It has reminders on when the first invoice was created with them, unless the client stopped them on any month.
  - In the same transaction it queues one `invoice.sent` row, so the client gets it as from Send to client.
  - That send counts toward the client email cap (R-116); past it the month is made without its email.
  - One month per retainer per round; a stop that lands first makes nothing (a row lock on the retainer).
- Client email cap (R-116): a user's profiles queue at most 20 emails to clients in any 24 hours, all kinds together.
  - It counts `invoice.sent` (Send to client and retainer months), `invoice.reminder` and `job.change` rows.
  - `outbox.ClientEmailsLeft` counts them under a lock on the user's row, so two profiles can't both pass it.
  - It keeps one account from mailing strangers in bulk, and Resend's shared daily budget (D-65) for money emails.
- The owner's Send to client (R-94) goes to the invoice's client email whatever the owner's setting. It names the
  issuer, number, amount and due date, and links the pay page and `invoice.pdf`. A payer-chooses invoice shows USD.
  Its Reply-To is the issuer's billing email, so a reply reaches the owner.
- A new account's welcome (R-84): when `POST /v1/me` first stores a non-empty login email for an account made after
  welcome emails existed (`users.welcome`), it queues one `account.welcome` row for the user in the same statement (a
  unique index keeps one per user). The worker sends it whatever the profile setting, with
  `forwend-user-<userId>-<eventId>-<address hash>` as the Idempotency-Key.
- Every email (F200) has an HTML part from one layout (`internal/notify/layout.html.tmpl`, `html/template`, so typed names
  are escaped) and a plain text part built from the same content, with the same links: the logo
  (`PUBLIC_WEB_URL/icon-192.png`), a badge, the title, the amount, a details table, one button, and a footer with why
  it was sent, the email settings link on owner emails, `support@forwend.com` and `EMAIL_POSTAL_ADDRESS` when set.
  Tables, inline styles and a dark-mode block; no scripts, tracking pixels or other remote assets.
- `GET /v1/profiles/{profileId}/events?limit=` (R-81, at most 50): the same events for the bell, newest first, with the
  invoice number, the option's token and the amount (newly held for `invoice.held`).

## Billing details

R-43; the full schema is in openapi.yaml. Owner only, like every `{profileId}` route.

- `PUT /v1/profiles/{profileId}/billing-details` creates or replaces them and answers 200 with what was saved. Body:
  `name` (≤ 200 characters), `address` (≤ 500), `country` (an assigned ISO 3166-1 alpha-2 code in upper case, like
  `DE`), `email` (≤ 254, a plain address) and optional `taxId` (≤ 50). All but `taxId` are required, so an invoice or
  PDF always has a full issuer block; a `taxId` left out or empty means none and is returned as null. Every field is
  replaced. Characters, not bytes; no NUL. A missing or broken field is 422 `invalid_value`. No Idempotency-Key: the
  same body sent twice saves the same details.
- `GET` returns the same fields plus `updatedAt`; 404 `billing_details_not_found` until the first `PUT`.
- The invoice insert copies the details into the invoice as `issuer`, in the same statement that takes the number,
  so the copy is the details at that moment. Editing them later changes no invoice. A profile without details gives
  `issuer: null`.

## Clients

R-86; the full schema is in openapi.yaml. Owner only, like every `{profileId}` route.

- `GET /v1/profiles/{profileId}/clients` lists the saved clients by name; at most 1000 per profile, so it comes whole.
- `PUT /v1/profiles/{profileId}/clients/{clientId}` creates or replaces one. The caller picks the id (a lowercase UUID),
  so no Idempotency-Key is needed: the same body sent twice saves one client, 201 the first time and 200 after. Body:
  `name` (required, ≤ 200 characters) and optional `email` (≤ 254, the billing email), `address` (≤ 500), `country` (an
  assigned ISO 3166-1 alpha-2 code), `taxId` (≤ 50) and `reference` (≤ 100 on one line, the client's PO number or
  reference that New invoice fills in, R-90); empty means none and comes back as null. The 1001st client is 422; an id
  that belongs to another profile is 404 `client_not_found`.
- A saved client also takes `reminders` (R-97): New invoice starts with payment reminders on for it. False when left
  out.
- `DELETE /v1/profiles/{profileId}/clients/{clientId}` answers 204, or 404 `client_not_found`.
- An invoice holds no link to a saved client: the web copies the client's details into the create request, so editing
  or deleting a client changes no invoice.

## Invoices

R-19 and R-42; the full schema is in openapi.yaml.

- `number` is an integer per profile: 1, 2, … in creation order (D-50). The API never formats it; the web shows
  `INV-` and at least 4 digits (`INV-0001`). The insert takes it from the profile's counter row (`profiles.invoice_seq`)
  in the invoice's own transaction, so a failed create uses no number and a repeated Idempotency-Key returns the
  stored one.
- Optional create fields: `title` (≤ 200 characters), `note` (≤ 2000), `dueDate` (`YYYY-MM-DD`, shown only; payment
  still closes at `expiresAt`, which the web form sets to the due date plus 60 days, at most 364 days from today, unless
  the owner picks another, D-80), `supplyDate` (`YYYY-MM-DD`, the day the work was done or delivered, R-89; part of the
  idempotency hash only when set), `reference` (≤ 100 on one line, the client's PO number or their reference, R-90; part
  of the idempotency hash only when set, and the invoice list search finds it), `senderName` (≤ 100; the name the payer
  sees on a request from a profile without billing details, D-52), `returnUrl` (an `https` link of ≤ 2000 characters
  with a host and no user or password, which the pay page offers once paid, R-58; part of the idempotency hash only when
  set, so older requests hash as before) and `client` `{ name ≤ 200, email ≤ 254, address ≤ 500, country, taxId ≤ 50 }`
  (the rules of a saved client, R-86; `country` and `taxId` are part of the idempotency hash only when set). Empty means
  none and is returned as null. Characters, not bytes; no NUL. `email` is a plain address (`name@example.com`). A broken
  rule is 422 `invalid_value`; these fields are part of the idempotency hash.
- Optional `reminders: true` (R-97) turns payment reminders on with the invoice, as the reminders route does. It needs
  `dueDate` and `client.email`, otherwise 422 `invalid_value`. It is part of the idempotency hash only when true.
- Optional `repeat` `{ endDate? }` (R-98, D-58) makes the invoice repeat every month: a retainer.
  - It needs `dueDate` and `client.email`; `endDate` is a date on or after `dueDate`. Otherwise 422 `invalid_value`.
  - The invoice and its `retainers` row are saved together. A profile has at most 50 running retainers, then 422.
  - It is part of the idempotency hash only when set.
- A freelancer or merchant profile saves its billing details first: without them create is 409
  `billing_details_required` and makes nothing, so every business invoice names who bills the client (R-92, D-83). A
  personal profile's request needs none and names its sender (D-52).
- Optional `agreedValue` `{ currency, amount, date }` (R-93): the price agreed with the client in fiat, which the owner
  types (no exchange-rate API). `currency` is EUR or one the ECB publishes a daily reference rate for (D-82,
  `invoice.AgreedCurrencies`); `amount` is above 0 with at most 12 whole digits and the currency's ISO 4217 decimals;
  `date` is the day it was agreed. It is stored in minor units and read back as `{ currency, amount, decimals, date }`,
  `amount` in minor units; part of the idempotency hash only when set. The PDFs print it under the total.
- Optional `lines` (R-88, at most 50): `{ description ≤ 200, quantity, unitPrice }`, adding up exactly to `amount` or
  `amountUsd`. `unitPrice` is in the amount's own unit (base units with `amount`, a USD decimal with `amountUsd`);
  `quantity` is above 0 and at most 1,000,000 with up to 2 decimals, and each unit price and each quantity times it
  must be a whole number of the token's smallest unit. A broken rule is 422 `invalid_value`. They are part of the
  idempotency hash. Reads return them as `lines` in the base units of the option whose `optionId` is the `invoiceId`
  (the invoice's first option), `quantity` with 2 decimals; Postgres refuses a changed, removed or later line and lines
  that do not add up to the invoice's amount at commit.
- The number, these fields and `issuer` never change, like the terms: a database trigger rejects any update.
- `settlementTxHash` is the signer's settle transaction once the invoice is settled; null before, and when the refund
  authority settled the receiver outside the signer. The activity's invoice items carry it as `txHash`. They also carry `optionCount`: above 1 the client chooses, so
  the item reads in USD, not in the first option's token it names (R-70). A deposit item carries `held`: the owner
  gets none of it (late, on a final or canceled invoice, on one that expired partly paid, or on an option the client did
  not pay with), so it is filed
  under no status filter, only the full list (D-26).
- An invoice (read, list, create) carries `confirming`: a payment before expiry is seen and not final. A
  `partially_paid` invoice keeps that status while the rest confirms, so readers show it as confirming (R-69).
- An invoice read alone (either GET, and create) also has `paidAt` and `settledAt`, null until reached. `paidAt`
  is the receipt's paid time (below); `settledAt` is when the settlement was recorded as final: the `created_at` of
  the ledger's settlement transaction, written with `settlementStatus = settled`. List items have neither.
- Each of its `deposits` has the sender `from` (lowercase hex, as stored) and `blockTime` (the block's time, RFC 3339
  UTC), from the stored transfer.
- `GET /v1/profiles/{profileId}/invoices?limit=&cursor=&status=&q=`: the list format above, highest number (newest)
  first; items have no `deposits`. Owner only, like every `{profileId}` route.
- `GET /v1/profiles/{profileId}/invoices/{invoiceId}`: the public GET plus `client` and `settlementWait`. Another
  profile's invoice is 404 (`invoice_not_found`), also when the same user owns both.
- `POST /v1/profiles/{profileId}/invoices/{invoiceId}/cancel` (R-79, D-79): cancels the invoice and every option of
  it, only while all are open, the checkout is open and no transfer was ever seen; otherwise 409
  `invoice_not_cancelable`. It locks the rows the ledger locks. The watcher records transfers without that lock, so a
  transfer seen in the same moment can land on a canceled invoice: it is held like any later deposit. Canceled is
  final and sets `canceledAt`; the ledger holds any later deposit for the payer (D-26), and `invoice.pdf` drops the pay
  link and code.
- `POST /v1/profiles/{profileId}/invoices/{invoiceId}/send` (R-94) queues one `invoice.sent` email to the invoice's
  client email. It needs an Idempotency-Key; the same key again answers 200 and queues nothing.
  - Only while the payer can still pay it (the `open` status filter); otherwise 409 `invoice_closed`.
  - Without a client email: 409 `client_email_required`. A key used for another invoice: 409 `idempotency_conflict`.
  - One send per invoice in 24 hours, within the client email cap (R-116).
  - Sends share the limit for everyone with the payer's receipt address. Past any limit: 429 with Retry-After.
  - The owner's reads return `sends`, oldest first: `{requestedAt, sentAt, failedAt}`. The bell leaves sends out.
- `PUT /v1/profiles/{profileId}/invoices/{invoiceId}/reminders` (R-96, D-69) takes `{"on": true|false}`.
  - On needs the `open` status filter, a due date and a client email. Otherwise 409 `invoice_closed`,
    `due_date_required` or `client_email_required`.
  - After the client stopped them, on is 409 `reminders_stopped`. Off always works.
  - The first call, or a create with `reminders: true` (R-97), makes the row in `invoice_reminders`.
  - The row holds a random 32-byte stop token.
  - The owner's reads return `reminders`: `{on, stoppedAt, emails}`, each email with its `step`.
- `POST /v1/profiles/{profileId}/invoices/{invoiceId}/repeat/stop` (R-98) stops the invoice's retainer.
  - It answers the invoice, the same when already stopped or not repeating. Invoices already made stay.
  - The owner's reads return `retainer` on each of its invoices, else null.
  - `retainer` is `{endDate, nextDueDate, nextOn, stoppedAt}`; the next two are null once it ended or stopped.
- `POST /v1/reminders/{token}/stop` is public: the client's stop link and one-click List-Unsubscribe-Post.
  - It reads no body, sets `stopped_at` once and answers `{number, from}`, the same when already stopped.
  - An unknown token is 404 `invoice_not_found`.
- `GET /v1/profiles/{profileId}/owed` (R-95) lists what clients still owe, for the Owed to you panel.
  - Unpaid rows: invoices under the `open` status filter that are overdue or partly paid.
  - Overdue means the due date is before today's UTC date; `daysLate` counts whole UTC days.
  - `amount` is what is left: the amount less the `recipient_payable` credits. No settlement runs before it is all in.
  - A row with nothing left is left out: all of it is booked and waits for the second RPC.
  - Held rows: each option with a `payer_held` balance, with that amount. It is the payer's money (D-26).
  - Order: overdue (most days late first), partly paid, held. It has no pages: unpaid rows are at most `MaxOpen`.
- `settlementWait` (owner reads and create only) says why a paid invoice's money has not reached the profile wallet
  yet, null when it is not paid or already settled (R-54): `{kind, until, secondsLeft}` with `kind` one of `signing`,
  `finalizing` (`secondsLeft` estimates the chain time until the settle is final), `retrying` and `dailyLimit` (the
  user's sponsored settlements for 24 hours are used up; both with `until`, the next try) and `refused`. It comes from
  the intent's status and the wait kind the signer stores with it, never from log text.
- Payer chooses (R-56, D-75, D-76): create with `amountUsd` alone (a decimal like `"12.50"`) instead of `chainId`,
  `token` and `amount`. The invoice accepts every enabled token on every enabled chain the worker already watches
  (others would miss payments), each at 1 USD per token: the amount in the token's decimals, 422 when they
  can't hold it exactly. Each option is an `invoices` row of its own with its own on-chain id (the first random, the
  others `keccak256(abi.encode(first id, chain id, token))`, so the pay page can tie them to the link), terms and
  receive address, so the watcher, ledger and signer treat it as any invoice; the first row is the invoice (its token is the pay
  link, its number and details are the invoice's). Each option counts toward the profile's open and daily limits.
  Reads add `optionId` (the on-chain id in the shown terms), `optionLocked`, `optionCount` and, on a read alone, `options` (each
  `{optionId, chainId, network, token, symbol, decimals, amount, receiveAddress, deposits}`; deposits on an option
  other than the shown one are held for the payer). Until an option has money the
  terms shown are the first option's; the option whose money came first on chain becomes the invoice's for good
  (`chosen_id`), once every other option's chain was read past that money (R-119), and money on any other is booked to
  `payer_held`. The owner's GET with an option's id answers its
  invoice; the public routes don't take ids.
  Lists, activity and search show each invoice once, with the current option (`invoices_current` view).
- The pay link carries `payToken` (D-86, R-114): 32 random bytes in lowercase hex, kept on the main row
  (`invoices.pay_token`). The invoice's `invoiceId` is keccak256 of it.
  - The chain shows `invoiceId` and option ids (`ReceiverDeployed`, `Settled`, the deploy calldata), so no public route
    takes them: an id there is 404 `invoice_not_found`.
  - Create, the owner's reads and a job's payments give `payToken`. An invoice made before D-86 has `null` and no
    public route. Its Send to client, reminder and receipt emails are dropped: they would link nowhere.
- The public `GET /v1/invoices/{payToken}` has no `client`: the token is a bearer link, so it returns only what the payer
  needs (OWASP API Security Top 10 2023, API3). What it returns is listed once, in `getInvoice` in openapi.yaml. Create,
  list and the profile's GET, which only the owner calls, include `client`.

## Invoice and receipt PDFs

R-47 and D-51. This section has the full layout. `getInvoicePdf` and `getReceiptPdf` in openapi.yaml also list what each
PDF prints, so a change updates both. Both are public like `GET /v1/invoices/{payToken}` and answer 404
`invoice_not_found` the same way.

- `internal/document` draws them with `codeberg.org/go-pdf/fpdf` in a fixed layout, from `invoice.Get` only: no
  templates, network or file reads. The font is Noto Sans, embedded (`internal/document/fonts`, SIL OFL 1.1). Long
  texts wrap and are cut with "…"; characters above U+FFFF (emoji) print as "?".
- Both look like the product (R-61): the Forwend mark (`internal/document/logo.path`, a copy of
  `packages/ui-web/src/icons/logo-data.ts`) and the light theme's colors, the kind and number (`INV-0001`) with the
  reference under it (R-90), the issuer block from the invoice's copy (left out without one) and "Bill to" with the
  client's name and address but never the email (the token is a bearer link), a row of dates (with the supply date when
  set, R-89), then a line table: the title (or "Payment"), the network (name and chain id) and the exact amount with the
  token's symbol and decimals, never cut, and the agreed value (R-93) quietly under the total; with line items (R-88)
  the title heads the table and each item is a row with its quantity and unit price. Network names and explorers are a
  copy of `apps/web/src/shared/constants/chains.ts`; a test fails when either copy changes alone.
- `invoice.pdf`: created time, supply date, due date and checkout expiry, the note, and a box with the pay link
  `PUBLIC_WEB_URL/pay/<payToken>` and its QR code (drawn as vector modules), then the invoice id. A payer-chooses
  invoice names the network "Any" with the amount and total due in USD, then lists under Pay with each token and its
  networks ("USDC on Base Sepolia, Arbitrum Sepolia") and says to send only on those (R-70). Amounts group thousands
  (1,250.00); every page's footer names the document and number and says Page X of Y.
- `receipt.pdf`: 409 `invoice_not_paid` until `paymentStatus` is `paid` (it stays paid once settled).
  - It adds the paid time beside the created time and supply date.
  - Under Payments it lists each deposit's part paid to the creator (R-121): amount, block time, full tx hash and a
    "View on <explorer>" link. Late money and money over the amount are held for the payer (D-26).
  - It ends with the pay link and its QR code, since a PDF can be edited.
  - It says nothing about the settlement, the creator's business (R-61).
  - The paid time is the block time of the last deposit the ledger booked to `recipient_payable`: the one that
    completed the amount.
- The same data gives the same bytes (creation date = created or paid time, sorted catalog), so the `ETag` is a hash of
  the file. `Cache-Control: private, no-cache`: a client revalidates and gets 304 while the file is unchanged; another
  deposit before the checkout closes changes the receipt; a late deposit and the settlement do not.
  `Content-Disposition: attachment; filename="forwend-INV-0001-invoice.pdf"` (or `-receipt.pdf`).

## Jobs

R-100, D-81; the full schema is in openapi.yaml. A job is a quote with a payment schedule; each payment becomes an invoice.

- `POST /v1/profiles/{profileId}/jobs` needs an Idempotency-Key, like invoice create.
  - Body: `title` (≤ 200), optional `scope` (≤ 5000, with line breaks), `client` and 1 to 10 `payments`.
  - `client` follows a saved client's rules (R-86), and needs `name` and `email`: payments are billed there.
  - Each payment has a `title` (≤ 100), `amountUsd` (above 0, at most 2 decimals) and `dueDays` (0 to 90).
  - Only the first may have `onAccept: true`: the deposit. The total is the sum.
  - The same body again replays (200); amounts compare in cents. Other values under the key are 409.
  - It copies the billing details as `issuer`, so no billing details is 409 `billing_details_required`.
  - The job gets a random 32-byte link token. A profile has at most 1000 jobs.
- `GET /v1/profiles/{profileId}/jobs` lists them newest first, with the total and how many payments are paid.
- `GET /v1/profiles/{profileId}/jobs/{jobId}` reads one: the client, the token, and each payment's invoice.
  - A payment's `invoiceId`, `number` and `status` (the invoice's status filter) are null until it is made.
  - For the job's record (R-104), `invoicedAt` is when its invoice was made.
  - `paidAt` is the invoice's `paidAt`: the block time of the transfer that completed it, null until paid.
- `DELETE /v1/profiles/{profileId}/jobs/{jobId}` (R-101) deletes a job the client has not accepted: 204, and its link
  stops working. An accepted job is 409 `job_accepted`. An accept that read the job just before makes no invoice.
- `POST /v1/profiles/{profileId}/jobs/{jobId}/payments/{position}/done` (R-103) marks a step done.
  - It makes that payment's invoice like the deposit, due `dueDays` after the UTC day, with the key `job:<jobId>:<position>`.
  - It takes an optional https `deliveryLink` (D-66), kept with the time; both show in the owner's and the client's read.
  - After acceptance only (409 `job_not_accepted`), in order (409 `payment_out_of_order`).
  - A payment that has its invoice answers the same; clicks at once replay one invoice.
  - The last payment's invoice note gives the job's total and each earlier payment, its invoice, amount and if it is paid.
  - The final payment waits until no change does: while one waits it is 409 `change_pending` (R-105).
  - Its invoice locks the job, so a change proposed meanwhile makes it read the job again.
  - Nothing is emailed: the job page then calls Send to client, with its limits (R-94).
- `POST /v1/profiles/{profileId}/jobs/{jobId}/payments` (R-105) proposes a scope change, with an Idempotency-Key.
  - Body: `title`, `amountUsd` and `dueDays`, as a payment. It goes at the end of an accepted job's schedule.
  - A job not accepted yet is 409 `job_not_accepted`; past 10 payments it is 422.
  - One change waits at a time: another before the client accepts it is 409 `change_pending`.
  - The client gets an email about it (R-107).
  - A replay sends no second email.
  - Once the last payment is done, the job is finished: a change is 409 `job_finished`.
  - A job paid in full by its deposit never finishes this way: the deposit is invoiced at acceptance, not marked done.
  - A withdrawn change keeps its key: the same request again answers 200 and adds nothing.
  - Until the client accepts it, marking it done is 409 `change_not_accepted`, and it doesn't count in the total.
- `POST /v1/jobs/{token}/payments/{position}/accept` is the client's accept of a change: `{name, email, proposedAt}`.
  - `proposedAt` is the change's, with its microseconds, so consent can't land on a change proposed after it.
  - It keeps the name, email and time once. Another change, or a payment that is not one, is 404 `job_not_found`.
- `DELETE /v1/profiles/{profileId}/jobs/{jobId}/payments/{position}` withdraws the change waiting for the client.
  - It is always the last payment, so positions keep no gap. Anything else is 409 `payment_not_withdrawable`.
  - A position that doesn't exist is 404 `job_not_found`.
- Each payment has `proposedAt`, `acceptedName` and `acceptedAt`, null for the quote's payments.
  - The owner's read adds `acceptedEmail`; the client's read never shows it.
  - The owner's read also adds `clientEmailed`: whether an email about the change was queued (R-107).
- `GET /v1/jobs/{token}` is the client's read, public like the checkout: no client block, typed email, job id or token.
- `POST /v1/jobs/{token}/accept` is public: `{name, email}`, typed by the client.
  - It keeps them with the time, once; an accepted job answers the same, whoever accepts again.
  - With a deposit it makes the deposit invoice in the same transaction, with the key `job:<jobId>:1`.
  - The invoice is payer chooses, with the job's title and client and one line for the payment.
  - It is due `dueDays` after the UTC day, and its checkout closes `dueDays` + 61 days after the accept (D-80).
  - Clicks the same UTC day send the same request, so they replay one invoice.
  - A click just after midnight has another due date: its key is taken, so it answers the accepted job.
  - Nothing is emailed: the client is on the page, which links the invoice.

## Wallet transactions and balance history

Both read the transfers the worker records for profile wallets (R-38); the full schema is in openapi.yaml.

- `GET /v1/profiles/{profileId}/transactions?limit=&cursor=&direction=&q=`: the list format above, newest block
  time first, reorged transfers left out. An item: `chainId`, `token`, `symbol`, `decimals`, `direction` (`in` | `out`), `amount`,
  `counterparty` (sender for in, receiver for out), `txHash`, `logIndex`, `blockNumber`, `at` (block time), `status`
  (`detected` | `confirmed`, as for deposits).
- Records (R-108): each transaction adds `usdValue` and `classification`, and `invoice` for an invoice payment.
  - `usdValue` is the amount at 1 USD per USD stablecoin (D-75, D-82), with every decimal of the token.
  - Money in from one of the profile's invoice receive addresses is `invoice`, with `{invoiceId, number, clientName}`.
  - Money between the user's own profiles is `own_transfer`, either way.
  - Other money out is `sent`.
  - Other money in is `unclassified` until labelled `income`, `own_transfer`, `refund` or `other`.
  - `labelable` is true for that money in, labelled or not, and false for anything else.
- `PUT /v1/profiles/{profileId}/transactions/{chainId}/{txHash}/{logIndex}/label` takes `{"label": ...}`; null clears it.
  - Only money in that Forwend can't classify takes a label; anything else is 409 `not_labelable`.
  - A transfer the profile's wallet lacks is 404 `transaction_not_found`.
- `GET /v1/profiles/{profileId}/transactions.csv?from=&to=` exports every transaction in those UTC days, newest first.
  - Both days are optional and included.
  - A bad day, or from after to, is 422.
  - More than 10000 transactions in the days is 422 `too_many_transactions` (R-118): dust can't make it grow.
  - Rows go into the file as the database sends them; the request never holds every transfer.
  - Columns: date (UTC), direction, amount, token, network, counterparty, transaction, status, USD value.
  - Then the classification, invoice number and client.
  - A cell starting like a formula gets a leading apostrophe.
  - With a records currency it adds `<currency> value` and `ECB rate date` columns (R-110).
- `GET` and `PUT /v1/profiles/{profileId}/records-currency` read and set `{"currency": ...}` (R-110).
  - It is EUR or a currency the ECB publishes a rate for, other than USD; null clears it.
  - Another value is 422 `invalid_value`.
- `GET /v1/profiles/{profileId}/statement.pdf?from=&to=` is the profile's income statement for those UTC days (R-112).
  - Both days are required and included; a missing or bad day, or from after to, is 422.
  - More than 10000 transactions in the days is 422 `too_many_transactions`; only income lines are kept (R-118).
  - Income is confirmed money in classified `invoice` or labelled `income`, oldest first.
  - Each line has its UTC time, invoice and client or Income, token amount, network and transaction.
  - It has the USD value to the cent and the records currency's value; totals add the rounded lines.
  - A line without a rate leaves out the other total, and a note says why.
  - The billing details are the account holder; without them it is 404 `billing_details_not_found`.
  - A note counts the confirmed unclassified money in that it leaves out.
- Each transaction adds `recordsValue` `{currency, amount, rateDate}`, null without a currency or a rate.
  - `rateDate` is the latest ECB day on or before the transfer's UTC day, within 7 days; an older rate gives null.
  - Until the ECB publishes a day's rates and the worker reads them, that day's transfers use the day before.
  - `amount` is the USD value / USD rate × the currency's rate, rounded half up to its decimals; EUR's rate is 1.
- `GET /v1/profiles/{profileId}/balance-history?days=N`: N is 1–365, default 30 (not a number: 400; out of range: 422).
  One point per UTC day, today included, oldest first: `points[i]` is `{ at, estimatedUsd, receivedUsd, sentUsd }`,
  and `tokens[j]` is `{ chainId, token, symbol, decimals, balances, received, sent }`, where each array holds one
  base-unit string per point. `at` is the end of the day (00:00 UTC of the next day); the last point is now, and its
  balance is the wallet balance `/balances` reads at the second RPC's finalized block. An earlier balance undoes the
  final transfers after it (not reorged, at or below that block); `received` and `sent` sum them per day, today's
  without an end. The database sums them per token and day, so dust doesn't make the read grow (R-118). A missing wallet balance makes that token's arrays and every USD total null. Money moved without a
  token `Transfer` log (Arc native-coin sends, fees paid in the token) is not undone; a balance below 0 shows 0.

## Idempotency

- Every `POST` that creates something or moves money needs an `Idempotency-Key` header. Exceptions: `POST /v1/me`
  (signup) and `POST /v1/me/onboarding` happen once per user, so the user's token is the key.
- `POST /v1/jobs/{token}/accept` is public and takes no key: a job is accepted once, and its deposit has the key
  `job:<jobId>:1`.
- First call: 201. Same key and body again: 200 with the same resource. Same key, other body: 409.
- Keys are unique per profile (per user for `POST /v1/profiles`), 1–255 bytes of UTF-8; a missing or longer key is 400. The server stores a SHA-256 of the
  normalized values, never the body, so field order, spacing and address letter case don't matter. A request that
  fails validation stores nothing. Two requests with one key at once get one resource.

## Auth

- `Authorization: Bearer <Privy access token>`, checked by middleware on every route not marked `security: []`.
- Public routes (checkout reads) are marked `security: []` in the spec. `/healthz` is also public and uses its own status response. No other route is public by default.
- Profile-scoped routes check that the user owns the profile: 403 otherwise, also for an unknown or malformed
  profile ID, so callers can't probe which profiles exist.
- `internal/auth` verifies the token locally: ES256 only, issuer `privy.io`, audience = app ID, `exp` required,
  `sub` = the user's Privy DID, and a `sid` with no `linked_accounts`: Privy signs identity tokens for the app too,
  and they must not work as bearer tokens. The key is the one named by the token's `kid` among those published at
  `PRIVY_JWKS_URL` (Privy publishes more than one), loaded at startup (R-29). An unknown `kid` fetches the keys again at
  most once a minute; a known one makes no network call while the list is younger than an hour. An older list is
  fetched again first, so a key Privy withdrew stops verifying (R-30); if Privy is unreachable, the last list verifies for
  10 more minutes (`KeyGrace`), then nothing does. `PRIVY_JWKS_URL` must be https. The Privy Go SDK (D-12) has no local token check, so this
  uses `golang-jwt/jwt/v5` as in Privy's Go guide (https://docs.privy.io/authentication/user-authentication/access-tokens).
- `mid.RequireUser` and `mid.RequireProfileOwner` wrap the protected handlers, through `mid.Guards` (`SignedIn`,
  `ProfileScoped`) that each module's `routes.go` applies. `/v1/me` and `POST /v1/profiles` act
  only for the token's user. Every `{profileId}` route is listed in `profileRoutes` in `internal/httpapi/tests/profiles_test.go`, which checks
  that another user gets 403 on each.

## Errors

- One shape: `{ "error": { "code": "invoice_not_found", "message": "…" } }`. Codes are snake_case and listed in the spec.
- 400 malformed, 401 no or bad token, 403 not yours, 404 missing, 409 conflict, 422 invalid value, 429 too many
  requests, 503 a network the worker has not scanned yet (`network_not_ready` on invoice create, `network_unavailable` when a recheck cannot read it), 500 anything else.
  A profile has at most 1,000 invoices open for payment at once and creates at most 500 a day: 422 above.
- A 500 never shows internal details. `httpio.WriteError` maps sentinel errors to codes in one place.

## Rate limits

`internal/httpapi/mid/ratelimit.go`, constants there (Check status's in `invoiceapi/routes.go`). Each caller has a token bucket: a request takes a token, tokens
come back at a fixed rate up to the burst size. An empty bucket answers 429 `rate_limited` with `Retry-After` in whole
seconds (when the next token is back) and runs nothing else.

- Routes that need a token: per Privy user, after the token is checked; 2 requests a second, 60 at once.
  - `API_USER_BURST` raises the 60. Only the live e2e sets it (1000): all its tests sign in as one user (D-85).
- `POST /v1/invoices/{payToken}/recheck` (Check status, R-55) reads a chain RPC, so it is limited in the api: one
  check per invoice every 5 minutes (the invoice read gives `nextCheckAt`, so a reloaded page still waits), kept in Postgres so every replica agrees (`invoice_rechecks.checked_at`), and a
  per-process bucket of 1 a second, 10 at once, for everyone together. Each owner's invoices (one user, all profiles)
  take from the owner's own bucket first, 3 at once, then one every 5 s, so one account can't empty the shared one. Both answer 429 with `Retry-After`. A chain that
  can't be read answers 503 `network_unavailable`. Until an option has money it checks every option's address (the
  payer may have paid any); the answer is an option holding more than recorded, else the shown one. An option whose
  network does not answer is listed in `unreadable` and the others are still checked. When the shown option can't be
  read and no other holds unrecorded money, it is 503: another option's empty read never answers for it. A rescan is asked only when the address holds more than is
  recorded and no rescan finished in the last 10 minutes, so money no log explains (Arc native USDC) doesn't start a
  full rescan on every press.
- `POST /v1/jobs/{token}/accept` makes an invoice, so it has limits in `jobapi/routes.go`. Accepting a change has its
  own per-link limit and shares the one for everyone.
  - Per link: 3 at once, then one every 10 s.
  - For everyone together: 20 at once, then 5 a second, spent only by an accept that changes a job (R-117).
  - A bad body, an unknown link or a job already accepted answers before it.
- The other public routes (`GET /v1/invoices/{payToken}`, `GET /v1/jobs/{token}`, both PDFs and `POST /v1/reminders/{token}/stop`) have no limit in the api. Next's `/api` rewrite adds
  no `X-Forwarded-For` of its own and passes a client's header through unchanged (measured 2026-10-15 with a stub
  behind `next start`: no header without one, a sent `1.2.3.4` arrived as is), so the api sees one address for every
  payer and cannot trust the header. Limit them
  per IP at the load balancer or edge once hosting is chosen (Q-8), and keep the api reachable only through it.
  `/healthz` has no limit.
- The buckets live in each api process (D-72): with N replicas behind a load balancer a caller gets up to N times the
  rate. Redis can hold the counts once more than a few replicas run.
- How the web handles 429: [web architecture](../web/architecture.md).

## Handlers and tests

- Module layout: [rules.md](rules.md). Handlers hold no SQL and no business rules. API tests go through the whole
  router in `internal/httpapi/tests/`, one file per module.
- Each route has a test for success and for every error code it can return, on real Postgres.
