# Backend money safety

Rules that protect the contracts. Read before touching invoices, the watcher, the signer or checkout.

## Receive address

- Compute it locally (`internal/address`) from the factory and implementation addresses compiled into the binary. The
  init-code hash differs per invoice: the clone's init code contains the terms. Never read it from the database or an RPC.
- `(chain_id, receive_address)` is unique. The watcher alerts on any invoice whose address does not recompute.
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
- A second, independent RPC confirms the balance before "paid" or a webhook.
- Arc: checkout builds an ERC-20 `transfer` on `0x3600…`, never a native send. Native USDC sends log `Transfer` from
  a system emitter (18 decimals) that the watcher ignores, so such a payment has no transfer row: decide from
  `balanceOf` (6 decimals) and hold or alert on balance without a matching transfer.
- A deposit is received when seen and paid only at or below the chain's `finalized` block (D-45); show blocks and
  time left until then (`internal/finality`). Read headers, logs and receipts only, and compare block hashes the RPC
  returns: go-ethereum can't decode Base, Arbitrum and Tempo system transactions, and its `Header.Hash()` is wrong on
  Tempo ([S-4](../spikes/s4-chains.md)).

## Checkout

- The page recomputes the address from the terms and refuses to show a mismatch.
- No third-party scripts; pinned dependencies.
- A canary from a separate build and host takes the factory address from its own config, calls `predict(terms)` on
  two RPCs and compares with the live page. A canary in the same build would share a tampered constant. See
  [Canary](#canary).

## Canary

`cmd/canary` (R-51) checks open invoices' receive addresses apart from the code that makes them. It imports no
address code or constants from the api or `apps/web`: of this repository it builds only `internal/canary` and
`internal/config` (a test fails otherwise), and its browser script `apps/web/scripts/canary-pay-page.ts` reads the
DOM and imports nothing from `src/`. It reads only its own `CANARY_*` variables (names in
`apps/backend/.env.example`): the api and web origins, the factory address, the factory's code hash, two RPCs on
different hosts per chain ID and the script path.

Stdin holds one open invoice per line, its terms as the database stores them:
`id chain_id recipient_address token_contract amount expires_at settle_deadline`. The canary then:

1. On both RPCs of every configured chain, requires `eth_chainId` to equal the chain ID and the keccak256 of the
   factory's code to equal `CANARY_FACTORY_CODE_HASH`. A receiver's init-code hash differs per invoice (its init
   code holds the terms), so the canary pins the factory's runtime code instead: with its immutables it fixes
   `predict`, the receiver implementation and the refund authority.
2. Reads `GET <api>/v1/invoices/<id>` and requires its terms and `factory` to equal the database's terms and
   `CANARY_FACTORY`.
3. Calls `predict` with the database's terms on both RPCs and requires both to agree and to equal the api's
   `receiveAddress`.
4. Runs the script once for all ids, with a deadline that grows with their number. It opens `<web>/pay/<id>` in
   Chromium as a payer would, passes the network-confirm gate and reads each send tab's text and QR code. The text
   must show that one address, and each QR code must draw what `uqr` encodes for it, as `QrCode` in
   `packages/ui-web` does. A page that shows no address (the invoice is no longer open, or the page refused the
   terms) is an alert too.

Any difference or failed read logs `canary alert` with the problem and exits 1; otherwise `canary passed`, exit 0.
Empty stdin is an alert as well, because it usually means the query failed; pass `-allow-empty` only for a one-off
run by hand. Run it on its own host with Node, `pnpm install` and `pnpm --filter @forwend/web exec playwright install
chromium`, from cron or a scheduler. Page on a non-zero exit, and also when a scheduled run is missed (a dead-man
check on the last `canary passed`):

```sh
psql "$READONLY_DATABASE_URL" -At -F ' ' -c "SELECT id, chain_id, recipient_address, token_contract, amount,
  expires_at, settle_deadline FROM invoices WHERE payment_status IN ('open', 'partially_paid')
  AND expires_at > extract(epoch FROM now()) + 60" |
  pnpm --silent --filter @forwend/backend canary
```

The terms come from stdin, not a database connection, so the canary holds no database credentials; a read-only role
lists them. `detected` invoices are left out: a deposit that may cover the amount is on its way, and the page then
stops showing the address. An invoice paid between the query and the page read alerts once; the next run passes.

Limits:

- The canary trusts the database's terms. A wrong recipient written when the invoice was made is not caught; that
  needs the profile wallet read from Privy, which the canary does not hold.
- The page has no EIP-681 or wallet link to check.
- It catches tampering and drift that do not hide from it. A bundle written to evade it (spotting the headless
  browser, or drawing another QR over the checked one) is not caught.

## Accepted risks

- The executor can settle money the backend would hold (late, cancelled) before the deadline. It still goes only to
  the recipient.
- Testnet invoices are never shown to real payers: the testnet refund key could `recover` real money at the same
  address on mainnet.
