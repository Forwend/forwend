# Backend money safety

Rules that protect the contracts. Read before touching invoices, the watcher, the signer or checkout.

## Receive address

- Compute it locally (`internal/address`) from the factory and implementation addresses compiled into the binary. The
  init-code hash differs per invoice: the clone's init code contains the terms. Never read it from the database or an RPC.
  - New invoices use the newest factory. An invoice keeps the factory it was made with.
  - `address.Known` lists every factory an invoice may still use, with its implementation; the web holds the same list.
  - Each entry says whether its terms carry the fees (v2 on, R-226). Encoding, calls and Safe arguments follow it
    (`address.Encode`, `Call`, `Signature`, `Args`), so no caller writes a terms tuple itself.
  - The canary keeps its own setting, `CANARY_FACTORY_FEES`, and never reads that list (R-51).
  - Settle, returns and stray recovery accept only an invoice's own factory from that list. Drop an old factory from
    it only once none of its invoices can hold money.
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
  - `receive-address-v1.1.json` keeps the v1.1 factory's vectors, without fees, for the invoices that still use it.
- The recipient is the profile wallet read from Privy, never from the request. The contract can't tell a wrong one.
- The recipient wallet must exist on the invoice's chain before the invoice is created.
- Receivers are deployed only when settling, refunding or recovering.

## Receiver movements

- One chain scan reads every watched receive address together (D-116). It has no per-address scan, proof or coverage gate.
  - Money in: the allowlisted token's `Transfer` logs to the address.
  - Money out: the receiver's own `Settled`, `FeesPaid`, `Refunded` and `Recovered` events.
- A deposit or a receiver event counts only at or below the finalized block, with the block hash the RPC returned.
- Each receiver event is recorded once in `receiver_outflows`, with its block, transaction and log.
  - The token `Transfer` before it in the same transaction names the transfer that moved the money.
  - An event recorded without that transfer stays unbooked and is read again while its block is in the rescan window.
    - A later scan or the signer's receipt that finds the transfer completes the record; nothing else on it changes.
    - Past that window it waits for an operator, as any unbooked outflow does.
  - `FeesPaid` is one outflow per fee above 0 (R-230): the network fee to the settler, the platform fee to the refund authority.
    - The refund authority is in the factory's init code, so the backend knows it per factory (`address.Known`).
    - The fee transfers are settle's own, after its transfer to the recipient and before `Settled`, in that order.
    - So they are found once `Settled`'s transfer is.
  - Activity uses that transfer to link a settlement to the profile wallet's incoming transfer.
  - A receiver event first records the receiver's deploy time; an early deploy can shorten the checkout close (R-130).
- The signer records its own settle from its finalized receipt, so `settled` never waits for the scan.
- Recovery sweeps read every block again later, so a log one RPC answer missed is still found.
  - Some finalized blocks may be kept by no RPC any more (R-191).
    - Arc's PublicNode and Blockdaemon nodes served logs 13 hours old but not 47 hours old (measured 2026-10-30).
    - thirdweb on Arc (migration 94) served logs 170 hours old. Ranges skipped earlier can now be read again.
  - Only when every endpoint serving the chain answers that it lacks them does the sweep move on, to the oldest kept block.
    - It logs an `ALERT` with the skipped range. An endpoint that failed or rests may hold them, so the sweep waits then.
  - The fast scan read those blocks once. To read them again, add an endpoint with full history.
    - Then set `chain_recoveries.next_block` and `target_block` together to the skipped range.
  - A Check status rescan moves past such blocks too, instead of retrying every minute.
- Deposits to a receiver are read until 30 days after its settle deadline (R-183).
  - Its own events are read longer, while the ledger shows it still holds booked money.
  - So a late refund-authority settle or refund is still recorded and booked; a late recovery is recorded.
- The signer records a receipt's events only when its block is the canonical one at that height.
- A receiver event that is not a movement of its own invoice logs an `ALERT` and is skipped; the scan goes on.
- A movement found after later ones were booked is refused for review, never booked against today's balances.
- The ledger books deposits and receiver events together, in chain order, against the balances at that point.
  - A movement waits while an earlier deposit is still detected.
  - Refunds take held money first, then payable; settlements and fees take payable first, then held.
  - A settlement must be the amount less the option's fees, and each fee the option's own; else `invalid_terms`.
    - Each fee is booked as its own kind, `network_fee` or `platform_fee`, so the receiver ends at 0.
  - Either exception is recorded as a policy exception and shown to the owner.
  - An event the balances can't cover stays unbooked with its reason, and later movements wait behind it.
  - The ledger tries it again every round, so a late-found earlier deposit lets it book.
