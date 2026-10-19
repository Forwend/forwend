// Package watcher records deposits to receive addresses: Transfer logs of each invoice's own token, detected when
// seen, confirmed once their block is at or below the chain's finalized block (D-45), reorged when the chain shows
// another block at their height (R-20). It records every enabled-token transfer from or to a profile wallet by the
// same rules (R-38).
package watcher

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"math/big"
	"slices"
	"strings"
	"time"

	"github.com/ensp1re/forwend/apps/backend/internal/chain"
	"github.com/ethereum/go-ethereum"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/common/hexutil"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/ethereum/go-ethereum/ethclient"
	"github.com/ethereum/go-ethereum/rpc"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

var transferTopic = crypto.Keccak256Hash([]byte("Transfer(address,address,uint256)"))

const (
	// MaxRange is the most blocks one eth_getLogs call covers; RPCs reject larger result sets (S-4).
	MaxRange = 2000
	// MinRange is the fewest blocks for a rate limit: a range this small that is still rate limited fails the scan. A
	// result too large narrows to one block, then its receipts, so zero-value Transfer spam can't stop the chain.
	MinRange = 50
	// RescanDepth finalized blocks are read again on every scan, so one lagging or empty eth_getLogs answer is never
	// the last look at a block. On Arc and Tempo finalized is latest, and 2,000 blocks are still 15 minutes or more.
	RescanDepth = MaxRange
	// MaxBatch is the most calls in one JSON-RPC batch.
	MaxBatch = 100
)

// Chain watches one EVM chain. Run one Chain per chain: two at once would race on the cursor.
type Chain struct {
	pool    *pgxpool.Pool
	chainID uint64
	rpc     *rpc.Client
	eth     *ethclient.Client
	// span is the blocks per eth_getLogs call: halved when the RPC refuses a range for its rate (down to MinRange) or
	// size (down to one block), doubled back up to MaxRange after each range it answers.
	span uint64
}

func NewChain(pool *pgxpool.Pool, chainID uint64, client *rpc.Client) *Chain {
	return &Chain{pool: pool, chainID: chainID, rpc: client, eth: ethclient.NewClient(client), span: MaxRange}
}

// header is a block as the RPC reports it. The hash is never computed in Go: go-ethereum gets it wrong on Tempo (S-4).
type header struct {
	Number    hexutil.Uint64 `json:"number"`
	Hash      common.Hash    `json:"hash"`
	Timestamp hexutil.Uint64 `json:"timestamp"`
}

// receiver is the invoice paid at a receive address, in its own token.
type receiver struct{ invoiceID, token string }

type deposit struct {
	invoiceID, token        string
	txHash, blockHash, from string
	to                      string
	logIndex, blockNumber   uint64
	blockTime               uint64
	amount                  *big.Int
	final                   bool
	finalized               uint64 // the chain's finalized block in the scan that saw it
}

// logKey identifies a log on one chain.
type logKey struct {
	blockHash string
	index     uint64
}

// pending is a detected row the chain may have dropped.
type pending struct {
	id          int64
	blockNumber uint64
	blockHash   string
	logIndex    uint64
}

