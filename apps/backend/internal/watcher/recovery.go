package watcher

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"slices"
	"strings"

	"github.com/jackc/pgx/v5"
)

type recoveryProgress struct {
	next, target uint64
}

// recoveryChunks log ranges at most per recovery round.
const recoveryChunks = 5

// ScanNew follows new wallet blocks and rechecks detected transfers. Invoice overlap stays frequent for payment ordering.
func (c *Chain) ScanNew(ctx context.Context) error {
	var scanned, finalized uint64
	err := c.pool.QueryRow(ctx, "SELECT last_scanned_block, last_finalized_block FROM chain_cursors WHERE chain_id = $1",
		c.chainID).Scan(&scanned, &finalized)
	if errors.Is(err, pgx.ErrNoRows) {
		return c.Scan(ctx)
	}
	if err != nil {
		return fmt.Errorf("read chain %d scan cursor: %w", c.chainID, err)
	}
	if err := c.prepareRecovery(ctx); err != nil {
		return err
	}
	latest, err := c.eth.BlockNumber(ctx)
	if err != nil {
		return fmt.Errorf("read chain %d latest block: %w", c.chainID, err)
	}
	from, err := c.start(ctx)
	if err != nil {
		return err
	}
	walletFrom := scanned + 1
	if latest < scanned {
		walletFrom = from
	}
	// Always past the old cursor, so a scan short of time still moves it.
	return c.scanRange(ctx, from, min(latest, from+scanChunks*c.span-1), nil, walletFrom, finalized+1)
}

func (c *Chain) prepareRecovery(ctx context.Context) error {
	_, err := c.pool.Exec(ctx, `INSERT INTO chain_recoveries (chain_id, completed_block)
		SELECT chain_id, last_finalized_block FROM chain_cursors WHERE chain_id = $1
		ON CONFLICT DO NOTHING`, c.chainID)
	return err
}

// Recover pins its range before reading it. Its checkpoint survives fast scans, failures and restarts.
func (c *Chain) Recover(ctx context.Context) error {
	if err := c.prepareRecovery(ctx); err != nil {
		return err
	}
	wallets, err := c.wallets(ctx)
	if err != nil {
		return err
	}
	var subscriptions []string
	for a := range wallets.addresses {
		subscriptions = append(subscriptions, "wallet/"+a.Hex())
	}
	for t, enabled := range wallets.tokens {
		if enabled {
			subscriptions = append(subscriptions, "token/"+t.Hex())
		}
	}
	slices.Sort(subscriptions)
	hash := sha256.Sum256([]byte(strings.Join(subscriptions, "\n")))
	signature := hex.EncodeToString(hash[:])
	var completed uint64
	var next, target *uint64
	var due bool
	var previous string
	err = c.pool.QueryRow(ctx, `SELECT completed_block, next_block, target_block, next_at <= now(), subscriptions
		FROM chain_recoveries WHERE chain_id = $1`, c.chainID).Scan(&completed, &next, &target, &due, &previous)
	if err != nil {
		return fmt.Errorf("read chain %d recovery: %w", c.chainID, err)
	}
	if next == nil && !due && previous == signature {
		return nil
	}
	if next == nil || previous != signature {
		latest, err := c.eth.BlockNumber(ctx)
		if err != nil {
			return err
		}
		from := uint64(max(int64(completed)+1-RescanDepth, 0))
		if next != nil {
			from = *next
		}
		if target != nil {
			latest = max(latest, *target)
		}
		// A newly watched wallet/token gets the same overlap as its first full scan.
		if previous != signature {
			var finalized uint64
			if err := c.pool.QueryRow(ctx, "SELECT last_finalized_block FROM chain_cursors WHERE chain_id = $1", c.chainID).Scan(&finalized); err != nil {
				return err
			}
			from = min(from, uint64(max(int64(finalized)+1-RescanDepth, 0)))
		}
		if _, err := c.pool.Exec(ctx, `UPDATE chain_recoveries SET next_block = $2, target_block = $3, subscriptions = $4
			WHERE chain_id = $1`, c.chainID, from, latest, signature); err != nil {
			return err
		}
		next, target = &from, &latest
	}
	end := min(*target, *next+recoveryChunks*c.span-1)
	return c.scanRange(ctx, *next, end, &recoveryProgress{next: end + 1, target: *target}, *next, *next)
}
