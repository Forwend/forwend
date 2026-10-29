# Backend money safety

Rules that protect the contracts. Read before touching invoices, the watcher, the signer or checkout.

## Receive address

- Compute it locally (`internal/address`) from the factory and implementation addresses compiled into the binary. The
  init-code hash differs per invoice: the clone's init code contains the terms. Never read it from the database or an RPC.
- `(chain_id, receive_address)` is unique. The signer refuses to settle when the stored terms do not recompute the
  receive address or `factory.predict` gives another one (`internal/settlement/settle.go`); the canary checks open
  invoices ([Canary](#canary)).
- Before showing an address, run the same term checks as `settle`, plus expiry ≤ 365 days and the settle window.
  - The settle deadline is expiry + 7 days, or + 24 h for invoices made before this window (D-18).
  - The contract accepts any terms, so these checks live only here.
- Reopen (R-130) gives money held for the payer back to the creator. Only for an option that closed partly paid.
  - Once per invoice, a day or more before its receiver's settle deadline, so a payment at the new close still settles.
  - A receiver deployed early, by a recovery, settles only until 30 days after its deploy (`MAX_HOLD`).
  - The chain's scan reads the deploy time when a receiver first emits an event; a known deploy time never moves back to zero.
  - An early deployment shortens operational `closesAt` to one day before settlement ends. Signed terms remain unchanged.
  - The canary independently verifies a shortened close against both providers' finalized deployment state.
  - Not while a refund is under way: that money goes back to the payer.
  - The database allows the status back only with `reopened_until`, once.
  - It allows reopen rows only between the first expiry and a second.
- Go address code and `predict` share test vectors: `packages/contracts/vectors/receive-address.json`, written by
  `pnpm vectors` in `packages/contracts`. `forge test` fails while the file is stale.
- The recipient is the profile wallet read from Privy, never from the request. The contract can't tell a wrong one.
- The recipient wallet must exist on the invoice's chain before the invoice is created.
- Receivers are deployed only when settling, refunding or recovering.

## Receiver movements

- One chain scan reads every watched receive address together (D-116). It has no per-address scan, proof or coverage gate.
  - Money in: the allowlisted token's `Transfer` logs to the address.
  - Money out: the receiver's own `Settled`, `Refunded` and `Recovered` events.
- A deposit or a receiver event counts only at or below the finalized block, with the block hash the RPC returned.
- Each receiver event is recorded once in `receiver_outflows`, with its block, transaction and log.
  - The token `Transfer` before it in the same transaction names the transfer that moved the money.
  - Activity uses that transfer to link a settlement to the profile wallet's incoming transfer.
  - A receiver event first records the receiver's deploy time; an early deploy can shorten the checkout close (R-130).
- The signer records its own settle from its finalized receipt, so `settled` never waits for the scan.
- Recovery sweeps read every block again later, so a log one RPC answer missed is still found.
- Deposits to a receiver are read until 30 days after its settle deadline (R-183).
  - Its own events are read longer, while the ledger shows it still holds booked money.
  - So a late refund-authority settle or refund is still recorded and booked; a late recovery is recorded.
- The signer records a receipt's events only when its block is the canonical one at that height.
- A receiver event that is not a movement of its own invoice logs an `ALERT` and is skipped; the scan goes on.
- A movement found after later ones were booked is refused for review, never booked against today's balances.
- The ledger books deposits and receiver events together, in chain order, against the balances at that point.
  - A movement waits while an earlier deposit is still detected.
  - Refunds take held money first, then payable; settlements take payable first, then held.
  - Either exception is recorded as a policy exception and shown to the owner.
  - An event the balances can't cover stays unbooked with its reason, and later movements wait behind it.
  - The ledger tries it again every round, so a late-found earlier deposit lets it book.
- Native or other-asset recoveries are recorded but never booked as accepted-token money.
- Payment reads calculate remaining blocks and estimated chain time against the saved finalized cursor.
- The signer stores successful settlement receipts for progress display, including mined replacement hashes.
  - Missing or reverted receipts clear them; they never decide finality, booking or balances.
- Refund claims and execution controls remain in PLAN 11.10.

## Deciding "paid"

- Only `balanceOf` of the allowlisted token (chain ID + address) on an address we computed.
- Ignore logs from every other address: anyone can deploy a look-alike token or clone that emits the same events.
- The selected RPC provides finalized balances before "paid" or a webhook, and finalized receiver state before "settled".
- Arc: checkout builds an ERC-20 `transfer` on `0x3600…`, but a payer may send USDC as the native coin (R-186).
  - Every Arc USDC movement logs `Transfer` from the system emitter `0xffff…fffe` in 18 decimals; a native send logs only that.
  - The scan reads both. A system log with a `0x3600` twin one or two logs later (same from, to, amount) is the same transfer.
  - Each `0x3600` log takes at most one twin, so every transfer counts once.
  - A system log without a twin is a native send: it counts as `0x3600` money, floored to 6 decimals.
  - Under one micro-USDC is no deposit: `balanceOf` truncates it too.
  - Several native sends with sub-micro parts can book less than `balanceOf` shows; paid still holds, and expiry alerts.
  - No contract can emit from the system emitter: it has no code.
- When the selected RPC's `balanceOf` holds more than is booked, the invoice never expires.
  - The worker logs `ALERT receive address holds money with no booked transfer`.
  - An operator checks the chain and refunds the money with the refund authority.
  - The worker reads that balance again after 1 min, doubling to at most a day (`invoice_balance_alerts`, R-120).
  - So many such invoices can't use up a chain's round; a new deposit to book ends the wait.
  - After an operator refunds the money, the invoice expires at its next check, up to a day later. Deleting its
    `invoice_balance_alerts` row makes the worker check it in the next round.
- Less on chain than booked at expiry logs `ALERT receive address holds less than booked; not expiring`, with the same backoff.
- Deposits are booked in chain order: one waits while an earlier one is still detected, so the earliest payers are
  paid to the creator first and later ones held (D-27). An empty `balanceOf` answer is an error, never 0.
- Before signing a new settle, the signer reads the finalized balance of the receive address.
  - Less than the ledger's booked receiver balance means money left unbooked; it signs nothing and logs an `ALERT`.
- A deposit is received when seen and paid only at or below the chain's `finalized` block (D-45); show blocks and
  time left until then (`internal/finality`). Read headers, logs and receipts only, and compare block hashes the RPC
  returns: go-ethereum can't decode Base, Arbitrum and Tempo system transactions, and its `Header.Hash()` is wrong on
  Tempo (local S-4 notes (`../spikes/s4-chains.md`)).

## Checkout

- The page shows an address only for the invoice its link names: the invoice id must be keccak256 of the link's token
  (`address.InvoiceID`, D-86). For a payer-chooses invoice's further option, only when the option's id is
  `keccak256(abi.encode(invoice id, chain id, token))`, as `address.OptionID` makes it, so no other invoice's terms
  pass under the link.
  - Only for terms the API would create: amount above 0, the settle window above, and expiry at most a year after
    creation.
  - The recipient is not zero, the token, the factory or the implementation.
  - The terms must compute to the address.
- No third-party scripts; pinned dependencies.

## Canary

`cmd/canary` (R-51) checks open invoices' receive addresses apart from the code that makes them. It imports no
address code or constants from the api or `apps/web`: of this repository it builds only `internal/canary` and
`internal/config` and the destination-only `internal/outbound` package (a test fails otherwise), and its browser script `apps/web/scripts/canary-pay-page.ts` reads the
DOM and imports nothing from `src/`. It reads only its own `CANARY_*` variables (names in
`apps/backend/.env.example`): the api and web origins, the factory address, the factory's code hash, two RPCs on
different hosts per chain ID and the script path.

Stdin holds one open invoice or accepted option per line. A line has its terms as the database stores them, then its
token's symbol and its chain's name. Then come the pay link's token of its invoice (D-86) and its close (`closes_at`,
later than `expires_at` after a reopen, R-130):
`id chain_id recipient_address token_contract amount expires_at settle_deadline symbol network pay_token closes_at`.
A line whose terms break create's rules is an alert: amount 0, a recipient that is zero or the token, or another settle
window. So is a close before expiry or at the settle deadline. A line within 6 minutes of its close is skipped: the
pay page stops showing the address 5 minutes before the close. The canary then:

1. On both RPCs of every configured chain, requires `eth_chainId` to equal the chain ID and the keccak256 of the
   factory's code to equal `CANARY_FACTORY_CODE_HASH`. A receiver's init-code hash differs per invoice (its init
   code holds the terms), so the canary pins the factory's runtime code instead: with its immutables it fixes
   `predict`, the receiver implementation and the refund authority.
2. Reads `GET <api>/v1/invoices/<pay_token>`, requires its `invoiceId` to be keccak256 of the token, and requires the
   listed option with this `id` (its `optionId`, chain, token, amount and address) and the invoice's shared terms and
   `factory` to equal the database's terms and `CANARY_FACTORY`.
3. Calls `predict` with the database's terms on both RPCs and requires both to agree and to equal the api's
   `receiveAddress`.
4. Runs the script once for all ids, with a deadline that grows with their number. It opens
   `<web>/pay/<pay_token>?option=<id>`, which shows that option while none has money, in
   Chromium as a payer would, presses Show address and reads the send box's text and QR code. The text
   must show that one address, each QR code must draw what `uqr` encodes for it, as `QrCode` in
   `packages/ui-web` does, and the amount panel must name the token's symbol and the chain (`Base Sepolia` for
   `base-sepolia`). A page that shows no address (the invoice is no longer open, or the page refused the
   terms) is an alert too.

