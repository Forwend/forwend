// Package watcher records Transfer deposits to receive addresses and profile-wallet transfers (R-38): detected when
// seen, confirmed at or below the finalized block (D-45), reorged when another block shows at their height (R-20).
package watcher

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"math/big"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/ethereum/go-ethereum"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/common/hexutil"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/ethereum/go-ethereum/ethclient"
	"github.com/ethereum/go-ethereum/rpc"
	"github.com/forwend/forwend/apps/backend/internal/chain"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

var transferTopic = crypto.Keccak256Hash([]byte("Transfer(address,address,uint256)"))

const (
	// MaxRange is the most blocks one eth_getLogs call covers; RPCs reject larger result sets (S-4). A range every
	// endpoint refuses halves, down to one block and then its receipts, so zero-value Transfer spam can't stop the chain.
	MaxRange = 2000
	// RescanDepth finalized blocks, at most one log range, are read again on every scan, so one lagging or empty
	// eth_getLogs answer is never the last look at a block. Recovery sweeps everything again later.
	RescanDepth = MaxRange
	MaxBatch    = 100
	// growAfter accepted queries or batches double a narrowed log range or batch again, up to MaxRange or MaxBatch.
	growAfter = 10
	// scanShare of a scan's deadline goes to reading logs; the rest is kept for headers and the commit.
	scanShare = 0.6
)

// Run one Chain per chain: two at once would race on the cursor.
type Chain struct {
	pool    *pgxpool.Pool
	chainID uint64
	rpc     *rpc.Client
	eth     *ethclient.Client
	// span is the blocks per eth_getLogs call: halved when every endpoint refuses it, grown back after accepted ones.
	span     uint64
	accepted int
	// batchSize is the most calls per batch, kept like span.
	batchSize     int
	batchAccepted int
	receiverMu    sync.Mutex
}

func NewChain(pool *pgxpool.Pool, chainID uint64, client *rpc.Client) *Chain {
	return &Chain{pool: pool, chainID: chainID, rpc: client, eth: ethclient.NewClient(client), span: MaxRange, batchSize: MaxBatch}
}

// The hash is never computed in Go: go-ethereum gets it wrong on Tempo (S-4).
type header struct {
	Number    hexutil.Uint64 `json:"number"`
	Hash      common.Hash    `json:"hash"`
	Timestamp hexutil.Uint64 `json:"timestamp"`
}

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

type logKey struct {
	blockHash string
	index     uint64
}

type pending struct {
	id          int64
	blockNumber uint64
	blockHash   string
	logIndex    uint64
}

// Scan reads from RescanDepth below the last finalized block to latest, in one transaction. Scanning the same range
// again changes nothing.
func (c *Chain) Scan(ctx context.Context) error {
	latest, err := c.eth.BlockNumber(ctx)
	if err != nil {
		return fmt.Errorf("read chain %d latest block: %w", c.chainID, err)
	}
	from, err := c.start(ctx)
	if err != nil {
		return err
	}
	return c.scanRange(ctx, from, min(latest, from+scanChunks*c.span-1), nil, from, from)
}