- Native or other-asset recoveries are recorded but never booked as accepted-token money.
- Payment reads calculate remaining blocks and estimated chain time against the saved finalized cursor.
- The signer stores successful settlement receipts for progress display, including mined replacement hashes.
  - Missing or reverted receipts clear them; they never decide finality, booking or balances.

## Returns through support

Held money goes back by hand for now (PLAN 11.10.3, D-118). `cmd/ops` holds no key and sends nothing.

- `ops case <pay link | receive address | payment transaction | invoice id>` prints each invoice option:
  - its held money and why it is held, from the ledger and its history;
  - each final payment: transaction, sender, amount and time;
  - the receiver from `factory.status`: deployed, balance, refundable now, and the deadline after which all of it is.
- `ops return -tx <payment> [-to <address>] [-amount <tokens>] <case>` checks a return, locks the money and prints
  the calls.
  - The destination is the payment's sender unless `-to` names another.
  - A destination that made no payment warns: check the payer's proof that it is theirs.
  - A contract destination warns: it may be an exchange, an app or a smart wallet.
  - It refuses the zero address, the receiver, the token, the factory and any invoice's receive address.
  - The amount is at most what is both held and refundable; at least 0.10 USD (D-90). Before the deadline that can be 0.
  - When several addresses paid, the amount must be given.
  - It dry-runs the token transfer from the receiver, and the refund when the receiver is deployed.
    A blocklisted address, a paused token or a short balance fails here, not at the Safe.
  - It sets `refund_status = 'refund_pending'`, then prints the calls: the receiver's deploy when needed, then `refund`.
    `deploy` returns an already deployed receiver, so the batch still works if the signer deployed it first.
- One return is queued per option at a time, so the same money is never sent twice.
- It refuses while the receiver holds less on chain than the ledger books: a sent refund isn't booked yet.
  - Past the deadline of an invoice never settled, the contract lets the whole balance out.
  - Then a second return would take the creator's money.
- It also refuses while a payment or a receiver event of the option is not booked: it could hide that gap.
- Queuing writes `invoice.return_queued` to the invoice's history with the amount and destination; release writes
  `invoice.return_released`. The owner sees them as Return queued and Return released.
- The owner's payment page lists each booked return as a Transfers row and ends its timeline with it.
- While a return is queued:
  - the ledger keeps `refund_pending` until a refund is booked, then shows `held` or `refunded`;
  - reopen is refused, and the owner's attention list keeps the payment;
  - the watcher keeps reading the receiver's events past its window (R-183).
