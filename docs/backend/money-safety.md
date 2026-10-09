# Backend money safety

Rules that protect the contracts. Read before touching invoices, the watcher, the signer or checkout.

## Receive address

- Compute it locally from the factory address and init-code hash compiled into the binary. Never read it from the
  database or an RPC.
- `(chain_id, receive_address)` is unique. The watcher alerts on any invoice whose address does not recompute.
- Before showing an address, run the same term checks as `settle`, plus expiry ≤ 365 days and settle deadline =
  expiry + 24 h. The contract accepts any terms, so these checks live only here.
- Go address code and `predict` share test vectors.
- The recipient is the profile wallet read from Privy, never from the request. The contract can't tell a wrong one.
- The recipient wallet must exist on the invoice's chain before the invoice is created.
- Receivers are deployed only when settling, refunding or recovering.

## Deciding "paid"

- Only `balanceOf` of the allowlisted token (chain ID + address) on an address we computed.
- Ignore logs from every other address: anyone can deploy a look-alike token or clone that emits the same events.
- A second, independent RPC confirms the balance before "paid" or a webhook.
- Arc: checkout builds an ERC-20 `transfer` on `0x3600…`, never a native send. Native USDC sends log `Transfer` from
  a system emitter (18 decimals); index it for deposit times, but decide from `balanceOf` (6 decimals).

## Checkout

- The page recomputes the address from the terms and refuses to show a mismatch.
- No third-party scripts; pinned dependencies.
- A canary from a separate build and host takes the factory address from its own config, calls `predict(terms)` on
  two RPCs and compares with the live page. A canary in the same build would share a tampered constant.

## Accepted risks

- The executor can settle money the backend would hold (late, cancelled) before the deadline. It still goes only to
  the recipient.
- Testnet invoices are never shown to real payers: the testnet refund key could `recover` real money at the same
  address on mainnet.
