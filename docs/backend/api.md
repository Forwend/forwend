# Backend API rules

Routes: `apps/backend/api/openapi.yaml`; each module mounts its own in `internal/httpapi/<module>api/routes.go`.

## Contract first

- `apps/backend/api/openapi.yaml` (OpenAPI 3.1) describes every route except `/healthz`; change it before code.
  - `TestOpenAPINamesEveryRoute` fails on a route without its operation, or an operation without its route (R-150).
  - It reads each route from one literal `"METHOD /path"` on its `Handle` line, and fails on any other form.
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
- Invoices and activity also take `?state=`, the Payments list's D-114 states (waiting | confirming | partially_paid |
  paid | overpaid | expired | canceled); a deposit takes its payment's state. Another value is 422.
- The owner's invoice, activity and transaction lists also take a filter (`?status=` open | confirming | paid | settled | expired |
  canceled on invoices and activity, where a closed checkout (`closed`, R-77) counts as expired, `?direction=` in | out on transactions) and `?q=`, a search of 1–100 characters (blank or
  longer: 422). Both narrow the list before paging, so `nextCursor` continues the filtered list. A field matches when
  it contains `q` in any letter case. When `q` is a decimal number (digits and one point; thousands commas are
  dropped) it also matches an amount equal to it in whole tokens: `amount = q × 10^decimals` in Postgres `numeric`,
  exact, never a float. `internal/search` parses it; the fields per list are in openapi.yaml.

- Payment lists use the same status meanings and accept order reference, customer and requested-amount search.
- Payment search also matches the invoice number (`INV-0004`) and the main option's receive address.
- A whole transaction hash or receive address also finds a payment by its deposits, returns or any option.
- Paid filters include wallet-settled payments; settled narrows the set to money already in the wallet.
- Activity deposits use their payment's status, including unnumbered checkout attempts.
- Activity lists an invoice or request once numbered; a checkout session shows only its deposits.
- Activity orders invoices by creation time and deposits by block time.
  - A block time has whole seconds, so a deposit's time is never before its payment was made.
  - At the same time a deposit comes first.
  - Each part reads at most one page past the cursor, so a page never reads the whole history.
- A booked deposit has `merchantAmount` and `heldAmount`: the owner's and the payer's parts (D-114).
  - They add up to `amount`; both are null for an invoice and an unbooked deposit.
- Activity items name their payment: `purpose`, `documentKind`, `number`, `reference`, `clientName` and `title`.
- Payment receipts show observed amounts and uncredited amounts separately by used token and network.
- Each receipt's `held` is the booked money on that option still owed to the payer.

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
  - "Reads as Forwend" folds accents, spaces and look-alike letters, also of upper-case letters (R-122).
  - The letters come from Unicode's confusables (`profile/lookalikes.go`, made by `lookalikes_gen.go`). A few it lacks,
    such as small capitals, are added by hand. A symbol that looks like a letter counts both ways: as that letter
    (`℮` as e) and as a gap (`|`).
  - The pay page's Need help and the emails of a request without billing details say a typed sender name is not
    checked. The PDF shows the name without that note.
  - Billing details carry no note: they are the issuer's own legal details. The look-alike check keeps names from
    reading as Forwend.
- Onboarding counts toward the 10 profiles too.

## Notifications

R-80, D-65; the full schema is in openapi.yaml. The owner's alone (`notifications`, D-93).

- `GET` and `PUT /v1/profiles/{profileId}/notifications`: `{email, address}`. `PUT` takes `{"email": true|false}`
  only. The address is the account's verified login email (email account, else Google), read from Privy once on
  `POST /v1/me` and kept in `users.login_email` (`''` when the account has none, so it is not read again); a request
  can never set it, so nobody can point another person's notifications at an inbox.
- The ledger and the signer queue `invoice.paid`, `invoice.held` (with the amount newly held) and `invoice.settled` in
  `outbox_events`, in the transaction that makes the change (`internal/outbox`). The worker sends them through Resend
  (`internal/notify`) with `forwend-<invoiceId>-<eventId>-<hash of the address and the message>` as the Idempotency-Key, one at a time with `FOR UPDATE SKIP
  LOCKED`; a failed send is retried after 1 min doubling to 1 h, given up after 10 tries.
  - A failed send ends that round, except when Resend refused the message as sent (400 or 422, such as a bad
    address). Then the round goes on, so one bad address can't hold up the other emails (R-115).
- Email off or no address: the event is marked done and nothing is sent. Without `RESEND_API_KEY` the worker sends
  nothing and events wait; `scripts/with-env.sh` gives the key to the worker alone.
- `PUT /v1/invoices/{payToken}/payer-email` (R-82, D-68, public like the checkout): the payer's address for this
  invoice's receipt only, kept on the main row, trimmed and lowercased, and checked like a client email (plain text,
  exactly one address, else 422); it changes until the receipt is sent (then 409
  `receipt_sent`). The ledger queues one `invoice.receipt` when the invoice becomes paid (a unique index keeps one per
  invoice); an address given after that queues it at once. The worker sends it to that address whatever the owner's
  setting: the amount, the payee, the transaction and the receipt PDF. Limited per invoice (3, then one per 10 s) and
  for everyone together; per IP belongs to the edge (Q-8).
  - The limit for everyone is spent only when the receipt goes out now (R-117).
  - A bad body or an unknown link answers before it, so junk can't block Send to client, which shares it.
- `PUT /v1/invoices/{payToken}/pick` (R-57, public like the checkout): the option the payer showed the address for,
  kept on the main row's `picked_id`, so the pay link opens on it again. The read returns it as `pickedOptionId`.
  - It decides nothing: payments that add up to 1.00 USD still make an option the invoice's (R-56, R-119).
  - It is refused once an option is chosen, or a payment that can choose one is seen; dust doesn't stop it.
  - A changed pick adds one `payer.option_picked` row to the history; the same pick again adds none.
  - An id that isn't one of the invoice's options is 422, and so is any pick on a Fixed invoice.
  - Once money is seen on any option it is 409 `pick_locked`.
  - It locks the options, then the main row, as cancel and the ledger do.
  - Limited per invoice (10, then one per 5 s); per IP belongs to the edge (Q-8).
- Payment reminders (R-96): `invoice.QueueReminders` queues `invoice.reminder` rows.
  - It runs on the worker's loop beside the chain rounds, at the same interval.
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
- Retainers (R-98): `invoice.MakeRetainerInvoices` makes a running retainer's next invoice.
  - It runs on the worker's loop beside the chain rounds, at the same interval.
  - Each later month is due on the first due date's day, or the month's last day when it is shorter.
  - A retainer started from Revise replaces the old invoice only once; later months never repeat that action.
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
  it was sent, the email settings link on owner emails, and `SUPPORT_EMAIL` and `EMAIL_POSTAL_ADDRESS` when set.
  Tables, inline styles and a dark-mode block; no scripts, tracking pixels or other remote assets.
- `GET /v1/profiles/{profileId}/events?limit=` (R-81, at most 50): the same events for the bell, newest first, with the
  document number when present, the option's token and the amount (newly held for `invoice.held`).
- Events include purpose, document kind and title; document-free checkout events have `number: null` and open payment details.
- Existing invoice and request event numbers remain unchanged; no document number is invented for checkout.
- Owner checkout emails open Payments; customer receipt links remain public.

## Billing details

R-43; the full schema is in openapi.yaml. Members reach it with `billing.read` and `billing.write` (D-93).

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

R-86; the full schema is in openapi.yaml. Members reach it with `clients.read` and `clients.write` (D-93).

- `GET /v1/profiles/{profileId}/clients` lists one page of the saved clients by name, then id (R-177).
  - `limit` is 1 to 100, 50 by default; `cursor` is the last page's `nextCursor`, null on the last page.
  - `q` searches the name, the email and the tax ID in any letter case, as the jobs search does.
  - A profile still holds at most 1000 clients.
- `GET /v1/profiles/{profileId}/clients/{clientId}` reads one client; another profile's or an unknown id is 404 `client_not_found`.
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

## Networks and tokens

R-136; the full schema is in openapi.yaml. Members reach it with `tokens.read` and `tokens.write` (D-93).

- An enabled token is on for a profile until the owner turns it off.
- `GET /v1/profiles/{profileId}/tokens` lists the enabled tokens with `on`, by chain id.
- `PUT /v1/profiles/{profileId}/tokens` takes `{"off": [{chainId, token}]}` and replaces the list.
  - An unknown or disabled token is 422. Each available mode keeps at least one token on; otherwise nothing changes.
- A store's `tokensOff` combines with its profile preferences, keeping one token on per available mode.
  - Profile changes that would leave any store without a token in a mode are refused.
  - Reads list only enabled tokens. Saving preserves preferences for unavailable tokens.
  - Store edits without `tokens.write` leave all token restrictions unchanged.