- `ops case <transaction>` also finds money the invoice doesn't take (D-33):
  - another token sent to a receive address on its chain;
  - any token sent to that address on another enabled chain: the address is the same on every chain.
  - It looks only for a transaction no invoice booked, and reads its ERC-20 transfers on every enabled chain.
  - The ledger never books this money. Native coin sent there, Arc's native USDC included, isn't found yet.
  - It skips Arc's system `Transfer` logs from `0xffff…fffe`: they repeat a USDC transfer or stand for a native send.
  - It prints no calls until the transfer's block is finalized, with the same block hash.
    - A reorg could undo the transfer after its recover is printed.
  - It prints the calls only where that chain has our factory and receiver code, and our refund authority.
    - Ours means the same code as on the invoice's chain.
    - A Safe also needs the same singleton, owners, threshold and modules.
  - The calls are the receiver's deploy when needed, then `recover(token, to, amount)` of that transfer's amount.
  - The destination is the transfer's sender unless `-to` names another; the same addresses are refused as for a return.
  - It dry-runs the recover, or the token transfer before deploy, and checks the address still holds the amount.
  - A deploy on the invoice's chain while it can still be paid warns: it starts the hold limit, and Arc then refuses native USDC.
  - Otherwise it says plainly that the money can't be returned now, and why. Support promises nothing.
  - It doesn't find money sent to the factory or the receiver implementation.
    - The Safe returns it with their `recover`, by hand ([operations](../contracts/operations.md#before-signing)).
  - An RPC error, such as a rate limit, stops the command; it never reads as "can't be returned".
  - Printing locks that transfer (`stray_recoveries`), so its recover is printed once.
    - Another transfer's money still there can't be returned to the first sender twice.
    - A rerun says the recover was printed, even after it was sent and the address is empty.
  - `ops release <transaction>` unlocks it once the Safe transaction is rejected and was never executed.
    - First reject or execute every recover queued in the Safe for that receive address: the chain can't see them.
    - The ledger books none of this, so release counts the receiver's `Recovered` logs of that token and amount.
    - Locks of one chain, invoice, token and amount are alike; a recover to any destination counts for them.
    - It counts from the first such transfer ever locked: a released lock stays as a row, so that start never moves.
    - It releases one lock at a time, one release at a time, while fewer recovers are on chain than locks still held.
    - It keeps the rest and says so: their recovers may have been sent.
    - A recover to the lock's own destination since its transfer also keeps it: that one was likely sent.
    - So when the same payer sent the same amount twice, the second lock can stay; support then decides by hand.
    - It reads the logs 2000 blocks at a time, as the watcher does.
  - The balance check sees all of the token at the address, other payers' too: the lock is what stops a second return.
- `ops release <case>` unlocks a queued return the refund authority will not send.
  - Before releasing, reject the Safe transaction and check that it was never executed.
- Held money under 0.10 USD, and money nobody claims, stay in the receiver for good (D-90). Nothing sweeps them.

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
  - Several native sends with sub-micro parts can book less than `balanceOf` shows; paid still holds.
    - Expiry ignores such dust: an excess under `ledger.DustExcess` (0.01 of a 6-decimal token) stays for the Safe.
    - Otherwise anyone could send two sub-micro amounts and keep an invoice open for good.
  - No contract can emit from the system emitter: it has no code.
- When the selected RPC's `balanceOf` holds at least `ledger.DustExcess` more than is booked, the invoice never expires.
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

## Cross-chain payments

D-123: NEAR Intents 1Click converts a payer's token on another chain into USDC on Base.

- The USDC goes to the invoice's own Base option receive address. Paid, settlement and fees work as for a direct payment.
- Each quote is `EXACT_OUTPUT` for exactly what is due, so the invoice is never partly paid or overpaid by it.
  - 1Click returns the unused slippage, any extra and short or failed deposits to the payer's `refundTo`.
  - Forwend holds none of that money.
- Its deadline is at least 10 minutes before the close: what hasn't converted by then is refunded, never late.
- The deposit address can't be recomputed as a receive address can (R-45). Instead, a quote must pass D-124:
  - its ed25519 signature verifies with `intents.ManagerKey`, the key the 1Click SDK pins;
  - its signed request names the Base option's receive address, Base USDC, `EXACT_OUTPUT`, the due amount and `refundTo`;
  - it delivers exactly that amount, has a deposit address and needs no memo.
  - every value is read with exact keys: Go's struct decoding would let a `DepositAddress` key replace `depositAddress`.
  - The request's deadline is not signed in a real quote; 1Click signs the address's own deadline in its place.
    - So the D-125 deadline is 1Click's echo of what was asked. A wrong one can only make money late and held for the
      payer, never send it elsewhere: the recipient is signed.
- The api checks this before it keeps a quote and again before it gives a kept one. The pay page checks it before it
  shows the address. The canary checks each shown quote against 1Click's own record (R-235).
- The worker reads each quote's status from 1Click only to show progress (R-234). Paid still comes from the Base balance.
  - While 1Click converts a deposit, the pick, an edit and a cancel wait as for money seen (`invoice.ConvertingSQL`).
  - It logs an `ALERT` for a failed swap, a seen deposit unfinished an hour past its deadline, and a delivery with no
    Base transfer of its transaction 30 minutes later.
- Test mode has no cross-chain: 1Click has no testnet.

## Money out of a profile wallet

- Privy signs and exports on the user's session alone, so Forwend's Confirm it's you binds only its own screens (D-49).
- With `NEXT_PUBLIC_WALLET_MFA` on, the owner sets up both a passkey and an authenticator app as Privy's MFA before a
  first send or export, so one lost still confirms and removes the other.
  - Privy then requires its code before it signs or shows a key; Forwend only draws the prompt (R-219).
  - Forwend records the methods behind a fresh sign-in. Only recorded ones let a send's approve skip the emailed code.
  - Only the setup records them. Its passkey is the one the owner taps on this device, or makes there.
    - Privy turns on any linked passkey by ID with no tap: every one would take a passkey a stolen session linked.
  - A method a stolen session sets up at Privy alone isn't recorded, so its sends still need the code and still email
    the owner when the money leaves without an approved send.
  - Forwend drops Privy's 15-minute pass after each send.
- The watcher checks every final transfer out of a profile wallet. It emails the owner at once (`wallet.outflow`)
  unless an approved send explains it.
  - That send has the same wallet, token, recipient and amount, and reported this hash or still waits for one.
  - Or its approval ended within the hour before the transfer was recorded, after the approve: it was signed late.
  - Submit takes a hash only for an approved send, so a hash reported on another send can't hide a transfer.
  - An owner with no login email, such as one who signed up with a passkey alone, gets no such email yet.
  - A token approval or permit signed through Privy moves nothing, so nothing is sent until the money leaves.
  - Moving money with an exported key in another wallet app also sends it; the email says that is fine.

## Canary

`cmd/canary` (R-51) checks open invoices' receive addresses apart from the code that makes them. It imports no
address code or constants from the api or `apps/web`: of this repository it builds only `internal/canary` and
`internal/config` and the destination-only `internal/outbound` package (a test fails otherwise), and its browser script `apps/web/scripts/canary-pay-page.ts` reads the
DOM and imports nothing from `src/`. It reads only its own `CANARY_*` variables (names in
`apps/backend/.env.example`): the api and web origins, the factory address, the factory's code hash, two RPCs on
different hosts per chain ID and the script path.

Stdin holds one open invoice or accepted option per line. A line has its terms as the database stores them, then its
token's symbol and its chain's name. Then come the pay link's token of its invoice (D-86), its close (`closes_at`,
later than `expires_at` after a reopen, R-130) and its fees (R-226):
`id chain_id recipient_address token_contract amount expires_at settle_deadline symbol network pay_token closes_at network_fee platform_fee`.
A line whose terms break create's rules is an alert: amount 0, a recipient that is zero or the token, or another settle
window. So are fees over a tenth of the amount, and fees in the terms of a factory whose terms have none
(`CANARY_FACTORY_FEES`). So is a close before expiry or at the settle deadline. A line within 6 minutes of its close is skipped: the
pay page stops showing the address 5 minutes before the close. The canary then:

1. On both RPCs of every configured chain, requires `eth_chainId` to equal the chain ID and the keccak256 of the
   factory's code to equal `CANARY_FACTORY_CODE_HASH`. A receiver's init-code hash differs per invoice (its init
   code holds the terms), so the canary pins the factory's runtime code instead: with its immutables it fixes
   `predict`, the receiver implementation and the refund authority.
2. Reads `GET <api>/v1/invoices/<pay_token>`, requires its `invoiceId` to be keccak256 of the token, and requires the
   listed option with this `id` (its `optionId`, chain, token, amount, fees and address) and the invoice's shared terms and
   `factory` to equal the database's terms and `CANARY_FACTORY`.
3. Calls `predict` with the database's terms on both RPCs and requires both to agree and to equal the api's
   `receiveAddress`.
4. Runs the script once for all ids, with a deadline that grows with their number. It opens
   `<web>/pay/<pay_token>?option=<id>`, which shows that option while none has money and keeps no pick, in
   Chromium as a payer would, presses Show address and reads the send box's text and QR code. The text
   must show that one address, each QR code must draw what `uqr` encodes for it, as `QrCode` in
   `packages/ui-web` does, and the amount panel must name the token's symbol and the chain (`Base Sepolia` for
   `base-sepolia`). A page that shows no address (the invoice is no longer open, or the page refused the
   terms) is an alert too.