// Scan reads the chain from RescanDepth blocks below the last finalized block (or from the oldest detected deposit or
// wallet transfer) to the latest block, and records the result in one transaction. Scanning the same range again changes nothing.
func (c *Chain) Scan(ctx context.Context) error {
	latest, err := c.eth.BlockNumber(ctx)
	if err != nil {
		return fmt.Errorf("read chain %d latest block: %w", c.chainID, err)
	}
	from, err := c.start(ctx)
	if err != nil {
		return err
	}
	latest = min(latest, from+scanLimit-1)
	invoices, err := c.invoices(ctx)
	if err != nil {
		return err
	}
	wallets, err := c.wallets(ctx)
	if err != nil {
		return err
	}
	var logs, walletLogs []types.Log
	for lo := from; lo <= latest; {
		hi := min(lo+c.span-1, latest)
		var found, foundWallet []types.Log
		var err error
		if len(invoices) > 0 {
			found, err = c.logs(ctx, lo, hi, invoices)
		}
		if err == nil {
			foundWallet, err = c.walletLogs(ctx, lo, hi, wallets)
		}
		if next, ok := narrower(err, c.span); ok {
			c.span = next
			continue
		}
		if err != nil {
			return err
		}
		logs, walletLogs = append(logs, found...), append(walletLogs, foundWallet...)
		lo, c.span = hi+1, min(c.span*2, MaxRange)
	}
	open, err := c.pending(ctx, "chain_transfers", from)
	if err != nil {
		return err
	}
	openWallet, err := c.pending(ctx, "wallet_transfers", from)
	if err != nil {
		return err
	}

	// The finalized block and every block we judge come from one batch, so usually from one node.
	numbers := []uint64{latest}
	for _, l := range logs {
		numbers = append(numbers, l.BlockNumber)
	}
	for _, l := range walletLogs {
		numbers = append(numbers, l.BlockNumber)
	}
	for _, p := range open {
		numbers = append(numbers, p.blockNumber)
	}
	for _, p := range openWallet {
		numbers = append(numbers, p.blockNumber)
	}
	final, headers, err := c.headers(ctx, numbers)
	if err != nil {
		return err
	}
	finalized := uint64(final.Number)

	deposits, seen := depositsOf(logs, headers, invoices, finalized)
	transfers := wallets.transfers(walletLogs, openWallet, headers, finalized, seen)
	// A detected row is reorged only when the chain shows another block at its height. A log that is merely
	// missing from one answer proves nothing.
	reorgedOf := func(open []pending) []int64 {
		var reorged []int64
		for _, p := range open {
			h, ok := headers[p.blockNumber]
			if !seen[logKey{p.blockHash, p.logIndex}] && ok && hexutil.Encode(h.Hash[:]) != p.blockHash {
				reorged = append(reorged, p.id)
			}
		}
		return reorged
	}
	// The cursor's finalized block never passes what this scan read: finalized was read after latest and may be
	// higher, and blocks above latest were not scanned. Its time is that block's, for expiry and countdowns.
	head, ok := headers[latest]
	if finalized > latest {
		if !ok {
			return fmt.Errorf("read chain %d block %d: not found", c.chainID, latest)
		}
		final = head
	}
	if !ok { // a node behind the one that answered latest: the scanned time stays safe, at the finalized block's
		head = header{Number: hexutil.Uint64(latest), Timestamp: final.Timestamp}
	}
	return c.record(ctx, reorgedOf(open), deposits, reorgedOf(openWallet), transfers, final, head)
}

// depositsOf turns invoice logs into deposits, final at or below finalized, and the set of logs it kept. A log whose
// block this node no longer shows is left for the next scan.
func depositsOf(logs []types.Log, headers map[uint64]header, invoices map[common.Address]receiver,
	finalized uint64) ([]deposit, map[logKey]bool) {
	var deposits []deposit
	seen := map[logKey]bool{}
	for _, l := range logs {
		h, ok := headers[l.BlockNumber]
		if !ok || h.Hash != l.BlockHash {
			continue // this node's view moved since eth_getLogs; the next scan sees it again
		}
		inv := invoices[common.BytesToAddress(l.Topics[2].Bytes())]
		d := deposit{
			// The emitting contract, not the invoice's token: the foreign key then also rejects a mismatch.
			invoiceID: inv.invoiceID, token: hexutil.Encode(l.Address[:]), txHash: hexutil.Encode(l.TxHash[:]),
			blockHash: hexutil.Encode(l.BlockHash[:]), from: hexutil.Encode(l.Topics[1][12:]),
			to: hexutil.Encode(l.Topics[2][12:]), logIndex: uint64(l.Index), blockNumber: l.BlockNumber,
			blockTime: uint64(h.Timestamp), amount: new(big.Int).SetBytes(l.Data), final: l.BlockNumber <= finalized,
			finalized: finalized,
		}
		deposits = append(deposits, d)
		seen[logKey{d.blockHash, d.logIndex}] = true
	}
	return deposits, seen
}

// start is where this scan begins. A new chain starts at its finalized block: deposits and wallet transfers before
// the first scan are not looked for. ponytail: add a start block to chains if a chain is enabled after invoices on it
// exist.
func (c *Chain) start(ctx context.Context) (uint64, error) {
	var from int64
	err := c.pool.QueryRow(ctx, `
		SELECT least(greatest(cur.last_finalized_block + 1 - $2, 0),
		             coalesce((SELECT min(block_number) FROM chain_transfers
		                       WHERE chain_id = $1 AND status = 'detected'), cur.last_finalized_block + 1),
		             coalesce((SELECT min(block_number) FROM wallet_transfers
		                       WHERE chain_id = $1 AND status = 'detected'), cur.last_finalized_block + 1))
		FROM chain_cursors cur WHERE cur.chain_id = $1`, c.chainID, RescanDepth).Scan(&from)
	if errors.Is(err, pgx.ErrNoRows) {
		finalized, _, err := c.headers(ctx, nil)
		return uint64(finalized.Number) + 1, err
	}
	if err != nil {
		return 0, fmt.Errorf("read chain %d cursor: %w", c.chainID, err)
	}
	return uint64(from), nil
}