- Create leaves out the tokens off for the profile or its store; a fixed token that is off is 422.
  - Nothing left is 422 too.
  - A fixed retainer's later month keeps its token; a payer-chooses month offers what is on then.
  - A later month keeps the first month's mode (R-156).
  - Invoices made earlier keep their options.

## Prices

R-178, D-115; the full schema is in openapi.yaml.

- `GET /v1/prices` lists each enabled token with its CoinGecko USD price, by chain id.
  - Prices are the same for everyone, so any signed-in user reads them; the route has no profile.
  - A secret API key answers 401.
- `coinId` comes from the token's symbol (`internal/price`); a symbol without a coin has null.
  - A test token has its mainnet coin's price.
- `usd` is CoinGecko's decimal text, kept as `numeric`; null without a price, never 1 in its place.
- `stale` is true without a price, a `fetchedAt` over 1 hour old or a `sourceUpdatedAt` over 24 hours old.
  - 1 hour is four missed worker reads; stablecoin prices on CoinGecko update within minutes.
- The api only reads `coin_prices`; the worker keeps it ([architecture](architecture.md#processes)).
- The prices are for display only: invoice amounts, the ledger, records and exports never read them.

## Stores

R-134; the full schema is in openapi.yaml. Members reach it with `stores.read` and `stores.write` (D-93).

- A merchant profile's stores (D-30). The first is made with the profile, named after it (a database trigger).
- `GET /v1/profiles/{profileId}/stores` lists them, the first first; a personal or freelancer profile has none.
- `GET /v1/profiles/{profileId}/stores/{storeId}` reads one store; an unknown id or one outside a scoped member's stores is 404 `store_not_found`.
- `PUT /v1/profiles/{profileId}/stores/{storeId}` creates or replaces one by a lowercase UUID the caller picks.
  - 201 the first time, 200 after; the 21st store is 422.
  - `name` (1–64 characters on one line, not naming Forwend) and `defaultExpiresIn` (900–31536000 seconds) are required.
  - `allowedOrigins`: up to 20 https origins without a path, query or fragment.
  - The host is a hostname of letters, digits, hyphens and dots, with an optional port: no `*`, since an origin can frame.
  - Origins are kept in lower case without the default port, and repeats count once.
  - An http origin on `localhost` or `127.0.0.1` is also taken, for test mode (R-168).
  - Return links stay https only, so a loopback origin never allows one.
  - A personal or freelancer profile is 409 `not_merchant`; another profile's store id is 404 `store_not_found`.
- The store id is the project ID: public, with no authority (D-31). There is no delete yet: invoices point at stores.
- Branding (R-135): `brandColor` is `#rrggbb` (kept in lower case) or empty for none; stores read back `logoAt`.
  - `PUT .../stores/{storeId}/logo` takes the image itself as the body: a PNG or JPEG.
  - It is at most 1 MB and 1024 pixels a side; anything else is 422.
  - The API keeps an 8-bit PNG it encodes from the pixels, so nothing else the upload carried is served.
  - `DELETE .../stores/{storeId}/logo` removes it; both answer the store.
  - `GET /v1/stores/{storeId}/logo.png` is public, with `Content-Security-Policy: default-src 'none'` and an ETag.
  - Without a logo it is 404 `logo_not_found`.
  - Every invoice read, the public one too, has `brand` `{storeId, color, logoAt}`; null without a store.
  - The invoice and receipt PDFs show the logo in place of Forwend's mark and the color on the header rule.

## Team

R-139, D-93; the full schema is in openapi.yaml. A merchant profile's members and invites (`internal/team`).

- On a personal or freelancer profile, inviting, changing a role, removing and leaving are 409 `not_merchant`.
- Invites, accepts, role changes and removals lock the profile row, so on one team they happen one after another.
  - Invites and role grants recheck the acting user under that lock; a demoted member cannot complete a pending grant (R-175).

- `GET /v1/profiles/{profileId}/members` (`team`): the owner first, then the members, and the open invites newest first.
  - A member has `memberId`, `email` (the account's login email, null without one), `role` and `stores`.
  - An Admin's and the owner's `stores` are empty: they reach every store.
- `POST /v1/profiles/{profileId}/invites` (`team`, fresh sign-in) takes `{email, role, stores}` and answers 201 with the invite.
  - `role` is admin, developer or finance. A Developer or Finance member needs one store or more; an Admin none.
  - The email is checked like a client email. An address already on the team is 409 `already_on_team`.
  - Under the profile lock the inviter's `team` permission is checked again, so a member removed meanwhile sends nothing.
  - A new invite to the same address revokes the open one.
  - It counts toward the client email cap (R-116); past it the answer is 429 with `Retry-After`.
- The invite's link token is 32 random bytes in hex. `profile_invites` keeps only its SHA-256.
  - The `team.invite` outbox row carries the token for the email to `/invite/<token>`.
  - The worker drops the token from the row once the email is sent, skipped or given up.
  - A revoked, accepted or expired invite sends nothing. Reply-To is the inviter's login email.
- `DELETE /v1/profiles/{profileId}/invites/{inviteId}` (`team`) revokes an open invite: 204, else 404 `invite_not_found`.
- `PUT /v1/profiles/{profileId}/members/{memberId}` (`team`, fresh sign-in) takes `{role, stores}` and answers the member.
- `DELETE /v1/profiles/{profileId}/members/{memberId}` (`team`) takes a member off the team: 204.
- `POST /v1/profiles/{profileId}/leave` (`team.leave`) takes the signed-in member off the team: 204.
  - Removing a member, leaving, or a change away from Admin revokes the open invites that member sent.
  - The owner is an Admin for good: changing, removing or leaving as the owner is 422.
  - An unknown member is 404 `member_not_found`.
- `GET /v1/invites/{token}` (signed in): `{profileName, email, role, expiresAt}` for any user who has the link.
- `POST /v1/invites/{token}/accept` (signed in) puts the user on the team and answers `{profileId}`.
  - The user's verified login email, read from Privy, must be the invited address; else 403 `invite_for_another_email`.
  - Accepting also marks the first run done.
  - A used, revoked, expired or unknown invite is 404 `invite_not_found`, on both routes.
  - The owner, or a member already, is 409 `already_on_team`.

## Checkout sessions and payments

- `POST /v1/profiles/{profileId}/checkout-sessions` needs `invoices.write`, an Idempotency-Key, explicit `storeId` and exact `amountUsd`.
- Optional `items` contain description, quantity and USD unit price; their exact sum must equal `amountUsd`.
- `reference` identifies the merchant's order; it never changes after creation.
- Optional customer name and email do not create a billing document or require a saved client.
- Exact retries return the original session, including concurrent retries that fill the last creation slot.
- Changed prices, items, references, stores or key modes conflict; current store settings do not alter a retry.
- Responses contain `sessionId`, session `status` and a canonical `payment` with its `paymentId`, states and `hostedUrl`.
- Session status is `open`, `complete` or `expired`; payment and settlement states remain separate.
- `GET /v1/profiles/{profileId}/checkout-sessions` and `/{sessionId}` read checkout attempts without document-number restrictions.
- `POST /v1/profiles/{profileId}/checkout-sessions/{sessionId}/expire` closes an open attempt without observed money.
- Expiring cancels collection: `paymentStatus` and webhook names stay `canceled`, while the payment `state` reads `expired`.
- Repeated expiration returns the closed session; seen payments refuse expiration with 409 `checkout_not_expirable`.
- `GET /v1/profiles/{profileId}/payments` and `/{paymentId}` read every workflow, including unnumbered attempts.
- Lists accept `limit`, opaque `cursor` and `storeId`; creation time and ID provide stable pagination.
- Payment and checkout reads honor tenant, role, assigned stores, key scopes and key mode.
- Invoice-only sending rejects document-free checkout; payment notifications currently open its working hosted page.
- Public checkout shows item snapshots using the main option's trusted token decimals, independent of the chosen payment option.

### Payment operations

- Payment lists accept `linkId`, `source`, `storeId`, `status`, `paymentStatus`, `settlementStatus` and `refundStatus`; filters intersect permitted stores and key mode.
  - They also accept `state`, `wallet` and an exact `reference`; movements, reconciliation, attention and CSV take the same filters.
- Payment reads add `state` and `wallet` (D-114); raw statuses keep their values for compatibility.
  - `state`: `waiting`, `confirming`, `partially_paid`, `paid`, `overpaid`, `expired` or `canceled`.
  - Confirming includes a payment credited in full that waits for the finalized balance check.
  - Its raw `paymentStatus` can stay `partially_paid` there, since the database allows no way back to `detected`.
  - The same case sets `confirming` and matches `status=confirming` on payment, invoice and activity lists.
  - Overpaid is paid with money held for the payer on any option: extra, late or on another option.
  - `refundStatus` and `amounts` describe only the current option; receipts show held money on every used option.
  - `wallet`: `none` before paid, `pending`, `in_wallet` once settled, `delayed` or `refused`.
  - Delayed means the settle waits for a retry, the daily limit or an unresolved transaction.
- Payment reads add a nullable `dueDate`; payment detail adds `items` in the main option's base units.
- Payment reads include canonical symbol, decimals, option ID, option count and whether an option has been locked.
- Token metadata follows the stored chain and contract, including tokens disabled after the payment was created.
- Net amounts include `reconciliationStatus`: `verified`, `pending` booking, or `review` for evidence an operator must check.
- The existing `unreconciled` flag continues blocking unsafe financial actions during either pending verification or manual review.
- Movements awaiting booking remain pending; unexplained balances, refused outflows and policy exceptions require review.
- Other-asset recovery records remain distinct from accepted-token reconciliation.
- The owner page groups option verification into one notice; token-specific returns remain separate.
- Customer checkout and receipt PDFs distinguish pending verification from manual review without changing payment truth.
- Sources are `invoice`, `request`, `payment_link` and direct `checkout`; source differs from the attached document kind.
- List cursors use immutable creation time and payment ID, including unpaid attempts.
- Payment detail preserves its existing root fields and adds customer, metadata, options, source coverage, settlement intent, deposits, deliveries and problems.
- Detail includes each option's exact receiver, merchant payable, payer-held, settled and returned amounts.
- Deposit and delivery details are bounded at 100; truncation flags and delivery count disclose omitted records.
- `GET /v1/profiles/{profileId}/payments/attention` returns payment problems separately from financial truth.
- Ordinary confirmation and historical verification suggest waiting; conflicting evidence requires review.
- Partial payments suggest sharing checkout only while open and reconciled; held funds never imply an initiated refund.
- A `held_funds` problem's `reason` uses the `invoice.held` names: `overpaid`, `late`, `expired`, `canceled`, `other_option`.
  - It is the ledger's reason for the money held since the last reopen.
  - It is null when those holds have several reasons, or don't add up to what is held now.
  - That covers on-time dust, holds from before held history, and a part return.
- A partial-payment problem appears only while part of the amount is still owed.
- Settlement intent appears delayed after 15 minutes; explicit waits and refusals remain visible immediately.
- Delivery problems preserve payment status and expose safe attempt metadata without endpoint secrets, URLs, payloads or raw errors.
- Owners and Admins also receive endpoint problem summaries, including test events without payments.
- Endpoint summaries follow store and mode filters; payment source and status filters apply only to payment rows.
- Endpoint summaries disclose truncation; the existing Developers page manages the full endpoint list.
- Members without webhook permission receive `ask_admin` actions and cannot manage endpoints.
- `GET /v1/profiles/{profileId}/payments/movements` returns paged journals and separate unbooked source observations.
- `GET /v1/profiles/{profileId}/payments/{paymentId}/movements` restricts the same movement read to one permitted payment.
- Movements retain source, store, document number, order reference, token identity, decimals, transaction, event index and token-transfer index.
- Booked rows contain signed receiver, payable and held deltas; observed rows leave all booked financial columns null.
- Expiry and reopening produce noncash allocation rows; summing receiver deltas never counts those allocations as new money.
- `GET /v1/profiles/{profileId}/payments.csv` exports the same records; `/{paymentId}/movements.csv` restricts them to one payment.
- CSV streams database rows into a bounded output buffer; more than 10000 records returns 422 `too_many_movements` before sending CSV.
- CSV headers include snapshot time and record count; text cells prevent spreadsheet formulas while signed financial numbers remain numeric.
- Movement pages are live views; booking can replace an observation between pages.
- Use CSV for a complete period from one consistent snapshot.
- Verification fields identify the finalized block and hash of a deposit or receiver event.
- Internal allocation rows (expiry, reopen) carry no block or transaction identity.
- Missing cash sources leave source amount, destination and transaction identity unknown; only journal deltas remain summable.
- Movement dates filter the UTC day recorded in Forwend, not block time; `from` and `to` are inclusive.
- Block time remains a separate field; records discovered later enter later recorded periods.
- USD deltas use exact decimal units and the accepted stablecoin's nominal one-dollar value, without a market-price claim.
- `GET /v1/profiles/{profileId}/payments/reconciliation` returns opening balances, period changes, closing balances, settlements and returns by store, chain and token.
- `GET /v1/profiles/{profileId}/payments/{paymentId}/reconciliation` restricts that report to one payment.
- Reconciliation dates use journal recorded time; its response `to` is exclusive UTC midnight after the requested inclusive day.
- Opening plus changes equals closing; receiver equals merchant payable plus payer-held funds.
- Each asset row counts pending, unbooked, exceptional and other-asset movements, and the chain's finalized block.
- `checkpointBalance` and `checkpointDifference` are null: the scan keeps no balance per receiver (D-116).
- `unprovedDeposits` is 0 and every receiver counts as verified.
  - The chain's scan reads each address's deposits from its creation until 30 days after its settle deadline.
  - It reads the receiver's own events for as long as the receiver holds booked money.
- Missing source evidence stays explicit; financial journals and immutable source records remain independently inspectable.
- Every operation uses one repeatable-read database snapshot; CSV snapshot headers identify its cutoff.
- Wallet transaction exports and statements also read their records-currency setting inside the same snapshot as their rows.

## Payment links

R-140, R-163, D-54, D-94; openapi.yaml owns the schema. Members use `invoices.read` and `invoices.write` (D-93).

- A link is a reusable offer at `/l/<slug>`; opening it creates nothing.
- Its profile, store, mode and random 12-character slug never change.
- Keys create and read links only in their mode; owner creates choose live mode when enabled live tokens exist.
- Owner edits preserve mode; missing `storeId` preserves the original store.
- `GET /v1/profiles/{profileId}/links` lists newest first; scoped members see only their stores.
  - It reads one page: `limit` (1–100, default 50) and `cursor`, and `nextCursor` continues it.
  - `paid` counts canonically paid purchases, including settled purchases.
  - `reserved` counts canonical open, detected and partly paid purchases.
  - `ready` requires billing details, a wallet and an accepted watched token in the link's mode.
- `GET /v1/profiles/{profileId}/links/{linkId}` reads one; another profile's or inaccessible store's link returns 404 `link_not_found`.
- `PUT /v1/profiles/{profileId}/links/{linkId}` saves a caller-chosen lowercase UUID: 201 on creation, otherwise 200.
  - `title` is 1–200 characters of plain text on one line.
  - Fixed links send `amountUsd`; open links omit it and may send `minUsd` and `maxUsd`. Each is at least 1.00.
  - USD amounts have at most two decimals, above zero; minimum cannot exceed maximum.
  - Optional `endsAt` stops new purchases; `maxPayments`, from 1–1000000, limits paid plus reserved purchases.
  - `active` defaults true; activation requires readiness, otherwise 409 `link_not_ready`.
  - Inactive drafts need no readiness; personal profiles return 409 `personal_profile`.
  - New merchant links default to the first accessible store; freelancer links have no store.
  - Changing an existing store returns 422; use another link for another store.
- Public routes require no sign-in; malformed or unknown slugs return 404.
  - `GET /v1/links/{slug}` returns title, payee, store branding, amounts and decimal-string `version`.
  - State is `on`, `off`, `ended`, `full` or `not_ready`; only `on` starts new purchases.
  - Version changes with offer terms or availability settings; visits and identical saves leave it unchanged.
  - `POST /v1/links/{slug}/visits` counts a load and returns 204.
  - `POST /v1/links/{slug}/pay` creates document-free checkout: 201, or 200 when replaying the same request.
  - Response includes `paymentId`, `sessionId` and `payToken`; `/pay/<token>` remains its hosted checkout.
  - Open links require `amountUsd` within limits; fixed links omit it. Invalid amounts return 422.
  - Optional `expectedAmountUsd` and `expectedVersion` bind a purchase to the displayed offer.
  - A changed quote returns 409 `link_changed`; an already committed request replays its original terms first.
  - The idempotency key, at most 200 bytes, is isolated from owner keys and other links.
  - Original input and quotes are immutable; reusing a key with different input returns 409 `idempotency_conflict`.
  - Existing requests replay even after disabling, expiry, capacity exhaustion or template changes.
  - New closed requests return `link_off`, `link_ended`, `link_full` or `link_not_ready`, without creating anything.
  - Checkout keeps the link's store, mode, title, accepted tokens and store close default; no invoice number is allocated.
- Creation reserves capacity transactionally; rejected reservations spend no shared creation budget.
- Canonical expiry releases unused reservations; elapsed wall time alone does not release an unresolved payment.
- Reopening a legacy partly paid purchase also reserves capacity; unavailable capacity returns 409 `link_full`.
- Deploy backend and migration before frontend; old clients remain accepted without optional quote fields.
- Legacy requests preserve hashes and documents; supplied amounts must match original terms.
- Legacy storage cannot prove omitted fixed/open input or old offer versions; new request metadata provides that guarantee.

## API keys

R-144, D-95; the full schema is in openapi.yaml. Owners and Admins manage keys with the `keys` permission (D-93).

- `GET /v1/profiles/{profileId}/keys` lists the working keys, newest first: a key past its overlap or revoked is gone.
  - Each has its `name`, `last4`, `storeId`, `scopes`, `livemode`, `createdAt`, `lastUsedAt` and `expiresAt`.
  - `lastUsedAt` is kept to the minute; `expiresAt` is set once the key was rolled.
- `POST /v1/profiles/{profileId}/keys` makes a key and needs a fresh sign-in (D-63). It answers 201 with its `secret`.
  - The `secret` is in that answer alone; only its SHA-256 is kept.
  - The role is checked again as the key is written: a request checked before a removal or a role change is 403.
  - It is `fw_test_`, 30 random base62 characters and a 6-character CRC32 of the rest. Live keys wait for a live chain.
  - `name` is 1–100 characters of plain text; `scopes` are one or more of the four D-95 names.
  - A merchant key needs `storeId`, one of the profile's stores. A freelancer's key has none; a personal profile is 409.
- A key reaches only invoices of its own mode (D-87, R-156).
  - Its lists, reads, actions, activity, owed and webhook events leave out the other mode; such an invoice is 404.
  - Its creates are of its mode: a token of the other mode is 422, and a replay of another mode's create is 409.
  - A Revise of the other mode's invoice is 404. A Revise or a retainer's later month keeps the mode it follows.
  - A payer-chooses invoice's options are all of one mode.
  - An unscoped USD create chooses live mode before profile and store token preferences when enabled live options exist.
  - Filtering out those live tokens returns 422; it never falls back to test mode.
- `POST /v1/profiles/{profileId}/keys/{keyId}/roll` makes its new key, with a fresh sign-in, and answers 201 with it.
  - `overlapHours` (0–168, default 24) is how long the old key keeps working. A key rolls once.
- `DELETE /v1/profiles/{profileId}/keys/{keyId}` revokes the key at once (204). An unknown or stopped key is 404.

## Webhooks

R-146, D-96; the full schema is in openapi.yaml. Owners and Admins manage them with the `webhooks` permission (D-93).

- Without `WEBHOOK_SECRET_KEY` (32 bytes in base64) the api keeps no secret.
  - Saving an endpoint, and revealing or rotating its secret, then answer 503 `webhooks_not_configured`.
  - The list and a delete still work.
- `GET /v1/profiles/{profileId}/webhooks` lists the endpoints, newest first.
- `PUT /v1/profiles/{profileId}/webhooks/{endpointId}` creates or replaces one by a lowercase UUID, with a fresh sign-in.
  - 201 the first time, when it gets its first secret, which only the secret route shows; 200 after.
  - The role is checked again as it is written, as for keys.
  - Another profile's id is 404 `endpoint_not_found`.
  - `url` is https, at most 2048 characters, with no credentials and no fragment.
  - Its host must be public: no localhost, `.local` or `.internal` name, and no private, loopback, link-local or CGNAT address.
  - A name must be ASCII, in its punycode form, and can't end in a number: resolvers read `127.1` as 127.0.0.1.
  - IPv6 that carries an IPv4 address (IPv4-compatible, NAT64, 6to4) is refused too.
  - A host name is not resolved here; deliveries check its addresses after DNS (PLAN 11.5).
  - `events` are one or more of `invoice.detected`, `invoice.partially_paid`, `invoice.paid`, `invoice.settled`,
    `invoice.expired`, `invoice.canceled`, `invoice.held`, `invoice.open` and `invoice.reopened`.
  - `storeId` (optional) narrows a merchant's endpoint to one store; a freelancer's has none. `enabled` defaults to on.
- `DELETE /v1/profiles/{profileId}/webhooks/{endpointId}` removes it and its secrets (204).
- `GET /v1/profiles/{profileId}/webhooks/{endpointId}/secret` reveals the working secrets, newest first, with a fresh sign-in.
  - A secret is `whsec_` and the base64 of 32 random bytes (Standard Webhooks). It is kept sealed, never as text.
- `POST /v1/profiles/{profileId}/webhooks/{endpointId}/secret/rotate` makes a new secret (201, with a fresh sign-in).
  - The old one keeps its `expiresAt`, 24 hours on, and signs until then.

### Events

R-147, D-97; the body is `WebhookEvent` under `webhooks` in openapi.yaml.

- `history.Add` writes an event for each change an event type names, in the change's transaction.
  - A status change writes its type; an expiry with money paid is `invoice.expired`.
  - A cancel, also by a Revise, is `invoice.canceled`.
  - Money held for the payer is `invoice.held`, one event per reason in a run.
  - A reorg that takes away the payment an invoice was detected with is `invoice.open`: it waits for payment again.
  - An owner's reopen of an expired, partly paid invoice is `invoice.reopened` (R-130).
- Each event gets a delivery for each endpoint, fixed at the commit.
  - The endpoint is the invoice's profile's, of the same `livemode`, on, and takes the type.
  - A store's endpoint takes only that store's invoices.
- The body is `{id, type, livemode, sequence, timestamp, data: {invoice, held}}`.
  - `id` is `evt_` and 32 hex digits. It stays the same for every endpoint.
  - `sequence` counts the invoice's events from 1, in commit order. A receiver can skip a change older than one it has.
  - `data.invoice` is the invoice as `GET /v1/profiles/{profileId}/invoices/{invoiceId}` answers when the event is sent.
  - `data.held` is null except on `invoice.held`: `amount` in base units, `reason`, and `optionId` on a payer-chooses invoice.
  - A held `reason` is `overpaid` (more than the amount, or after paid), `late` (after the checkout closed), or `expired`.
  - It can also be `canceled`, or `other_option` (sent to an option the payer did not choose, D-76).
- A legacy payment-link invoice's `invoice.detected` can come before it has a number (R-141).

### Events list

R-153, D-102. `GET /v1/profiles/{profileId}/webhook-events` needs `invoices.read`, so a key can read it too.

- It lists the profile's invoice events of the last 30 days, newest first.
- A page holds `limit` events, 1 to 100 and 50 by default, and `nextCursor`, null on the last page.
  - Pass `cursor` for the next page. A page never repeats an event.
  - An event that commits while you page can be missed: to catch it, start again from the first page.
- `type` keeps one event type. A wrong `limit`, `type` or `cursor` is 422 `invalid_value`.
- Each item is the body a webhook would carry now, with the invoice as the owner reads it.
- A store's member or key sees only its stores' events. Test events are not listed.

### Delivery

R-148, D-98. `cmd/webhooks` sends each delivery as a `POST` of the event's body, `Content-Type: application/json`.

- Standard Webhooks headers: `webhook-id` (the event's id), `webhook-timestamp` (Unix seconds) and `webhook-signature`.
  - The signature is `v1,` and the base64 HMAC-SHA256 of `id.timestamp.body`, keyed by the secret's bytes after `whsec_`.
  - It holds one such entry per working secret, space-separated: during a rotation's 24 hours, the new and the old.
- Sender workers share capacity fairly across profiles, with at most two active attempts per profile and one per endpoint (R-175).
  - A slow endpoint leaves capacity available for other profiles.
- Only a 2xx answer within 15 seconds counts. A 3xx fails: no redirect is followed.
- The client refuses an address that is not public, checked on the address it connects to after DNS.
  - That covers this machine, private networks, link-local and cloud metadata addresses, and a name that rebinds to one.
- A failure retries after 5 s, 5 min, 30 min, 2 h and 5 h, then every 10 h: 12 attempts in about 3 days.
  - Every retry sends the body built for the first attempt, signed again with its own timestamp.
- A `410`, or a delivery's last failure, turns the endpoint off (`enabled` false).
  - The profile owner gets one email naming the endpoint's host, whatever the profile's email setting.
  - Its waiting deliveries go out once the owner turns it on again; events from while it was off are not sent to it.
- Each attempt is kept with its status code, a short error without the URL, and how long it took.

### Deliveries

R-149, D-99. These need the `webhooks` permission and no fresh sign-in: they send only where the endpoint already sends.

- `GET /v1/profiles/{profileId}/webhooks/{endpointId}/deliveries` lists the 50 newest, each with every attempt.
  - A delivery has its event's type, the invoice and its number, `status`, and `nextAttemptAt` while pending.
  - An attempt has its time, `statusCode` (null with no answer), `error` and `durationMs`.
- `POST .../deliveries/{eventId}/resend` starts the delivery again from a first attempt, with its first body (204).
  - Another endpoint's or profile's delivery is 404 `delivery_not_found`.
- `POST .../deliveries/resend-failed` with `since` (RFC 3339) does that for every delivery that failed since then.
  - It answers `{resent}`, how many.
- `POST .../test` queues a `webhook.test` event for this endpoint alone and answers its `eventId` (201).
  - Its body is `{id, type, livemode, timestamp, data: {}}`: no invoice and no sequence.
- A resend or test waits while the endpoint is off, and goes once it is on.
- An attempt in flight when a resend lands is logged, but its answer does not undo the resend.
- Tests and resends share a limit of 32 pending deliveries per profile (R-175).
  - A full queue returns 429 `webhook_queue_full`. Automatic financial events remain unrestricted.
  - Bulk resend queues only the available capacity and returns the actual count.
  - Resending an already pending delivery preserves its active lease.
- Without `WEBHOOK_SECRET_KEY` nothing can be signed, so the test and both resends answer 503.

## Invoices

- Reads include immutable `purpose` (`invoice`, `checkout`, `request`) and `documentKind` (`invoice`, `request`, `none`).
- Owner reads include `linkId` when a reusable link created the attempt.
- Existing link attempts retain invoice documents and delayed numbering, including unnumbered attempts made before migration.
- Dedicated checkout operations create document-free attempts; deposits never assign them an invoice number.
- `invoice.pdf` returns 404 for document-free checkout; paid receipts remain available.
- Existing invoice creation and retry hashes remain compatible. Checkout purpose has a separate request fingerprint.

R-19 and R-42; the full schema is in openapi.yaml.

- A new invoice or request asks for at least 1.00 USD (R-56): `amountUsd` at least `1.00`, or `amount` at least one
  whole token. Less is 422 `invalid_value`. Links, checkouts and job payments follow the same minimum.

- `livemode` is the invoice's chain's mode (D-87, R-143): false on a testnet, whose tokens have no value.
  - Both PDFs of a test-mode invoice say "Test mode: testnet tokens have no value" under the header; every footer says Test mode.
- `number` is an integer per profile: 1, 2, … in creation order (D-50). The API never formats it; the web shows
  `INV-` and at least 4 digits (`INV-0001`). The insert takes it from the profile's counter row (`profiles.invoice_seq`)
  in the invoice's own transaction, so a failed create uses no number and a repeated Idempotency-Key returns the
  stored one.
- A legacy payment-link invoice gets its `number` when the ledger books its first deposit, in that transaction (R-141).
  - Until then the pay page's read shows `number: null`, and the PDF has no number.
  - The owner's routes with an `{invoiceId}` answer 404 `invoice_not_found` for it, as does `replaces`.
  - The invoice list, search, Owed and Activity leave it out, with its deposits.
  - Transactions shows money from its address as not from an invoice. The balance's pending still counts its deposits.
  - Its history gets `invoice.numbered` by `system` when the number comes.
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
- A `dueDate` with no `expiresIn` (R-152) closes the checkout at the end of the 60th UTC day after it (D-80).
  - The close stays 15 minutes to 365 days from now, and a store's `defaultExpiresIn` doesn't apply.
  - The idempotency hash takes the due date and 3600 for the missing `expiresIn`, so a later retry returns the same invoice.
  - So does the same key with `expiresIn: 3600`, as with a store's default.
- Optional `metadata` (R-151, D-101): the creator's own keys and values, set at create only.
  - An object of up to 20 keys; a key is 1 to 40 letters, digits, `_` or `-`.
  - A value is plain text on one line of up to 500 characters. Any other shape is 422 `invalid_value`.
  - The owner's reads, lists and webhook bodies return it, `{}` when none was sent.
  - The pay page's GET and the PDFs never show it.
  - It is part of the idempotency hash only when set, whatever the order of its keys.
  - A retainer's later months keep it; a Revise takes only the metadata its own create sends.
- Optional `storeId` (R-134): a merchant invoice's store, the profile's first store when left out.
  - A personal or freelancer profile's, or one that is not the profile's store, is 422.
  - Without `expiresIn` or a `dueDate` the checkout closes after the store's `defaultExpiresIn`.
  - `returnUrl` must start with one of the store's `allowedOrigins`; a store without origins takes no return link.
  - The idempotency hash has `storeId` only when sent, and 3600 for a missing `expiresIn`, whatever the store's default.
  - The store never changes (a trigger). The owner's reads return `store` `{storeId, name}`; others leave it out.
  - Edit checks a changed `returnUrl` against the store's origins; an unchanged link stays.
  - A retainer's later month keeps the first month's `returnUrl`, also after the store drops its origin.
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
- `settlementTxHash` identifies the actual booked receiver settlement, including an authority settlement outside the signer.
  - Deposit activity preserves gross observed movements; net liabilities come from `amounts`.
- An invoice carries `confirming` when an on-time transfer awaits finality or credit after confirmation. A
  `partially_paid` invoice keeps that status while the rest confirms, so readers show it as confirming (R-69).
- An invoice read alone also has `paidAt` and `settledAt`, null until reached.
  - `paidAt` identifies the completed payment; `settledAt` uses the actual settlement block time.
  - Legacy settlement records without source evidence retain their recorded ledger time.
- Detail reads and payment reads expose `amounts` in the selected option's base units.
  - `receiver`, `payable` and `held` are current net balances; `settled` and `refunded` are booked outflow totals.
  - `observedRefunded` and `lastReturnTxHash` expose confirmed returns, including returns still awaiting financial attribution.
  - `unreconciled` means a movement waits for booking, an outflow was refused, or a balance can't be explained.
  - Negative legacy balances remain visible.
  - `hasPolicyException` identifies an authority movement outside ordinary allocation policy, even when its accounting fully reconciles.
  - Each option carries its own `amounts` and effective `closesAt`.
- Detail `deposits` previews contain at most 100 transfers per option, in chain order, excluding reorged transfers (R-174).
  - Previews include 95 recent transfers and transfers needed for first-payment choice, confirmation progress, booking delays and receipt links.
  - `depositSummary` counts all transfers and sums `onTimeAmount`, `lateAmount` and `pendingAmount` in base units.
  - `pendingAmount` includes on-time transfers without a deposit or reopen booking.
  - The summary is omitted when no transfers exist. Use summary totals, never preview sums, when it is present.
  - Checkout, owner pages and receipt PDFs identify incomplete transaction lists; their totals remain complete.
- Each of its `deposits` has the sender `from` (lowercase hex, as stored) and `blockTime` (the block's time, RFC 3339
  UTC), from the stored transfer.
- `GET /v1/profiles/{profileId}/invoices?limit=&cursor=&status=&state=&q=`: the list format above, highest number (newest)
  first; items have no `deposits`. Members reach it with `invoices.read`, Developer and Finance for their stores (D-93).
- `GET /v1/profiles/{profileId}/invoices/{invoiceId}`: the public GET plus `client`, `settlementWait`, `history` and `views`.
  Another profile's invoice is 404 (`invoice_not_found`), also when the same user owns both.
  - `history` (R-124) is every `history_events` row of the invoice, newest first, also in create and the other
    owner answers.
  - A row is `{id, kind, actor, at, optionId, amount, txHash, step, field, from, to, related}`; the last eight are null
    when the row has none.
  - The worker writes a row for each Send to client, reminder and receipt it sends or gives up on (R-126).
  - By is who asked: the owner for Send to client, `system` for a retainer month, reminders and receipts.
  - Reminders on and off, the client's stop link and Stop repeating write a row only when they change something.
  - `amount` is in the token of `optionId`, or of the shown option when `optionId` is null.
- `PUT /v1/profiles/{profileId}/invoices/{invoiceId}/details` (R-127, R-128) replaces what the owner may edit:
  `memo`, `clientEmail` and `returnUrl` at any time; `reference`, `note` and `dueDate` before any payment.
  - A change to the last three needs every option open, the checkout open and no transfer seen; else 409
    `invoice_not_editable`. It locks the rows the ledger locks, in its order and mode, as cancel does.
  - A new `dueDate` lies between today and the day the checkout closes (UTC).
  - A due date's history row has `from` and `to`.
  - The database refuses these changes once money was seen.
  - Both invoice reads return `updates`, newest first: `{at, field, from, to}` for these three fields (the payer's
    view of them).
  - A missing, null or blank field clears it.
  - They are checked as on create; the memo is at most 2000 characters.
  - Each field that changes writes one `invoice.edited` history row with `field`, never the value.
  - The memo is the owner's own note: only the owner's reads return `memo`, and no pay page, PDF or email shows it.
  - It changes this invoice only: a retainer's later months keep the details it started with.
- `GET /v1/invoices/{payToken}/embed?origin=…` (R-168) answers `{"allowed": bool}`; the web app asks it before `/embed`.
  - true only for an origin exactly as a browser writes it, on the list of the store the invoice records.
  - A live invoice takes https origins only; a test-mode invoice also takes the store's loopback http origins.
  - An invoice without a store is never framed. An unknown token is 404; the store's origins are never listed.
- `POST /v1/invoices/{payToken}/views` (R-125) counts one pay page load and answers 204.
  - The page sends it once per load, not with each status refresh.
  - The pay page links on the owner's invoice and payment pages add `?preview=1`; the page then sends none (R-125).
  - `invoice_views` keeps a count, the first time and the last time; never an IP or user agent.
  - The owner's reads return `views` `{count, firstAt, lastAt}`; the times are null before the first load.
  - The R-51 canary blocks it, so its checks are not counted.
- Create with `replaces` (R-129) is a Revise: it makes the new invoice and cancels the old one in one transaction.
  - The old one is canceled with Cancel's checks and locks; otherwise 409 `invoice_not_cancelable` and nothing is made.
  - Another profile's or an unknown invoice is 404. `replaces` is part of the idempotency hash only when set.
  - The new invoice keeps the old one's mode (R-156): a token of the other mode is 422, and a key's other-mode invoice 404.
  - Both reads of the old invoice return `replacedBy` `{invoiceId, number, payToken}`, the new one's pay link.
  - The owner's reads of the new one return `replaces` `{invoiceId, number, payToken: null}`.
  - History: `invoice.replaced` on the old one and the new one's `invoice.created` name each other in `related`.
- `POST /v1/profiles/{profileId}/invoices/{invoiceId}/reopen` (R-130) reopens an invoice that closed partly paid.
  - Only once, and a day or more before its receiver's settle deadline.
  - That deadline is the settle deadline, or 30 days after an early receiver deploy if sooner.
  - Confirmed refunds or settlements prevent reopening. Every movement of the option must be booked first.
  - Missing evidence returns 409 `payment_reconciliation_pending`; eligibility failures return `invoice_not_reopenable`.
  - Otherwise 409 `invoice_not_reopenable`.
  - Its checkout opens again until a day before that deadline, at the same address and terms.
  - It locks the rows the ledger locks, in its order.
  - `ledger.Reopen` books the reopen (see architecture.md).
  - `closesAt` includes an earlier operational close after verified early deployment, leaving one day before settlement ends.
  - Signed terms and receive addresses remain unchanged.
  - Before a choice, the group stays open while any option remains open; each option retains its own deadline.
  - The owner's reads return `reopenUntil`: the close a reopen would give now, or null.
  - History gets `invoice.reopened`, its `until` the new close.
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
- `GET /v1/profiles/{profileId}/owed` (R-95) lists what customers still owe, for the Owed to you panel.
  - Rows: payments under the `open` status filter that are overdue or partly paid.
  - Numbered invoices and requests count, and so do checkout sessions: `number` null, with their `reference`.
  - Overdue means the due date is before today's UTC date; `daysLate` counts whole UTC days.
  - `amount` is what is left: the amount less the `recipient_payable` credits. No settlement runs before it is all in.
  - A row with nothing left is left out: all of it is booked and waits for the finalized balance check.
  - Held money is the payer's and never owed (D-114), so no row has kind `held`.
    - Balances show it as `held`, and each payment shows its own.
  - Order: overdue (most days late first), then partly paid.
  - `items` holds the first `limit` rows (1–100, default 50). `count` and per-token `totals` cover every row.
  - The read adds up every row; the open filter keeps them within twice `MaxOpen` receive addresses (the owner's and its links').
- `settlementWait` (owner reads and create only) says why a paid invoice's money has not reached the profile wallet
  yet, null when it is not paid or already settled (R-54): `{kind, until, secondsLeft}` with `kind` one of `signing`,
  `finalizing` (`secondsLeft` estimates the chain time until the settle is final), `retrying` and `dailyLimit` (the
  user's sponsored settlements for 24 hours are used up; both with `until`, the next try) and `refused`. It comes from
  the intent's status and the wait kind the signer stores with it, never from log text.
- Payer chooses (R-56, D-75, D-76): create with `amountUsd` alone (a decimal like `"12.50"`) instead of `chainId`,
  `token` and `amount`. The invoice accepts every enabled token on every enabled chain the worker already watches
  (others would miss payments), of one mode (R-156), each at 1 USD per token: the amount in the token's decimals, 422 when they
  can't hold it exactly. It leaves out the tokens the profile or its store has off (R-136). Each option is an `invoices` row of its own with its own on-chain id (the first random, the
  others `keccak256(abi.encode(first id, chain id, token))`, so the pay page can tie them to the link), terms and
  receive address, so the watcher, ledger and signer treat it as any invoice; the first row is the invoice (its token is the pay
  link, its number and details are the invoice's). Each option counts toward the profile's open and daily limits.
  Reads add `optionId` (the on-chain id in the shown terms), `optionLocked`, `optionCount` and, on a read alone, `options` (each
  `{optionId, chainId, network, token, symbol, decimals, amount, receiveAddress, deposits}`; deposits on an option
  other than the shown one are held for the payer). Until an option has money the
  terms shown are the first option's.
  - The first option whose final payments add up to 1.00 USD becomes the invoice's for good (`chosen_id`, R-119).
  - A smaller deposit before the choice is held for the payer, and on the chosen option a payment before the one
    that brought it to 1.00 USD is held too. On-time dust on an open invoice sends no email or webhook.
  - Dust doesn't stop cancel or the edits the payer sees: only a payment that can choose an option does.
  - An older invoice under 1.00 USD needs its whole amount to choose.
  - No other chain is waited for. Money on any other option is booked to `payer_held`.
  - The owner's GET with an option's id answers its invoice; the public routes don't take ids.
  - Lists, activity and search show each invoice once, with the current option (`invoices_current` view).
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

- `internal/document` draws them with `codeberg.org/go-pdf/fpdf` in a fixed layout, from `invoice.Get` only.
  - No templates, network or file reads.
  - The font is Noto Sans, embedded (`internal/document/fonts`, SIL OFL 1.1). Its digits share one width, so amounts align.
  - Long texts wrap and are cut with "…"; amounts and item descriptions are never cut.
  - Characters above U+FFFF (emoji) print as "?".
- Both look like the product (R-61): near-black ink, neutral greys and hairline rules, so they print in black and white.
  - The header has the Forwend mark (`internal/document/logo.path`, a copy of `packages/ui-web/src/icons/logo-data.ts`).
  - Beside it are the kind, the number (`INV-0001`) and the reference under it (R-90).
  - A test-mode invoice has a TESTNET band under the header saying "Test mode: testnet tokens have no value" (R-143).
  - A status panel follows, with a lime mark that is grey once the invoice is canceled or expired.
  - Then From (the issuer's copy, left out without one) and Billed to: the client's name, address, country and tax ID.
  - A detail that is empty is left out, never printed as a bare label.
  - Billed to never shows the client's email: the token is a bearer link.
  - Then a row of dates: Issued (UTC day), Supply date (R-89), Due date and Payment window closes (`closesAt`).
  - Then the line table: Description, Qty, Unit price and Amount per item (R-88), with the title above it.
  - Without items it has one row: the title (or "Payment") and the amount.
  - The table header repeats on every page it continues on.
  - The last row moves with the totals, so totals never start a page alone.
  - The status panel and the dates say each fact once, so the totals add only Received and Left to pay (R-195).
  - The agreed value (R-93) sits quietly under them, marked as for reference only.
  - Every page's footer names the document, says Test mode when it is, gives Page X of Y and the invoice id.
- Network names and explorers are a copy of `apps/web/src/shared/constants/chains.ts`.
  - A test fails when either copy changes alone.
  - The `chains` table holds only slugs, so it can't be the source of display names.
  - A chain neither copy names prints "Chain <id>", as in the app.
- `invoice.pdf` states the status in the app's status words.
  - Waiting for payment, or Overdue: open with nothing received, and the due date before today's UTC day.
  - Confirming: money before the close is not final yet.
  - Partially paid, with Received and Left to pay.
  - Paid; Canceled, saying who canceled it; Expired, or Expired, partially paid.
  - Dates show only in the dates row: the panel never repeats them.
  - Received counts as the pay page does: booked to the creator, plus money still confirming, or plus held money once closed.
- `invoice.pdf` asks for money only while the pay page would show the address.
  - That is: not paid, canceled or closed, records not in review, and something left to pay.
  - Then it has a box with the pay link `PUBLIC_WEB_URL/pay/<payToken>` and its QR code (drawn as vector modules).
  - The box says the exact amount left, the token, the network with its chain ID and the token contract.
  - A payer-chooses invoice is in USD and lists each accepted token with its networks instead (R-70).
  - Paid, canceled and expired invoices have no pay link and no QR code.
- `receipt.pdf`: 409 `invoice_not_paid` until `paymentStatus` is `paid` (it stays paid once settled).
  - It has the paid time beside the issue day and supply date.
  - Payments received lists every transfer on any option, oldest first.
  - Each row has the block time, network and amount received.
  - An Applied column shows only when a transfer wasn't applied whole (R-121, R-195).
  - Then a transfer the ledger hasn't booked reads Pending; held money is applied as 0 (D-26).
  - Under each row are the full tx hash and a "View on <explorer>" link.
  - The totals per option: Received, Applied to this invoice, Held for payer and Returned to payer.
  - They show only beside the Applied column: transfers applied whole need no totals.
  - Received is payable + held + settled + refunded, as Payments counts it; Returned to payer is the ledger's `refunded`.
  - The latest return's transaction follows them.
  - It ends with the pay link and its QR code, since a PDF can be edited.
  - It says nothing about the settlement, the creator's business (R-61).
  - The paid time is the block time of the last deposit the ledger booked to `recipient_payable`: the one that
    completed the amount.
- The same data gives the same bytes (creation date = created or paid time, sorted catalog), so the `ETag` is a hash of
  the file.
  - `invoice.pdf` also changes when its due date passes, since it then says Overdue.
  - `Cache-Control: private, no-cache`: a client revalidates and gets 304 while the file is unchanged.
  - Settling leaves the receipt unchanged; a later transfer or return adds to it.
  - `Content-Disposition: attachment; filename="forwend-INV-0001-invoice.pdf"` (or `-receipt.pdf`).

## Jobs

R-100, D-81; the full schema is in openapi.yaml. A job is a quote with a payment schedule; each payment becomes an invoice.

- `POST /v1/profiles/{profileId}/jobs` needs an Idempotency-Key, like invoice create.
  - Body: `title` (≤ 200), optional `scope` (≤ 5000, with line breaks), `client` and 1 to 10 `payments`.
  - `client` follows a saved client's rules (R-86), and needs `name` and `email`: payments are billed there.
  - Each payment has a `title` (≤ 100), `amountUsd` (at least 1.00, at most 2 decimals) and `dueDays` (0 to 90).
  - Only the first may have `onAccept: true`: the deposit. The total is the sum.
  - The same body again replays (200); amounts compare in cents. Other values under the key are 409.
  - It copies the billing details as `issuer`, so no billing details is 409 `billing_details_required`.
  - The job gets a random 32-byte link token. A profile has at most 1000 jobs.
- `GET /v1/profiles/{profileId}/jobs` lists them newest first, with the total and how many payments are paid.
  - It reads one page: `limit` (1–100, default 50) and `cursor`, and `nextCursor` continues it.
  - `q` matches the title or the client's name in any letter case.
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
  - An incoming transfer under 0.10 USD is left out, unless it is a settlement or comes from another of the user's
    profiles (R-38). The CSV export keeps every transfer.
- Records (R-108): each transaction adds `usdValue` and `classification`, and `invoice` for an invoice payment.
  - `usdValue` is the amount at 1 USD per USD stablecoin (D-75, D-82), with every decimal of the token.
  - `invoice` and document-free `payment` require exact booked settlement evidence, including chain, token, transaction and transfer log.
  - `payment` references the source payment ID, purpose and document kind; billing documents retain `invoice` details.
  - Policy exceptions or unresolved attribution produce `payment_exception`, requiring review or a manual label.
  - A refund sent to the merchant wallet does not become invoice income.
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
  - Then the classification, invoice number and client; `Payment ID` follows any optional currency columns.
  - A cell starting like a formula gets a leading apostrophe.
  - So does a formula start right after a `;`, also after quotes: a spreadsheet set for a `;` list separator (de-DE,
    fr-FR) starts a cell there.
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
  balance is the wallet balance `/balances` reads at the selected RPC's finalized block. An earlier balance undoes the
  final transfers after it (not reorged, at or below that block); `received` and `sent` sum them per day, today's
  without an end. The database sums them per token and day, so dust doesn't make the read grow (R-118).
  The USD fields count 1 USD per token; the app values the token arrays at market prices instead (R-178). A missing wallet balance makes that token's arrays and every USD total null. Money moved without a
  token `Transfer` log (Arc native-coin sends, fees paid in the token) is not undone; a balance below 0 shows 0.

- `GET /v1/profiles/{profileId}/balances` splits each token's `pending` into exact parts (D-114).
  - `settling`: owed to the creator on paid payments, waiting for the wallet transfer.
  - `confirming`: deposits not booked yet, and full payments waiting for the finalized balance check.
  - `partial`: owed to the creator on partly paid payments; held for the payer if the checkout closes first.
  - `held` stays apart: it is the payer's money.
  - Each token has its chain's `livemode`; so does each balance-history token.

## Sends and transfers

A send moves a token out of a profile wallet (R-211, R-212, D-119). The schema is in openapi.yaml.

- Only the owner sends: `money.move` belongs to no role and no key (D-61).
- The browser signs with Privy; the server never signs for a user wallet (D-46).
- `POST /v1/profiles/{profileId}/sends` checks a send for the review. It needs no fresh sign-in: nothing moves yet.
  - `to` is an outside address; `toProfileId` is another of the owner's profiles. The server finds that wallet itself.
  - A pasted address of another of the owner's profiles counts as a transfer.
  - It refuses an invalid checksum, the zero address, any token contract and the sender's own wallet.
  - It reads the wallet's balance and dry-runs the token transfer from the wallet at the latest block.
  - A token revert is `transfer_refused`; a chain that can't be read is 503 `network_unavailable`.
  - Warnings: `contract` (the recipient has code that isn't an EIP-7702 delegation) and `newRecipient`.
  - `networkFee` is the most the wallet pays. Where `gas_sponsored`, it is 0, paid by Forwend.
  - Elsewhere only a `native_gas` token offers Send (Arc's USDC, R-216); the wallet pays its gas from that token.
    - The server estimates the gas and a fifth more, at the fee cap of `settlement.Fees` (R-189).
    - Amount plus fee must fit the wallet's gas-coin balance.
    - `gas` gives the limit and fee caps the browser signs with, so the fee never exceeds `networkFee`.
  - `GET .../sends/fee?chainId=&token=&to=` is that fee now, for the amount step's fee and Max.
    - It prices every amount byte as non-zero, so it covers a send of any amount, Max too.
- `POST .../sends/{sendId}/approve` needs a fresh sign-in (D-49) and answers with the send, as the GET reads it.
  - The browser asks it after the owner holds Send, and signs only a send still `prepared`.
- One unsigned send per wallet and chain: a new prepare cancels it. A signed one still on its way gives 409
  `send_in_progress`.
- `GET .../sends` lists the signed sends the watcher hasn't recorded yet (R-215). It needs `money.read`.
  - The money lists show them first, until the transfer's own row takes their place.
- `POST .../sends/{sendId}/submit` takes the hash Privy returned. `POST .../cancel` gives up an unsigned send.
- `GET .../sends/{sendId}` brings the status up to date on each read:
  - `sending` until the watcher records a wallet transfer that matches hash, wallet, token, recipient and amount.
  - `sent` once it does: the transfer is in a block. `final` once that transfer is confirmed and can't change.
  - A reorged transfer goes back to `sending`; it is `sent` again when the transaction is mined again.
  - `failed` `reverted`: the receipt has no such transfer. `failed` `dropped`: no receipt 30 minutes after submit.
  - `expired`: never submitted within 10 minutes. Nothing is ever sent again on its own.
- A submit takes its hash in any state but `sent` and `failed`, so a signed send is never lost. A hash belongs to one send.

## Idempotency

- Every `POST` that creates something or moves money needs an `Idempotency-Key` header. Exceptions: `POST /v1/me`
  (signup) and `POST /v1/me/onboarding` happen once per user, so the user's token is the key.
- `POST /v1/profiles/{profileId}/sends` takes no key: it moves nothing, and a new prepare replaces the wallet's unsigned
  send. Money moves only when the browser signs, and each hash is kept once.
- `POST /v1/jobs/{token}/accept` is public and takes no key: a job is accepted once, and its deposit has the key
  `job:<jobId>:1`.
- First call: 201. Same key and body again: 200 with the same resource. Same key, other body: 409.
- Keys are unique per profile (per user for `POST /v1/profiles`), 1–255 bytes of UTF-8; a missing or longer key is 400. The server stores a SHA-256 of the
  normalized values, never the body, so field order, spacing and address letter case don't matter. A request that
  fails validation stores nothing. Two requests with one key at once get one resource.

## Auth

- `Authorization: Bearer <Privy access token>`, checked by middleware on every route not marked `security: []`.
- Every signed-in route refuses a token issued before the user's `sessions_revoked_at` with 401 (R-137).
  - `POST /v1/me/sign-out-everywhere` freezes and unfreezes the user at Privy, then sets it to now.
  - Privy goes first: when the freeze fails, the cutoff is not set and the answer is 500.
  - The unfreeze is always sent, as a failed freeze may still have landed and a frozen user can't sign in.
  - Once the freeze worked, the cutoff is set even if the unfreeze failed. A disconnect stops neither.
- `mid.RequireFreshSignIn` (the `FreshSignIn` guard) protects the changes D-63 names.
  - They are giving a role, making or rolling an API key, saving a webhook endpoint, and revealing or rotating its secret.
  - It passes when its Privy session (`sid`) confirmed Forwend's code in the last 15 minutes (D-49).
  - Or when it is at most 15 minutes old (`auth.FreshWindow`) and its `iat` equals the `latest_verified_at` of the
    user's email or passkey account, read from Privy then.
  - Otherwise 401 `reauth_required`; when Privy can't answer, 500, and nothing runs.
- Confirm it's you (R-137): Privy keeps the session and the sign-in time when someone signs in again while signed in.
  - So the web asks `POST /v1/me/fresh-sign-in`: the api emails a 6-digit code to the login email at once.
  - One per session per 30 s (429 `code_sent_recently`: the code sent is still the one to enter).
  - 10 never confirmed per user per hour (429 `too_many_codes`). Both give Retry-After.
    - A confirmed code proves the inbox is the owner's, so it doesn't count: guessing and flooding stay capped.
  - `API_CODES_PER_HOUR` raises the 10. Only the live e2e sets it (1000): its one account confirms on every run (D-85).
  - No login email: 409 `no_login_email`.
  - A send locks the user's row, so requests at once send one email.
  - A code whose email fails is dropped: it counts toward neither limit.
  - The code is stored hashed with its row id, lasts 10 minutes and allows 5 tries.
  - `POST /v1/me/fresh-sign-in/verify` with the code: 204 confirms that session; else 422 `wrong_code`.
    - A value that isn't 6 digits uses no try.
  - Without an email key the api sends nothing (503 `code_unavailable`): a full sign-in is the only proof then.
- A secret API key (R-144) goes in the same header: `Authorization: Bearer fw_test_…`.
  - It works only on its profile's routes whose permission is in its scopes, and only for its store's invoices.
  - It never passes a `FreshSignIn` route (403), and `/v1/me` and the other routes for a person answer 401.
  - An unknown, revoked or expired key is 401 `invalid_api_key`; each key has its own rate limit, as a user has.
- Public routes (checkout reads) are marked `security: []` in the spec. `/healthz` is also public and uses its own status response. No other route is public by default.
- Profile-scoped routes let in the profile's owner and its members (R-138), and give anyone else 403.
  - An unknown or malformed profile ID is 403 too, so callers can't probe which profiles exist.
  - Each route asks for one permission from the map in `internal/auth/access.go`, never a role name (D-93).
  - A member whose role lacks the permission gets 403. The owner has every permission.
  - Developer and Finance members reach only their assigned stores for the invoice and store permissions.
  - Their store and invoice lists, events and Owed leave the other stores out.
  - Another store's invoice is 404 `invoice_not_found`, and another store is 404 `store_not_found`.
  - Their create takes their first store by default; another store, or none to take, is 422.
  - A Revise of another store's invoice is 404 `invoice_not_found`.
  - A member without `tokens.write` who changes a store's `tokensOff` gets 403.
  - `GET /v1/me` lists the user's own profiles, then the ones they are a member of, each with `role`.
  - Each profile also lists its `permissions`, so the app shows only what the role can use.
- `internal/auth` verifies the token locally: ES256 only, issuer `privy.io`, audience = app ID, `exp` required,
  `sub` = the user's Privy DID, and a `sid` with no `linked_accounts`: Privy signs identity tokens for the app too,
  and they must not work as bearer tokens. The key is the one named by the token's `kid` among those published at
  `PRIVY_JWKS_URL` (Privy publishes more than one), loaded at startup (R-29). An unknown `kid` fetches the keys again at
  most once a minute; a known one makes no network call while the list is younger than an hour. An older list is
  fetched again first, so a key Privy withdrew stops verifying (R-30); if Privy is unreachable, the last list verifies for
  10 more minutes (`KeyGrace`), then nothing does. `PRIVY_JWKS_URL` must be https. The Privy Go SDK (D-12) has no local token check, so this
  uses `golang-jwt/jwt/v5` as in Privy's Go guide (https://docs.privy.io/authentication/user-authentication/access-tokens).
- `mid.RequireUser` (or `mid.RequireKey` for a key) and `mid.RequireAccess` wrap the protected handlers, through `mid.Guards` (`SignedIn`,
  `Can`, `FreshSignIn`) that each module's `routes.go` applies. `/v1/me` and `POST /v1/profiles` act
  only for the token's user. Every `{profileId}` route is listed in `profileRoutes` in `internal/httpapi/tests/profiles_test.go`, which checks
  that another user gets 403 on each.

## Errors

- One shape: `{ "error": { "code": "invoice_not_found", "message": "…" } }`. Codes are snake_case and listed in the spec.
- 400 malformed, 401 no or bad token, 403 not yours, 404 missing, 409 conflict, 422 invalid value, 429 too many
  requests, 503 a network the worker has not scanned yet (`network_not_ready` on invoice create, `network_unavailable` when a recheck cannot read it), 500 anything else.
  A profile has at most 1,000 invoices open for payment at once and creates at most 500 a day: 422 above.
  Invoices payers make on its payment links have the same limits, counted apart, so link traffic never blocks the owner (R-188).
- A 500 never shows internal details. `httpio.WriteError` maps sentinel errors to codes in one place.

## Rate limits

`internal/httpapi/mid/ratelimit.go`, constants there (Check status's in `invoiceapi/routes.go`). Each caller has a token bucket: a request takes a token, tokens
come back at a fixed rate up to the burst size. An empty bucket answers 429 `rate_limited` with `Retry-After` in whole
seconds (when the next token is back) and runs nothing else.

- Routes that need a token: per Privy user or per API key, after it is checked; 2 requests a second, 60 at once.
  - `API_USER_BURST` raises the 60. Only the live e2e sets it (1000): all its tests sign in as one user (D-85).
- `POST /v1/invoices/{payToken}/recheck` (Check status, R-55) reads a chain RPC, so it is limited in the api: one
  check per invoice every 5 minutes (the invoice read gives `nextCheckAt`, so a reloaded page still waits), kept in Postgres so every replica agrees (`invoice_rechecks.checked_at`), and a
  per-process bucket of 1 a second, 10 at once, for everyone together. Each owner's invoices (one user, all profiles)
  take from the owner's own bucket first, 3 at once, then one every 5 s, so one account can't empty the shared one. Both answer 429 with `Retry-After`. A chain that
  can't be read answers 503 `network_unavailable`. Until an option has money it checks every option's address (the
  payer may have paid any); the answer is an option holding more than recorded, else the shown one. An option whose
  network does not answer is listed in `unreadable` and the others are still checked. When the shown option can't be
  read and no other holds unrecorded money, it is 503: another option's empty read never answers for it. A rescan is asked only when the address holds more than is
  recorded and no rescan finished in the last 10 minutes, so money no log explains doesn't start a
  full rescan on every press.
- `POST /v1/invoices/{payToken}/views` (R-125): per link, 5 at once, then one every 5 s. It slows a run-up of one link's
  count; it can't stop one.
- `POST /v1/links/{slug}/visits` (R-142): per link, 5 at once, then one every 5 s.
- `POST /v1/links/{slug}/pay` makes a checkout, so it has limits in `linkapi/routes.go` (R-142).
  - Per link: 5 at once, then one every 10 s.
  - For all links together: 20 at once, then one a second, spent only by a Pay that makes an invoice (R-117).
  - It is asked just before the insert, so any Pay that makes no invoice spends none, a repeated key included.
- `POST /v1/jobs/{token}/accept` makes an invoice, so it has limits in `jobapi/routes.go`. Accepting a change has its
  own per-link limit and shares the one for everyone.
  - Per link: 3 at once, then one every 10 s.
  - For everyone together: 20 at once, then 5 a second, spent only by an accept that changes a job (R-117).
  - A bad body, an unknown link or a job already accepted answers before it.
- The other public routes (`GET /v1/invoices/{payToken}`, its `/embed` check, `GET /v1/jobs/{token}`, `GET /v1/links/{slug}`, both PDFs and `POST /v1/reminders/{token}/stop`) have no limit in the api. Next's `/api` rewrite adds
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