5. A `quote <option id> <deposit address> <amount out>` line is a cross-chain quote the pay page may show (R-235).
   - Once the option's own line passed, the canary reads 1Click's status of the address (`CANARY_ONECLICK_URL`).
   - It verifies the signed quote there with its own copy of 1Click's key (`CANARY_ONECLICK_KEY`) and its own code.
   - The quote must pay exactly the amount, as USDC on Base, to the address the factory predicts, with no memo.

Any difference or failed read logs `canary alert` with the problem and exits 1; otherwise `canary passed`, exit 0.
Empty stdin is an alert as well, because it usually means the query failed; pass `-allow-empty` only for a one-off
run by hand. Run it on its own host with Node, `pnpm install` and `pnpm --filter @forwend/web exec playwright install
chromium`, from cron or a scheduler. Page on a non-zero exit, and also when a scheduled run is missed (a dead-man
check on the last `canary passed`):

```sh
{ psql "$READONLY_DATABASE_URL" -At -F ' ' -c "SELECT i.id, i.chain_id, i.recipient_address, i.token_contract,
  i.amount, i.expires_at, i.settle_deadline, t.symbol, c.name, m.pay_token, i.closes_at, i.network_fee, i.platform_fee
  FROM invoices i
  JOIN invoices m ON m.id = coalesce(i.main_id, i.id)
  JOIN tokens t ON t.chain_id = i.chain_id AND t.contract = i.token_contract JOIN chains c ON c.chain_id = i.chain_id
  WHERE i.payment_status IN ('open', 'partially_paid') AND i.closes_at > extract(epoch FROM now()) + 60
    AND (m.chosen_id IS NULL OR m.chosen_id = i.id) AND m.pay_token IS NOT NULL
    AND i.factory_address = lower('$CANARY_FACTORY')"
  psql "$READONLY_DATABASE_URL" -At -F ' ' -c "SELECT 'quote', option_id, deposit_address, amount_out
  FROM crosschain_quotes WHERE status = 'PENDING_DEPOSIT' AND shown_until > now()"; } |
  pnpm --silent --filter @forwend/backend canary
```