// insertDeposits inserts each deposit, or brings a reorged one back, inside tx. A confirmed row may be booked and never
// changes; a reorged one comes back if its block is canonical again.
func (c *Chain) insertDeposits(ctx context.Context, tx pgx.Tx, deposits []deposit) error {
	for _, d := range deposits {
		status := "detected"
		if d.final {
			status = "confirmed"
		}
		row, err := tx.Begin(ctx)
		if err != nil {
			return fmt.Errorf("record chain %d deposit %s/%d: %w", c.chainID, d.txHash, d.logIndex, err)
		}
		_, err = row.Exec(ctx, `
			INSERT INTO chain_transfers (chain_id, chain_family, token_contract, invoice_id, tx_hash, log_index,
			    block_hash, block_number, block_time, from_address, to_address, amount, status, detected_finalized_block)
			VALUES ($1, 'evm', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
			ON CONFLICT (chain_id, block_hash, log_index) DO UPDATE SET status = excluded.status
			WHERE chain_transfers.status <> 'confirmed' AND chain_transfers.status <> excluded.status`,
			c.chainID, d.token, d.invoiceID, d.txHash, d.logIndex, d.blockHash, d.blockNumber, d.blockTime,
			d.from, d.to, d.amount.String(), status, d.finalized)
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.ConstraintName == "chain_transfers_live_log" {
			// The same transaction is already recorded under another block: one bad node must not stop the chain's
			// scan, and an operator decides which block is real.
			_ = row.Rollback(ctx)
			slog.Error("ALERT deposit recorded under another block was mined again; skipped", "chain", c.chainID,
				"tx", d.txHash, "log", d.logIndex, "block", d.blockHash)
			continue
		}
		if err == nil {
			err = row.Commit(ctx)
		}
		if err != nil {
			return fmt.Errorf("record chain %d deposit %s/%d: %w", c.chainID, d.txHash, d.logIndex, err)
		}
	}
	return nil
}

// invoices maps each receive address on this chain to its invoice and token.
func (c *Chain) invoices(ctx context.Context) (map[common.Address]receiver, error) {
	// Money reaching an invoice 30 days after its settle deadline (the contracts' MAX_HOLD) is moved only by the
	// refund authority, from the chain: not watching those keeps each scan's topic lists bounded. One with a deposit
	// still detected stays until it confirms or is reorged, or that row would hold every scan's start for good.
	rows, err := c.pool.Query(ctx, `SELECT receive_address, id, token_contract FROM invoices i
		WHERE chain_id = $1 AND (settle_deadline > extract(epoch FROM now())::bigint - $2
		    OR EXISTS (SELECT 1 FROM chain_transfers t WHERE t.invoice_id = i.id AND t.status = 'detected'))`,
		c.chainID, int64(watchedAfterDeadline/time.Second))
	if err != nil {
		return nil, fmt.Errorf("read chain %d invoices: %w", c.chainID, err)
	}
	defer rows.Close()
	out := map[common.Address]receiver{}
	for rows.Next() {
		var addr, id, token string
		if err := rows.Scan(&addr, &id, &token); err != nil {
			return nil, fmt.Errorf("read chain %d invoices: %w", c.chainID, err)
		}
		out[common.HexToAddress(addr)] = receiver{id, token}
	}
	return out, rows.Err()
}

var watchedAfterDeadline = 30 * 24 * time.Hour

// A round that times out records nothing, so a long backlog is caught up over several scans.
var scanLimit uint64 = 20 * MaxRange

// go-ethereum nodes refuse more with "exceed max topics"; a smaller block range doesn't help.
var topicLimit = 1000

func topicParts(addresses []common.Hash) [][]common.Hash {
	var parts [][]common.Hash
	for len(addresses) > topicLimit {
		parts, addresses = append(parts, addresses[:topicLimit]), addresses[topicLimit:]
	}
	return append(parts, addresses)
}

func narrower(err error, span uint64) (uint64, bool) {
	switch {
	case err == nil:
		return span, false
	case chain.TooLarge(err) && span > 1:
		return span / 2, true
	case chain.Overloaded(err) && span > MinRange:
		return max(span/2, MinRange), true
	}
	return span, false
}

