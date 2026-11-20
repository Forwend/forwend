// Package watcher records Transfer deposits to receive addresses and profile-wallet transfers, then their finality.
package watcher

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"time"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/common/hexutil"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/ethereum/go-ethereum/ethclient"
	"github.com/ethereum/go-ethereum/rpc"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	// MaxRange is the most blocks one eth_getLogs covers; a range every endpoint refuses halves, down to receipts.
	MaxRange = 2000
	// RescanDepth finalized blocks are read again every scan, so one empty eth_getLogs answer is never the last look.
	RescanDepth = MaxRange
	MaxBatch    = 100
	// growAfter accepted queries or batches double a narrowed log range or batch again, up to MaxRange or MaxBatch.
	growAfter = 10
	// scanShare of a scan's deadline goes to reading logs; the rest is kept for headers and the commit.
	scanShare = 0.6
)

// Run one Chain per chain: two at once would race on the cursor.
type Chain struct {
	pool          *pgxpool.Pool
	chainID       uint64
	rpc           *rpc.Client
	eth           *ethclient.Client
	span          uint64
	accepted      int
	batchSize     int
	batchAccepted int
}

func NewChain(pool *pgxpool.Pool, chainID uint64, client *rpc.Client) *Chain {
	return &Chain{pool: pool, chainID: chainID, rpc: client, eth: ethclient.NewClient(client), span: MaxRange, batchSize: MaxBatch}
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

// Scan reads from RescanDepth below the last finalized block to latest, in one transaction; it is idempotent.
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

// scanRange records what it read up to latest, or the last whole range read in scanShare of the deadline, always
// past must; ranges read before a provider error are recorded too.
func (c *Chain) scanRange(ctx context.Context, from, latest uint64, recovery *recoveryProgress, walletFrom, must uint64) error {
	invoices, err := c.invoices(ctx)
	if err != nil {
		return err
	}
	receivers, err := c.holding(ctx, invoices)
	if err != nil {
		return err
	}
	wallets, err := c.wallets(ctx)
	if err != nil {
		return err
	}
	logs, walletLogs, outflowLogs, next, readErr := c.scanLogs(ctx, from, latest, walletFrom, must, invoices, receivers, wallets)
	if next == from && from <= latest { // nothing read; a range already past latest is recorded so recovery completes
		return readErr
	}
	latest = next - 1
	if recovery != nil {
		recovery.next = latest + 1
	}
	open, err := c.pending(ctx, "chain_transfers")
	if err != nil {
		return err
	}
	openWallet, err := c.pending(ctx, "wallet_transfers")
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
		pendingInvoices, pendingReceivers := invoices, receivers
		if lo >= from {
			pendingInvoices, pendingReceivers = nil, nil
		}
		found, foundWallet, foundOutflows, _, err := c.scanLogs(ctx, lo, hi, lo, hi, pendingInvoices, pendingReceivers, wallets)
		if err != nil {
			return errors.Join(readErr, err)
		}
		logs, walletLogs = append(logs, found...), append(walletLogs, foundWallet...)
		outflowLogs = append(outflowLogs, foundOutflows...)
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
	for _, l := range outflowLogs {
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
	outflows, err := c.outflows(ctx, outflowLogs, headers, receivers, finalized)
	if err != nil {
		return errors.Join(readErr, err)
	}
	deployed, err := c.deployTimes(ctx, outflows, finalized)
	if err != nil {
		return errors.Join(readErr, err)
	}
	transfers := wallets.transfers(walletLogs, openWallet, headers, finalized, seen)
	// A detected row is reorged only when the chain shows another block at its height: a missing log proves nothing.
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
	// The cursor's finalized block never passes what this scan read; its time is that block's, for expiry.
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
	return errors.Join(c.record(ctx, reorgedOf(open), deposits, reorgedOf(openWallet), transfers, outflows, deployed, final, head,
		recovery), readErr)
}

// scanLogs reads deposits and receivers' events from from and wallet logs from walletFrom, in whole log ranges;
// past must it stops at scanShare of the deadline, and a failed read stops it anywhere.
func (c *Chain) scanLogs(ctx context.Context, from, latest, walletFrom, must uint64, invoices, receivers map[common.Address]receiver,
	wallets wallets) (logs, walletLogs, outflowLogs []types.Log, next uint64, err error) {
	began := time.Now()
	deadline, bounded := ctx.Deadline()
	lo := from
	for lo <= latest {
		if bounded && lo > must && time.Since(began) > time.Duration(scanShare*float64(deadline.Sub(began))) {
			break
		}
		hi := min(lo+c.span-1, latest)
		var found, foundWallet, foundOutflows []types.Log
		var err error
		if len(invoices) > 0 {
			found, err = c.logs(ctx, lo, hi, invoices)
		}
		if err == nil && len(receivers) > 0 {
			foundOutflows, err = c.outflowLogs(ctx, lo, hi, receivers)
		}
		if err == nil && hi >= walletFrom {
			foundWallet, err = c.walletLogs(ctx, max(lo, walletFrom), hi, wallets)
		}
		if c.narrow(err) {
			continue
		}
		if err != nil {
			return logs, walletLogs, outflowLogs, lo, err
		}
		logs, walletLogs = append(logs, found...), append(walletLogs, foundWallet...)
		outflowLogs = append(outflowLogs, foundOutflows...)
		lo = hi + 1
	}
	return logs, walletLogs, outflowLogs, lo, nil
}

// A new chain starts at its finalized block: earlier deposits are never looked for.
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

// scanChunks log ranges at most per scan, so a long backlog is caught up over several scans.
var scanChunks uint64 = 20

// table is chain_transfers or wallet_transfers.
func (c *Chain) pending(ctx context.Context, table string) ([]pending, error) {
	rows, err := c.pool.Query(ctx, `SELECT id, block_number, block_hash, log_index FROM `+table+`
		WHERE chain_id = $1 AND status = 'detected'`, c.chainID)
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

// record marks reorged rows first, so a re-mined copy of one can be live.
func (c *Chain) record(ctx context.Context, reorged []int64, deposits []deposit, reorgedWallet []int64,
	transfers []walletTransfer, outflows []Outflow, deployed map[string]uint64, finalized, scanned header,
	recovery *recoveryProgress) error {
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
	if err := recordDeployTimes(ctx, tx, deployed); err != nil {
		return err
	}
	if err := RecordOutflows(ctx, tx, c.chainID, outflows); err != nil {
		return err
	}
	if err := c.recordWalletTransfers(ctx, tx, transfers); err != nil {
		return err
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