// scanRange records what it read up to latest, or up to the last whole log range read in scanShare of the deadline,
// but always past must. Ranges read before a provider error are recorded too, and the error returned.
func (c *Chain) scanRange(ctx context.Context, from, latest uint64, recovery *recoveryProgress, walletFrom, must uint64) error {
	invoices, err := c.invoices(ctx)
	if err != nil {
		return err
	}
	wallets, err := c.wallets(ctx)
	if err != nil {
		return err
	}
	logs, walletLogs, next, readErr := c.scanLogs(ctx, from, latest, walletFrom, must, invoices, wallets)
	if next == from && from <= latest { // nothing read; a range already past latest is recorded so recovery completes
		return readErr
	}
	latest = next - 1
	if recovery != nil {
		recovery.next = latest + 1
	}
	open, err := c.pending(ctx, "chain_transfers", 0)
	if err != nil {
		return err
	}
	openWallet, err := c.pending(ctx, "wallet_transfers", 0)
	if err != nil {
		return err
	}

	pendingBlocks := map[uint64]bool{}
	for _, p := range open {
		if p.blockNumber < from && p.blockNumber <= latest {
			pendingBlocks[p.blockNumber] = true
		}
	}
	for _, p := range openWallet {
		if p.blockNumber < walletFrom && p.blockNumber <= latest {
			pendingBlocks[p.blockNumber] = true
		}
	}
	var heights []uint64
	for n := range pendingBlocks {
		heights = append(heights, n)
	}
	slices.Sort(heights)
	for len(heights) > 0 {
		lo, hi, used := heights[0], heights[0], 1
		for used < len(heights) && heights[used]-lo < MaxRange {
			hi = heights[used]
			used++
		}
		pendingInvoices := invoices
		if lo >= from {
			pendingInvoices = nil
		}
		found, foundWallet, _, err := c.scanLogs(ctx, lo, hi, lo, hi, pendingInvoices, wallets)
		if err != nil {
			return errors.Join(readErr, err)
		}
		logs, walletLogs = append(logs, found...), append(walletLogs, foundWallet...)
		heights = heights[used:]
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
	return errors.Join(c.record(ctx, reorgedOf(open), deposits, reorgedOf(openWallet), transfers, final, head, recovery), readErr)
}

// scanLogs reads invoice logs from from and wallet logs from walletFrom, in whole log ranges, and returns the first
// block it did not read. Past must it stops once scanShare of the deadline is used; a failed read stops it anywhere.
func (c *Chain) scanLogs(ctx context.Context, from, latest, walletFrom, must uint64, invoices map[common.Address]receiver,
	wallets wallets) (logs, walletLogs []types.Log, next uint64, err error) {
	began := time.Now()
	deadline, bounded := ctx.Deadline()
	lo := from
	for lo <= latest {
		if bounded && lo > must && time.Since(began) > time.Duration(scanShare*float64(deadline.Sub(began))) {
			break
		}
		hi := min(lo+c.span-1, latest)
		var found, foundWallet []types.Log
		var err error
		if len(invoices) > 0 {
			found, err = c.logs(ctx, lo, hi, invoices)
		}
		if err == nil && hi >= walletFrom {
			foundWallet, err = c.walletLogs(ctx, max(lo, walletFrom), hi, wallets)
		}
		if c.narrow(err) {
			continue
		}
		if err != nil {
			return logs, walletLogs, lo, err
		}
		logs, walletLogs = append(logs, found...), append(walletLogs, foundWallet...)
		lo = hi + 1
	}
	return logs, walletLogs, lo, nil
}

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

// A new chain starts at its finalized block: earlier deposits and wallet transfers are never looked for. Detected rows
// below the start are read at their own heights, so one that never confirms can't hold the scan back.
// ponytail: add a start block to chains if a chain is enabled after invoices on it exist.
func (c *Chain) start(ctx context.Context) (uint64, error) {
	var from int64
	err := c.pool.QueryRow(ctx, `SELECT greatest(last_finalized_block + 1 - $2, 0) FROM chain_cursors WHERE chain_id = $1`,
		c.chainID, min(RescanDepth, c.span)).Scan(&from)
	if errors.Is(err, pgx.ErrNoRows) {
		finalized, _, err := c.headers(ctx, nil)
		return uint64(finalized.Number) + 1, err
	}
	if err != nil {
		return 0, fmt.Errorf("read chain %d cursor: %w", c.chainID, err)
	}
	return uint64(from), nil
}

// A confirmed row may be booked and never changes; a reorged one comes back if its block is canonical again.
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

func (c *Chain) invoices(ctx context.Context) (map[common.Address]receiver, error) {
	// Past MAX_HOLD (30 days after the settle deadline) only the refund authority moves the money: not watching those
	// keeps topic lists bounded. One with a detected deposit stays, or that row would hold every scan's start for good.
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

// scanChunks log ranges at most per scan, so a long backlog is caught up over several scans.
var scanChunks uint64 = 20

// go-ethereum nodes refuse more with "exceed max topics"; a smaller block range doesn't help.
var topicLimit = 1000

func topicParts(addresses []common.Hash) [][]common.Hash {
	var parts [][]common.Hash
	for len(addresses) > topicLimit {
		parts, addresses = append(parts, addresses[:topicLimit]), addresses[topicLimit:]
	}
	return append(parts, addresses)
}

// narrow halves the log range after a refusal and reports that the query should be asked again; growAfter accepted
// queries double it back. The pool already sent a refused query to every endpoint, so no endpoint takes this range.
// Rate limits never narrow it: smaller ranges only mean more requests.
func (c *Chain) narrow(err error) bool {
	switch {
	case err == nil:
		if c.span < MaxRange {
			if c.accepted++; c.accepted >= growAfter {
				c.span, c.accepted = min(2*c.span, MaxRange), 0
			}
		}
	case chain.TooLarge(err) && c.span > 1:
		c.span, c.accepted = c.span/2, 0
		return true
	}
	return false
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

// table is chain_transfers or wallet_transfers.
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

// headers leaves out a block the node doesn't have.
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
	if err := c.batchCall(ctx, batch); err != nil {
		return header{}, nil, fmt.Errorf("read chain %d blocks: %w", c.chainID, err)
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

// record marks reorged rows first, so a re-mined copy of one can be live.
func (c *Chain) record(ctx context.Context, reorged []int64, deposits []deposit, reorgedWallet []int64,
	transfers []walletTransfer, finalized, scanned header, recovery *recoveryProgress) error {
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

	if recovery != nil {
		if recovery.next > recovery.target {
			_, err = tx.Exec(ctx, `UPDATE chain_recoveries SET completed_block = greatest(completed_block, $2),
				next_block = NULL, target_block = NULL, next_at = now() + interval '1 minute' WHERE chain_id = $1`,
				c.chainID, min(recovery.target, uint64(finalized.Number)))
		} else {
			_, err = tx.Exec(ctx, "UPDATE chain_recoveries SET next_block = $2 WHERE chain_id = $1", c.chainID, recovery.next)
		}
		if err != nil {
			return fmt.Errorf("advance chain %d recovery: %w", c.chainID, err)
		}
		return tx.Commit(ctx)
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

func (c *Chain) batchCall(ctx context.Context, batch []rpc.BatchElem) error {
	for offset := 0; offset < len(batch); {
		size := min(c.batchSize, len(batch)-offset)
		part := batch[offset : offset+size]
		var err error
		if size == 1 {
			part[0].Error = nil
			err = c.rpc.CallContext(ctx, part[0].Result, part[0].Method, part[0].Args...)
			var responseError rpc.Error
			if errors.As(err, &responseError) {
				part[0].Error, err = err, nil
			}
		} else {
			err = c.rpc.BatchCallContext(ctx, part)
		}
		limited := chain.BatchTooLarge(err)
		for _, call := range part {
			limited = limited || chain.BatchTooLarge(call.Error)
		}
		if limited && size > 1 {
			c.batchSize, c.batchAccepted = max(1, size/2), 0
			continue
		}
		if err != nil {
			return err
		}
		if c.batchSize < MaxBatch && size == c.batchSize {
			if c.batchAccepted++; c.batchAccepted >= growAfter {
				c.batchSize, c.batchAccepted = min(2*c.batchSize, MaxBatch), 0
			}
		}
		offset += size
	}
	return nil
}