Any difference or failed read logs `canary alert` with the problem and exits 1; otherwise `canary passed`, exit 0.
Empty stdin is an alert as well, because it usually means the query failed; pass `-allow-empty` only for a one-off
run by hand. Run it on its own host with Node, `pnpm install` and `pnpm --filter @forwend/web exec playwright install
chromium`, from cron or a scheduler. Page on a non-zero exit, and also when a scheduled run is missed (a dead-man
check on the last `canary passed`):

```sh
psql "$READONLY_DATABASE_URL" -At -F ' ' -c "SELECT i.id, i.chain_id, i.recipient_address, i.token_contract,
  i.amount, i.expires_at, i.settle_deadline, t.symbol, c.name, m.pay_token, i.closes_at FROM invoices i
  JOIN invoices m ON m.id = coalesce(i.main_id, i.id)
  JOIN tokens t ON t.chain_id = i.chain_id AND t.contract = i.token_contract JOIN chains c ON c.chain_id = i.chain_id
  WHERE i.payment_status IN ('open', 'partially_paid') AND i.closes_at > extract(epoch FROM now()) + 60
    AND (m.chosen_id IS NULL OR m.chosen_id = i.id) AND m.pay_token IS NOT NULL" |
  pnpm --silent --filter @forwend/backend canary
```