func (c *Chain) filterLogs(ctx context.Context, q ethereum.FilterQuery) ([]types.Log, error) {
	logs, err := c.eth.FilterLogs(ctx, q)
	if err == nil || !chain.TooLarge(err) || q.FromBlock.Cmp(q.ToBlock) != 0 {
		return logs, err
	}
	var receipts []struct {
		Logs []types.Log `json:"logs"`
	}
	if err := c.rpc.CallContext(ctx, &receipts, "eth_getBlockReceipts", hexutil.EncodeBig(q.FromBlock)); err != nil {
		return nil, fmt.Errorf("read block %s receipts: %w", q.FromBlock, err)
	}
	logs = nil
	for _, r := range receipts {
		for _, l := range r.Logs {
			if matches(q, l) {
				logs = append(logs, l)
			}
		}
	}
	return logs, nil
}

func matches(q ethereum.FilterQuery, l types.Log) bool {
	if len(q.Addresses) > 0 && !slices.Contains(q.Addresses, l.Address) {
		return false
	}
	for i, want := range q.Topics {
		if len(want) > 0 && (i >= len(l.Topics) || !slices.Contains(want, l.Topics[i])) {
			return false
		}
	}
	return true
}

// logs returns the Transfer logs in [lo, hi] that pay an invoice in its own token.
func (c *Chain) logs(ctx context.Context, lo, hi uint64, invoices map[common.Address]receiver) ([]types.Log, error) {
	tokens := map[common.Address]bool{}
	var receivers []common.Hash
	for addr, inv := range invoices {
		tokens[common.HexToAddress(inv.token)] = true
		receivers = append(receivers, common.BytesToHash(addr.Bytes()))
	}
	var tokenList []common.Address
	for t := range tokens {
		tokenList = append(tokenList, t)
	}
	var logs []types.Log
	for _, part := range topicParts(receivers) {
		found, err := c.filterLogs(ctx, ethereum.FilterQuery{
			FromBlock: new(big.Int).SetUint64(lo), ToBlock: new(big.Int).SetUint64(hi),
			Addresses: tokenList, Topics: [][]common.Hash{{transferTopic}, nil, part},
		})
		if err != nil {
			return nil, fmt.Errorf("read chain %d logs %d-%d: %w", c.chainID, lo, hi, err)
		}
		logs = append(logs, found...)
	}
	var out []types.Log
	for _, l := range logs {
		if l.Removed || len(l.Topics) != 3 || len(l.Data) != 32 || new(big.Int).SetBytes(l.Data).Sign() == 0 {
			continue
		}
		inv, ok := invoices[common.BytesToAddress(l.Topics[2].Bytes())]
		// Only the invoice's own token counts: anyone can emit Transfer from a look-alike contract.
		if ok && strings.EqualFold(l.Address.Hex(), inv.token) {
			out = append(out, l)
		}
	}
	return out, nil
}

