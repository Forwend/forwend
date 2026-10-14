# Backend money safety

Rules that protect the contracts. Read before touching invoices, the watcher, the signer or checkout.

## Receive address

- Compute it locally (`internal/address`) from the factory and implementation addresses compiled into the binary. The
  init-code hash differs per invoice: the clone's init code contains the terms. Never read it from the database or an RPC.
- `(chain_id, receive_address)` is unique. The signer refuses to settle when the stored terms do not recompute the
  receive address or `factory.predict` gives another one (`internal/settlement/settle.go`); the canary checks open
  invoices ([Canary](#canary)).
- Before showing an address, run the same term checks as `settle`, plus expiry ≤ 365 days and settle deadline =
  expiry + 24 h. The contract accepts any terms, so these checks live only here.
- Go address code and `predict` share test vectors: `packages/contracts/vectors/receive-address.json`, written by
  `pnpm vectors` in `packages/contracts`. `forge test` fails while the file is stale.
- The recipient is the profile wallet read from Privy, never from the request. The contract can't tell a wrong one.
- The recipient wallet must exist on the invoice's chain before the invoice is created.
- Receivers are deployed only when settling, refunding or recovering.

## Deciding "paid"

- Only `balanceOf` of the allowlisted token (chain ID + address) on an address we computed.
- Ignore logs from every other address: anyone can deploy a look-alike token or clone that emits the same events.
- A second, independent RPC confirms the balance before "paid" or a webhook, and the receiver's `settled()` before
  "settled".
- Arc: checkout builds an ERC-20 `transfer` on `0x3600…`, never a native send. Native USDC sends log `Transfer` from
  a system emitter (18 decimals) that the watcher ignores, so such a payment has no transfer row. When the second RPC's
  `balanceOf` holds more than is booked, the worker logs `ALERT receive address holds money with no booked transfer`
  and the invoice never expires: an operator checks the chain and refunds the money with the refund authority.
- Deposits are booked in chain order: one waits while an earlier one is still detected, so the earliest payers are
  paid to the creator first and later ones held (D-27). An empty `balanceOf` answer is an error, never 0.
- A deposit is received when seen and paid only at or below the chain's `finalized` block (D-45); show blocks and
  time left until then (`internal/finality`). Read headers, logs and receipts only, and compare block hashes the RPC
  returns: go-ethereum can't decode Base, Arbitrum and Tempo system transactions, and its `Header.Hash()` is wrong on
  Tempo ([S-4](../spikes/s4-chains.md)).

## Checkout

- The page shows an address only for the invoice its link names: for a payer-chooses invoice's further option, only
  when the option's id is `keccak256(abi.encode(link id, chain id, token))`, as `address.OptionID` makes it, so no
  other invoice's terms pass under the link. Only for terms the API would create (amount above
  0, settle deadline 24 h after expiry, expiry at most a year after creation, a recipient that is not zero, the token,
  the factory or the implementation), and only when the terms compute to it.
- No third-party scripts; pinned dependencies.

## Canary

`cmd/canary` (R-51) checks open invoices' receive addresses apart from the code that makes them. It imports no
address code or constants from the api or `apps/web`: of this repository it builds only `internal/canary` and
`internal/config` (a test fails otherwise), and its browser script `apps/web/scripts/canary-pay-page.ts` reads the
DOM and imports nothing from `src/`. It reads only its own `CANARY_*` variables (names in
`apps/backend/.env.example`): the api and web origins, the factory address, the factory's code hash, two RPCs on
different hosts per chain ID and the script path.

Stdin holds one open invoice or accepted option per line, its terms as the database stores them, then its token's
symbol, its chain's name and, for an option of a payer-chooses invoice (R-56), the invoice's id:
`id chain_id recipient_address token_contract amount expires_at settle_deadline symbol network [pay_id]`. A line whose
terms break create's rules (amount 0, a settle deadline other than expiry + 24 h, a recipient that is zero or the
token) is an alert. A line within 6 minutes of its expiry is skipped: the pay page stops showing the address 5
minutes before expiry. The canary then:

1. On both RPCs of every configured chain, requires `eth_chainId` to equal the chain ID and the keccak256 of the
   factory's code to equal `CANARY_FACTORY_CODE_HASH`. A receiver's init-code hash differs per invoice (its init
   code holds the terms), so the canary pins the factory's runtime code instead: with its immutables it fixes
   `predict`, the receiver implementation and the refund authority.
2. Reads `GET <api>/v1/invoices/<pay_id>` and requires the listed option with this `id` (its `optionId`, chain,
   token, amount and address) and the invoice's shared terms and `factory` to equal the database's terms and
   `CANARY_FACTORY`.
3. Calls `predict` with the database's terms on both RPCs and requires both to agree and to equal the api's
   `receiveAddress`.
4. Runs the script once for all ids, with a deadline that grows with their number. It opens `<web>/pay/<pay_id>?option=<id>`
   (`pay_id` is `id` for a fixed invoice and for the first option), which shows that option while none has money, in
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
  i.amount, i.expires_at, i.settle_deadline, t.symbol, c.name, m.id FROM invoices i
  JOIN invoices m ON m.id = coalesce(i.main_id, i.id)
  JOIN tokens t ON t.chain_id = i.chain_id AND t.contract = i.token_contract JOIN chains c ON c.chain_id = i.chain_id
  WHERE i.payment_status IN ('open', 'partially_paid') AND i.expires_at > extract(epoch FROM now()) + 60
    AND (m.chosen_id IS NULL OR m.chosen_id = i.id)" |
  pnpm --silent --filter @forwend/backend canary
```

The terms come from stdin, not a database connection, so the canary holds no database credentials; a read-only role
lists them. `detected` invoices are left out: a deposit that may cover the amount is on its way, and the page then
stops showing the address. So are the other options of an invoice whose option was chosen: the page no longer shows
them. An invoice paid between the query and the page read alerts once; the next run passes.

Limits:

- The canary trusts the database's terms. A wrong recipient written when the invoice was made is not caught; that
  needs the profile wallet read from Privy, which the canary does not hold.
- It catches tampering and drift that do not hide from it. A bundle written to evade it (spotting the headless
  browser, or drawing another QR over the checked one) is not caught.

## Accepted risks

- The executor can settle money the backend would hold (late, cancelled) before the deadline. It still goes only to
  the recipient.
- Testnet invoices are never shown to real payers: the testnet refund key could `recover` real money at the same
  address on mainnet.
