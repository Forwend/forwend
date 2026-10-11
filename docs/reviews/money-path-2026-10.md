# Money-path review, 2026-10-11 (PLAN 8.12)

The phase 8 gate: the complete money path reviewed before phase 9, after the owner's live runs. Task F121.

## Scope

Three independent reviewers read the code, ran the tests and made read-only calls to the four testnets:

| Area | Code |
|---|---|
| Invoice creation and the receive address | `internal/invoice`, `internal/address`, `internal/httpapi`, `internal/canary`, `apps/web/src/features/pay`, the factory and receiver contracts, `vectors/receive-address.json` |
| Watcher, finality, reorgs and the ledger | `internal/watcher`, `internal/finality`, `internal/ledger`, `internal/worker`, `internal/chain`, `internal/balance`, the migrations |
| Signer and settlement | `internal/settlement`, `cmd/signer`, `ledger.BookSettlement`, the contracts' settle and refund paths |

Each finding below was checked against the code before it was fixed or queued.

## Owner's live runs

| Network | Token | Pay | Settle |
|---|---|---|---|
| Base Sepolia | USDC | `0xc0c2569251d8dbc90db86ed84c2a252a4187ca10e8a22574fc323311467e923d` | settled, no settle of ours recorded |
| Arc testnet | USDC | `0x43f3b1e9679afb1b8988275c2b95df855eaf7bbec87462218ea8f4f1898fa564` | `0x0a0184cc7701de977c322aee48beeff47ad55856f9c453b408eaf39333e08673` |
| Tempo Moderato | OUSD | `0x67d86a22f80a42c8fd7c6a17b22907e91e0fc8027ad5d52e94994d9e5237f21f` | `0xe4015d1d35213b2cc5f682d3de538ee0d58b8ccd573784fbc2d4c94ac079d372` |

The owner waived the Arbitrum Sepolia run.

## Fixed in F121

| Severity | Finding | Fix | Test |
|---|---|---|---|
| High | The pay page checked that the API answer agrees with itself, not that it is the invoice the link names. An API answer swapped for another real invoice (the attacker's own, same amount) would show an address that settles to the attacker. | `checkedReceiveAddress` takes the link's invoice id; the id is part of the address. | `receive-address.test.ts` |
| High | The watcher sent every receive address and every profile wallet in one `eth_getLogs` topic list. Arbitrum's public RPC refuses more than 1,000 ("exceed max topics"), an error a smaller range does not fix, so the chain's watcher would stop at the 1,001st wallet or invoice. | Topic lists of at most 1,000. | `TestAddressListsAreSplitForTheNode` |
| Medium | "Settled" was booked on the primary RPC's word alone, while "paid" needs a second RPC (D-15). | The second RPC must also read `settled()` true at its finalized block. | `TestSettlementIsBookedOnlyWhenTheSecondRPCAgrees` |
| Medium | One scan had to read the whole backlog within one round's timeout; a round that times out records nothing, so a long backlog never caught up. | At most 40,000 blocks per scan. | `TestLongBacklogIsCaughtUpOverSeveralScans` |
| Low | The startup gas floor on Tempo was about 5.5 times too low: Tempo's deploy and settle used 1,878,603 gas, not 342,000. | `TempoMinGas` from the measured testnet flow. | `TestCheckGasInFeeToken` |

Each test fails on the code before its fix.

## Queued

| Task | Severity | Findings |
|---|---|---|
| F122 | Medium | A log the RPC never returned (on Arc and Tempo `RescanDepth` is only about 35 s) or Arc native USDC with no Transfer log leaves the invoice open for good: the balance check only blocks expiry with a log line. |
| F123 | Low | Deposits can book in detection order instead of chain order (the wrong payer marked for a refund); an empty `balanceOf` answer reads as 0; a re-mined log under a block called final too early fails every later scan. |
| F124 | Low | Stuck deploys are never replaced; a nonce gap can stall a chain; a replacement settle keeps a gas limit that L1 costs may outgrow; the settle gas floor does not cover Tempo; the signer checks its lock only between rounds. None moves money to the wrong place. |
| F125 | Low | The pay page does not run the term checks money-safety.md asks for; the canary does not compare the network, token and amount shown on the page or the terms' rules; the api does not check the factory's code at startup. |

For the owner's UI review: pending amounts include unbooked deposits that will end up held; held money in a disabled
token is not shown; issuer and sender names are free text with no "not verified" marker.

## Found correct

- Go, the browser and the contract's `predict()` give the same receive address on all four chains (the shared vectors
  cover each chain id and the amount and time limits; the factory code hash and implementation match on chain).
- Invoice terms never change (database triggers); idempotency covers every term and detail; a recipient is always the
  profile's own wallet, checked again by the signer.
- Scan ranges have no gaps; reorgs are judged only from another block hash at a height; only the invoice's own token
  counts; Tempo TIP-20 transfers, with or without a memo, emit `Transfer`.
- Paid is set only from final money confirmed by the second RPC (D-29); the ledger's double entry, append-only rows
  and one booking per transfer are enforced by the database.
- The signer can't settle the wrong amount or recipient, settle twice, or settle before paid: `settle()` takes no
  arguments, terms are recomputed before signing, signed bytes are saved before sending, and the contract checks the
  recipient received exactly the amount. Late and excess money stays held.