The terms come from stdin, not a database connection, so the canary holds no database credentials; a read-only role
lists them. An invoice made before D-86 has no pay token and no pay page, so the query leaves it out. `detected` invoices are left out: a deposit that may cover the amount is on its way, and the page then
stops showing the address. So are the other options of an invoice whose option was chosen: the page no longer shows
them. An invoice paid between the query and the page read alerts once; the next run passes.

Limits:

- The canary trusts the database's terms. A wrong recipient written when the invoice was made is not caught; that
  needs the profile wallet read from Privy, which the canary does not hold.
- It catches tampering and drift that do not hide from it. A bundle written to evade it (spotting the headless
  browser, or drawing another QR over the checked one) is not caught.

## Accepted risks

- One provider can establish payment and settlement evidence. A dishonest provider can defeat checks that depend on its chain data.
- Extra endpoints provide failover; operational payments do not require agreement between independent providers.
- The selected provider supplies gas-price suggestions; an independent provider no longer limits its suggested tip.

- The executor can settle money the backend would hold (late, cancelled) before the deadline. It still goes only to
  the recipient.
- Testnet invoices are never shown to real payers: the testnet refund key could `recover` real money at the same
  address on mainnet.
- A payer-chooses invoice picks its option only once every other enabled option chain was read past the payment
  (R-119). Before a choice it closes only once they were read past its close. A chain whose scan stops (its RPCs
  down) holds both, and the R-120 alert waits with them; disabling the chain lets them go on.

## Reusable-link capacity

- Paid purchases consume slots; canonical open, detected and partly paid purchases reserve slots.
- Expiry releases unused slots only after ledger reconciliation; late held deposits do not count as sales.
- Creation and legacy reopening lock the link before reading fresh capacity in a separate READ COMMITTED statement.
- Profile coordination uses `FOR NO KEY UPDATE` in creation, link saves and invoice sending.
- This serializes merchant operations while permitting event foreign-key checks under invoice and link locks.
- Strong profile locks would form a cycle: create waits for link; reopen holds link and records an event referencing profile.
- [PostgreSQL row lock compatibility](https://www.postgresql.org/docs/current/explicit-locking.html#LOCKING-ROWS) explains the compatible key-share lock.
