package watcher

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/forwend/forwend/apps/backend/internal/chain"
	"github.com/jackc/pgx/v5"
)

// RescanLimit bounds rescans per chain per round, so Check status calls take a bounded share of RPC budget (R-55).
const RescanLimit = 5

// rescanChunks log ranges at most per invoice per round.
const rescanChunks = 5

// Rescans never moves the chain's cursor: that would let the regular scan skip blocks for the other invoices. An
// invoice past watchedAfterDeadline is not rescanned: its money is the refund authority's.
func (c *Chain) Rescans(ctx context.Context) error {
	if _, err := c.pool.Exec(ctx, `UPDATE invoice_rechecks r SET rescan_requested_at = NULL, rescan_from_block = NULL,
		    rescanned_at = now()
		FROM invoices i WHERE i.id = r.invoice_id AND i.chain_id = $1 AND r.rescan_requested_at IS NOT NULL
		  AND i.settle_deadline <= extract(epoch FROM now())::bigint - $2`,
		c.chainID, int64(watchedAfterDeadline/time.Second)); err != nil {
		return fmt.Errorf("drop chain %d rescans outside the watch window: %w", c.chainID, err)
	}
	// A minute before creation: the database's clock and the chain's block times can differ a little.
	rows, err := c.pool.Query(ctx, `SELECT r.invoice_id, i.receive_address, i.token_contract, r.rescan_from_block,
		    floor(extract(epoch FROM i.created_at))::bigint - 60
		FROM invoice_rechecks r JOIN invoices i ON i.id = r.invoice_id
		WHERE i.chain_id = $1 AND r.rescan_requested_at IS NOT NULL
          AND (r.rescan_retry_at IS NULL OR r.rescan_retry_at <= now()) ORDER BY r.rescan_requested_at LIMIT $2`,
		c.chainID, RescanLimit)
	if err != nil {
		return fmt.Errorf("read chain %d rescans: %w", c.chainID, err)
	}
	type ask struct {
		id, receive, token string
		from               *int64
		created            int64
	}
	asks, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (ask, error) {
		var a ask
		return a, row.Scan(&a.id, &a.receive, &a.token, &a.from, &a.created)
	})
	if err != nil {
		return fmt.Errorf("read chain %d rescans: %w", c.chainID, err)
	}
	// One invoice that keeps failing must not hold up the others queued behind it.
	var failed []error
	for _, a := range asks {
		if err := c.rescanOne(ctx, a.id, a.receive, a.token, a.from, a.created); err != nil {
			failed = append(failed, err)
			retryCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 3*time.Second)
			_, retryErr := c.pool.Exec(retryCtx, "UPDATE invoice_rechecks SET rescan_retry_at=now()+interval '1 minute' WHERE invoice_id=$1", a.id)
			cancel()
			failed = append(failed, retryErr)
		}
	}
	return errors.Join(failed...)
}

func (c *Chain) rescanOne(ctx context.Context, id, receive, token string, saved *int64, created int64) error {
	var from uint64
	if saved != nil {
		from = uint64(*saved)
	} else {
		var err error
		if from, err = c.blockAt(ctx, uint64(max(created, 0))); err != nil {
			return err
		}
		if _, err := c.pool.Exec(ctx, "UPDATE invoice_rechecks SET rescan_from_block=$2 WHERE invoice_id=$1", id, from); err != nil {
			return fmt.Errorf("save invoice %s rescan start: %w", id, err)
		}
	}
	next, done, err := c.rescan(ctx, common.HexToAddress(receive), receiver{id, token}, from)
	if chain.Missing(err) {
		// An invoice older than the history the RPCs keep: its rescan moves past the pruned blocks (R-191).
		kept, ok, prunedErr := c.pruned(ctx, from)
		if prunedErr != nil || !ok {
			return errors.Join(err, prunedErr)
		}
		slog.Warn("rescan skips blocks no RPC keeps any more", "invoice", id, "chain", c.chainID, "from", from, "to", kept-1)
		next, done, err = kept, false, nil
	}
	if err != nil {
		return err
	}
	if done {
		_, err = c.pool.Exec(ctx, `UPDATE invoice_rechecks SET rescan_requested_at = NULL, rescan_from_block = NULL,
			rescanned_at = now(), rescan_retry_at=NULL WHERE invoice_id = $1`, id)
	} else {
		_, err = c.pool.Exec(ctx, "UPDATE invoice_rechecks SET rescan_from_block = $2, rescan_retry_at=NULL WHERE invoice_id = $1", id, next)
	}
	if err != nil {
		return fmt.Errorf("save invoice %s rescan: %w", id, err)
	}
	return nil
}

func (c *Chain) rescan(ctx context.Context, addr common.Address, inv receiver, from uint64) (next uint64, done bool, err error) {
	latest, err := c.eth.BlockNumber(ctx)
	if err != nil {
		return 0, false, fmt.Errorf("read chain %d latest block: %w", c.chainID, err)
	}
	hi := min(latest, from+rescanChunks*c.span-1)
	invoices := map[common.Address]receiver{addr: inv}
	found, err := c.logsIn(ctx, from, hi, invoices)
	if err != nil {
		return 0, false, err
	}
	numbers := []uint64{}
	for _, l := range found {
		numbers = append(numbers, l.BlockNumber)
	}
	final, headers, err := c.headers(ctx, numbers)
	if err != nil {
		return 0, false, err
	}
	deposits, _ := depositsOf(found, headers, invoices, uint64(final.Number))
	tx, err := c.pool.Begin(ctx)
	if err != nil {
		return 0, false, fmt.Errorf("record invoice %s rescan: %w", inv.invoiceID, err)
	}
	defer tx.Rollback(ctx)
	if err := c.insertDeposits(ctx, tx, deposits); err != nil {
		return 0, false, err
	}
	if err := tx.Commit(ctx); err != nil {
		return 0, false, fmt.Errorf("record invoice %s rescan: %w", inv.invoiceID, err)
	}
	return hi + 1, hi >= latest, nil
}

func (c *Chain) logsIn(ctx context.Context, lo, hi uint64, invoices map[common.Address]receiver) ([]types.Log, error) {
	var out []types.Log
	for lo <= hi {
		top := min(lo+c.span-1, hi)
		found, err := c.logs(ctx, lo, top, invoices)
		if c.narrow(err) {
			continue
		}
		if err != nil {
			return nil, err
		}
		out = append(out, found...)
		lo = top + 1
	}
	return out, nil
}

// blockAt is the first block at or after Unix time t: about log2(latest) header reads, done once per rescan.
func (c *Chain) blockAt(ctx context.Context, t uint64) (uint64, error) {
	latest, err := c.eth.BlockNumber(ctx)
	if err != nil {
		return 0, fmt.Errorf("read chain %d latest block: %w", c.chainID, err)
	}
	lo, hi := uint64(0), latest
	for lo < hi {
		mid := lo + (hi-lo)/2
		_, headers, err := c.headers(ctx, []uint64{mid})
		if err != nil {
			return 0, err
		}
		h, ok := headers[mid]
		if !ok {
			return 0, errors.New("read chain block for a rescan: not found")
		}
		if uint64(h.Timestamp) < t {
			lo = mid + 1
		} else {
			hi = mid
		}
	}
	return lo, nil
}