// pending returns the detected rows of table (chain_transfers or wallet_transfers) at or above from.
func (c *Chain) pending(ctx context.Context, table string, from uint64) ([]pending, error) {
	rows, err := c.pool.Query(ctx, `SELECT id, block_number, block_hash, log_index FROM `+table+`
		WHERE chain_id = $1 AND status = 'detected' AND block_number >= $2`, c.chainID, from)
	if err != nil {
		return nil, fmt.Errorf("read chain %d detected %s: %w", c.chainID, table, err)
	}
	defer rows.Close()
	var out []pending
	for rows.Next() {
		var p pending
		if err := rows.Scan(&p.id, &p.blockNumber, &p.blockHash, &p.logIndex); err != nil {
			return nil, fmt.Errorf("read chain %d detected %s: %w", c.chainID, table, err)
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// headers reads the finalized block and the given blocks in one JSON-RPC batch. A block the node doesn't have is
// left out.
func (c *Chain) headers(ctx context.Context, numbers []uint64) (header, map[uint64]header, error) {
	unique := map[uint64]bool{}
	var finalized *header
	batch := []rpc.BatchElem{{Method: "eth_getBlockByNumber", Args: []any{"finalized", false}, Result: &finalized}}
	results := map[uint64]**header{}
	for _, n := range numbers {
		if unique[n] {
			continue
		}
		unique[n] = true
		var h *header
		results[n] = &h
		batch = append(batch, rpc.BatchElem{Method: "eth_getBlockByNumber", Args: []any{hexutil.EncodeUint64(n), false}, Result: &h})
	}
	// RPC providers cap batch sizes; finalized stays in the first chunk with the first blocks.
	for i := 0; i < len(batch); i += MaxBatch {
		if err := c.rpc.BatchCallContext(ctx, batch[i:min(i+MaxBatch, len(batch))]); err != nil {
			return header{}, nil, fmt.Errorf("read chain %d blocks: %w", c.chainID, err)
		}
	}
	for _, b := range batch {
		if b.Error != nil {
			return header{}, nil, fmt.Errorf("read chain %d block %v: %w", c.chainID, b.Args[0], b.Error)
		}
	}
	if finalized == nil {
		return header{}, nil, fmt.Errorf("read chain %d finalized block: not found", c.chainID)
	}
	out := map[uint64]header{}
	for n, h := range results {
		if *h != nil {
			out[n] = **h
		}
	}
	return *finalized, out, nil
}

// record writes one scan: reorged rows first (so a re-mined copy can be live), then each deposit and wallet transfer
// is inserted or brought back, then the cursor moves.
func (c *Chain) record(ctx context.Context, reorged []int64, deposits []deposit, reorgedWallet []int64,
	transfers []walletTransfer, finalized, scanned header) error {
	tx, err := c.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("record chain %d scan: %w", c.chainID, err)
	}
	defer tx.Rollback(ctx)

	if _, err = tx.Exec(ctx, "UPDATE chain_transfers SET status = 'reorged' WHERE id = ANY($1) AND status = 'detected'",
		reorged); err != nil {
		return fmt.Errorf("mark chain %d reorged deposits: %w", c.chainID, err)
	}
	if _, err = tx.Exec(ctx, "UPDATE wallet_transfers SET status = 'reorged' WHERE id = ANY($1) AND status = 'detected'",
		reorgedWallet); err != nil {
		return fmt.Errorf("mark chain %d reorged wallet transfers: %w", c.chainID, err)
	}
	if err := c.insertDeposits(ctx, tx, deposits); err != nil {
		return err
	}
	for _, t := range transfers {
		status := "detected"
		if t.final {
			status = "confirmed"
		}
		// As for deposits: a confirmed row is final and never changes; a reorged one comes back.
		_, err = tx.Exec(ctx, `
			INSERT INTO wallet_transfers (chain_id, chain_family, token_contract, wallet_address, direction, counterparty,
			    tx_hash, log_index, block_hash, block_number, block_time, amount, status)
			VALUES ($1, 'evm', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
			ON CONFLICT (chain_id, block_hash, log_index, wallet_address, direction) DO UPDATE SET status = excluded.status
			WHERE wallet_transfers.status <> 'confirmed' AND wallet_transfers.status <> excluded.status`,
			c.chainID, t.token, t.wallet, t.direction, t.counterparty, t.txHash, t.logIndex, t.blockHash, t.blockNumber,
			t.blockTime, t.amount.String(), status)
		if err != nil {
			return fmt.Errorf("record chain %d wallet transfer %s/%d: %w", c.chainID, t.txHash, t.logIndex, err)
		}
	}
	_, err = tx.Exec(ctx, `
		INSERT INTO chain_cursors (chain_id, last_scanned_block, last_finalized_block, last_finalized_time,
		    last_scanned_time)
		VALUES ($1, $2, $3, $4, $5)
		ON CONFLICT (chain_id) DO UPDATE
		SET last_scanned_block = greatest(excluded.last_scanned_block, chain_cursors.last_finalized_block),
		    last_scanned_time = CASE WHEN excluded.last_scanned_block >= chain_cursors.last_finalized_block
		        THEN excluded.last_scanned_time ELSE chain_cursors.last_finalized_time END,
		    last_finalized_block = greatest(chain_cursors.last_finalized_block, excluded.last_finalized_block),
		    last_finalized_time = CASE WHEN excluded.last_finalized_block >= chain_cursors.last_finalized_block
		        THEN excluded.last_finalized_time ELSE chain_cursors.last_finalized_time END,
		    updated_at = now()`, c.chainID, uint64(scanned.Number), uint64(finalized.Number), uint64(finalized.Timestamp),
		uint64(scanned.Timestamp))
	if err != nil {
		return fmt.Errorf("move chain %d cursor: %w", c.chainID, err)
	}
	return tx.Commit(ctx)
}