The terms come from stdin, not a database connection, so the canary holds no database credentials; a read-only role
lists them. An invoice made before D-86 has no pay token and no pay page, so the query leaves it out. `detected` invoices are left out: a deposit that may cover the amount is on its way, and the page then
stops showing the address. So are the other options of an invoice whose option was chosen: the page no longer shows
them. An invoice paid between the query and the page read alerts once; the next run passes.

Limits:

- The canary trusts the database's terms. A wrong recipient written when the invoice was made is not caught; that
  needs the profile wallet read from Privy, which the canary does not hold.
- It checks only invoices of `CANARY_FACTORY`, so the query leaves out those of an older factory.
  - Those keep paying and settling through their own factory, and are not checked until they close.
- It catches tampering and drift that do not hide from it. A bundle written to evade it (spotting the headless
  browser, or drawing another QR over the checked one) is not caught.

## Accepted risks

- One provider can establish payment and settlement evidence. A dishonest provider can defeat checks that depend on its chain data.
- Extra endpoints provide failover; operational payments do not require agreement between independent providers.
- The selected provider supplies gas-price suggestions; no independent provider checks its suggested tip.
  - A per-chain ceiling per gas unit bounds what a wrong or lying suggestion can cost (R-189).
- The executor's gas swap takes USDC at 1 USD and trusts Chainlink's ETH/USD feed for its floor (R-229).
  - A price older than its feed's heartbeat plus 10 minutes sends no swap.
  - Nor does one read while the L2 sequencer is down, or back for under an hour.
  - Within that window, a feed lagging a falling ether price loosens the floor by the lag.
  - One swap buys at most 40 deploys and settles' gas at the fee ceiling: about 30 USD on Base or Arbitrum.

- The executor can settle money the backend would hold (late, cancelled) before the deadline. It still goes only to
  the recipient.
- Testnet invoices are never shown to real payers: the testnet refund key could `recover` real money at the same
  address on mainnet.
- A payer-chooses invoice picks its option as soon as that option's final payments add up to 1.00 USD (R-119); no
  other chain is waited for.
  - A smaller deposit chooses nothing, so a stranger with the pay link can't decide the option with dust.
  - It is held for the payer; on the chosen option, so is a payment before the one that brought it to 1.00 USD.
  - On-time dust on an open invoice is not announced to the owner; late money and money after a cancel always is.
  - Dust never makes the invoice confirming or partly paid, and never stops the owner canceling or editing it.
  - Before a choice the invoice closes only once every option chain was read past its close.
  - A chain whose scan stops (its RPCs down) holds that close, and the R-120 alert waits with it.
  - Disabling that chain lets the close go on.

## Reusable-link capacity

- Paid purchases consume slots; canonical open, detected and partly paid purchases reserve slots.
- Expiry releases unused slots only after ledger reconciliation; late held deposits do not count as sales.
- Creation and legacy reopening lock the link before reading fresh capacity in a separate READ COMMITTED statement.
- Profile coordination uses `FOR NO KEY UPDATE` in creation, link saves and invoice sending.
- This serializes merchant operations while permitting event foreign-key checks under invoice and link locks.
- Strong profile locks would form a cycle: create waits for link; reopen holds link and records an event referencing profile.
- [PostgreSQL row lock compatibility](https://www.postgresql.org/docs/current/explicit-locking.html#LOCKING-ROWS) explains the compatible key-share lock.
