# S-4 chain reading on testnets

Checked 2026-10-09 with go-ethereum v1.17.8 (`ethclient` and `rpc`) against each chain. Answers Q-7 (decision D-45).
Mainnet values are not checked yet; repeat this before enabling a mainnet chain.

Method: a throwaway Go program (not kept in the repo) read the `latest`, `safe` and `finalized` blocks, 20 recent full
blocks, one transaction and receipt of each transaction type seen, `Transfer` logs of the test token with `FilterLogs`,
and `balanceOf` with `CallContract`. Tag lag was sampled 5 times, 30 s apart, with one batched call per sample. Header
hashes were compared at a fixed block number: `HeaderByNumber(n).Hash()` against the `hash` field the RPC returns.

## Result

| Chain | RPC used | Block time | `safe` behind `latest` | `finalized` behind `latest` | `header.Hash()` = RPC hash |
|---|---|---|---|---|---|
| Base Sepolia | Infura | 2.0 s | 28 s – 3 min | 15 – 25 min | yes |
| Arbitrum Sepolia | Infura, public | 0.25 s | 10 – 13 min | 16 – 19 min | yes |
| Arc testnet | Infura, dRPC, Blockdaemon | 0.5 s | 0 (same block) | 0 (same block) | yes |
| Tempo Moderato | `rpc.moderato.tempo.xyz` | 0.6 s | 0 (same block) | 0 (same block) | **no** |

| Chain | Transaction types seen | `BlockByNumber` (full block) | `TransactionByHash` | Receipts | `Transfer` logs |
|---|---|---|---|---|---|
| Base Sepolia | 0x00, 0x02, 0x04, 0x7e (OP deposit) | fails on 20 of 20 blocks | fails for 0x7e | all types decode | decode; ≤ 10,000 results per query |
| Arbitrum Sepolia | 0x00, 0x02, 0x6a (Arbitrum internal) | fails on 20 of 20 blocks | fails for 0x6a | all types decode | decode; 10,000-block range accepted |
| Arc testnet | 0x00, 0x02 | works | works | all types decode | decode; ≤ 20,000 results per query |
| Tempo Moderato | 0x00, 0x02, 0x76 (Tempo) | fails on 13 of 20 blocks | fails for 0x76 | all types decode | decode; a 10,000-block query got HTTP 502, 2,000 worked |

The failure in every case is go-ethereum's `transaction type not supported`. `balanceOf` through `CallContract` worked
on all four chains.

## Findings

- **Read only headers, logs and receipts.** Full blocks and transactions of chain-specific types do not decode on Base,
  Arbitrum and Tempo. The watcher needs only `HeaderByNumber`, `FilterLogs`, `TransactionReceipt` and `CallContract`,
  which work everywhere. No raw-RPC adapter is needed (PLAN S-4 failure decision not triggered).
- **Never compute a block hash in Go.** On Tempo, `types.Header.Hash()` differs from the real block hash (its header has
  fields go-ethereum does not know). Reorg checks must compare hashes the RPC returns (`hash`, `parentHash`,
  `log.BlockHash`), never `Header.Hash()`.
- **Filter by token contract.** On Arc a USDC payment emits two `Transfer` logs in one receipt: one from the USDC contract
  `0x3600…0000` (6 decimals) and one from the system address `0xffff…fffe` for the native coin (18 decimals, same
  money). Only the allowlisted token contract counts (already a rule in `docs/backend/money-safety.md`).
- **Tempo fees are token transfers.** A Tempo AlphaUSD payment also emits a `Transfer` of the fee to the fee manager
  `0xfeEC…0000`. It is not to a receive address, so the watcher ignores it.
- **Log query limits differ.** Infura caps a query at 10,000 results, Arc's Infura endpoint at 20,000, and Tempo's public
  RPC failed on a 10,000-block range. The watcher filters by token and receive address, so results stay small; it should
  still split a range when the RPC rejects it. S-7 measures limits and polling cost.
- **Infura rate limits hit quickly.** Four chains polled in parallel from one key got HTTP 429 within minutes. The
  watcher needs rotation or a paid plan (S-7, approval before paid usage).
- **`safe` jumps.** On Base, `safe` moved in steps (28 s to 3 min behind) as batches reached L1; `finalized` follows L1
  finality (15–25 min). On Arbitrum both follow L1 and are 10+ minutes behind.

## Confirmation rule (Q-7)

Use the chain's own `finalized` tag on every chain. No fixed block count: finality takes longer on busy days, and on
Base and Arbitrum the count that matters is in L1 blocks (see below).

- **Received**: the deposit is in a block at or below `latest`. Checkout shows it at once.
- **Paid**: the deposit's block is at or below the `finalized` block and its block hash still matches. Only then.
- **Progress** for a deposit in block `B` with block time `T`, recomputed on every poll from the finalized head `F`:
  blocks left = `max(0, B − F.number)`; time left = `max(0, T − F.time)`. Time left is the chain time the finalized
  head must still cover. When finality slows down, `F` falls further behind and the estimate grows by itself.
- Measured wait until paid: Arc and Tempo at once (finalized = latest); Base 15–25 min; Arbitrum 16–19 min.
- Reorg checks stop at `finalized`; `chain_cursors` stores the last finalized block.

`safe` is not used: on Arbitrum it is 10+ minutes behind, almost as slow as `finalized`, and it is not final.

## Comparison with block counts

The common "wait about 64 blocks" rule is Ethereum L1 finality: a checkpoint is finalized two epochs (2 × 32 slots) after
it, about 64–95 L1 blocks or 13–19 minutes. The `finalized` tag reports exactly that state, so it needs no count.
On Base and Arbitrum the count is in L1 blocks after the batch that holds the L2 block reaches L1. Counting the L2's own
blocks means nothing there: 64 Base blocks are 2 minutes and 64 Arbitrum blocks 16 seconds, both before any L1 finality.

Circle, the USDC issuer, uses the same split:

| Chain | Circle hard finality (CCTP Standard, Gateway) | Circle soft finality (CCTP Fast) | Our measured `finalized` lag |
|---|---|---|---|
| Base | ~65 ETH blocks, 15–19 min | 1 block, ~8 s | 15–25 min |
| Arbitrum | ~65 ETH blocks, 15–19 min | 1 block, ~8 s | 16–19 min |
| Arc | 1 block, ~0.5 s | not listed | 0 (same block) |
| Tempo | not listed | not listed | 0 (same block) |

Circle credits soft-finality transfers only within a global allowance; anything else waits for hard finality.

## Sources

- Measured with go-ethereum v1.17.8 against the RPCs above; transaction type constants from go-ethereum
  `core/types/transaction.go` (0x00–0x04).
- Circle block confirmations: https://developers.circle.com/cctp/required-block-confirmations,
  https://developers.circle.com/gateway/references/supported-blockchains
- Ethereum two-epoch finality: https://blog.nimbus.team/two-point-oh-justification-and-finalization/
- RPC endpoints and test tokens: [s5-s6-testnets.md](s5-s6-testnets.md).
