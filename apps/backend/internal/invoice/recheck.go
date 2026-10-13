package invoice

import (
	"context"
	"errors"
	"fmt"
	"math/big"
	"time"

	"github.com/ensp1re/forwend/apps/backend/internal/chain"
	"github.com/ensp1re/forwend/apps/backend/internal/ledger"
	"github.com/jackc/pgx/v5"
)

// RecheckEvery spaces the checks of one invoice, across api replicas (R-55).
const RecheckEvery = 30 * time.Second

// RescanAgainAfter is how long a finished rescan stands before a check may ask for another: money that no log explains
// (Arc native USDC, docs/backend/money-safety.md) must not start a full rescan on every press.
const RescanAgainAfter = 10 * time.Minute

// ErrChainUnavailable means the chain's RPC could not answer; the caller may try again shortly.
var ErrChainUnavailable = errors.New("chain unavailable")

// TooSoonError is a recheck asked for within RecheckEvery of the last one.
type TooSoonError struct{ Wait time.Duration }

func (e *TooSoonError) Error() string { return fmt.Sprintf("checked recently: wait %s", e.Wait) }

// Recheck is what one check found: the receive address's finalized balance, what transfers recorded, whether the
// worker rescans the address for the difference, and when the next check is allowed.
type Recheck struct {
	OnChain, Recorded *big.Int
	Rescanning        bool
	NextAt            time.Time
}

// Recheck reads the invoice's receive address on chain and, when it holds more than the recorded transfers, asks the
// worker to rescan it (D-77). It reads only: it never signs, never books and never moves a cursor.
func (s *Service) Recheck(ctx context.Context, id string, balanceOf ledger.BalanceOf) (Recheck, error) {
	inv, err := s.Get(ctx, id)
	if err != nil {
		return Recheck{}, err
	}
	var checked time.Time
	err = s.pool.QueryRow(ctx, `INSERT INTO invoice_rechecks (invoice_id) VALUES ($1)
		ON CONFLICT (invoice_id) DO UPDATE SET checked_at = now()
		WHERE invoice_rechecks.checked_at <= now() - make_interval(secs => $2)
		RETURNING checked_at`, inv.ID, RecheckEvery.Seconds()).Scan(&checked)
	if errors.Is(err, pgx.ErrNoRows) {
		var wait time.Duration
		if err := s.pool.QueryRow(ctx, `SELECT greatest(checked_at + make_interval(secs => $2) - now(), interval '0')
			FROM invoice_rechecks WHERE invoice_id = $1`, inv.ID, RecheckEvery.Seconds()).Scan(&wait); err != nil {
			return Recheck{}, fmt.Errorf("read invoice %s last check: %w", inv.ID, err)
		}
		return Recheck{}, &TooSoonError{Wait: wait}
	}
	if err != nil {
		return Recheck{}, fmt.Errorf("start invoice %s check: %w", inv.ID, err)
	}
	onChain, _, err := balanceOf(ctx, inv.ChainID, inv.Token, inv.ReceiveAddress)
	if err != nil {
		// Redacted: an RPC error can carry the provider URL with its key.
		return Recheck{}, fmt.Errorf("%w: read invoice %s balance: %s", ErrChainUnavailable, inv.ID, chain.Redact(err))
	}
	var recordedText string
	var rescanning, recentlyRescanned bool
	err = s.pool.QueryRow(ctx, `
		SELECT coalesce((SELECT sum(amount) FROM chain_transfers WHERE invoice_id = $1 AND status <> 'reorged'), 0)::text,
		       rescan_requested_at IS NOT NULL,
		       coalesce(rescanned_at > now() - make_interval(secs => $2), false)
		FROM invoice_rechecks WHERE invoice_id = $1`, inv.ID, RescanAgainAfter.Seconds()).
		Scan(&recordedText, &rescanning, &recentlyRescanned)
	if err != nil {
		return Recheck{}, fmt.Errorf("read invoice %s recorded transfers: %w", inv.ID, err)
	}
	recorded, _ := new(big.Int).SetString(recordedText, 10)
	if onChain.Cmp(recorded) > 0 && !rescanning && !recentlyRescanned {
		if _, err := s.pool.Exec(ctx, `UPDATE invoice_rechecks SET rescan_requested_at = now(), rescan_from_block = NULL
			WHERE invoice_id = $1`, inv.ID); err != nil {
			return Recheck{}, fmt.Errorf("ask for invoice %s rescan: %w", inv.ID, err)
		}
		rescanning = true
	}
	return Recheck{OnChain: onChain, Recorded: recorded, Rescanning: rescanning, NextAt: checked.Add(RecheckEvery).UTC()}, nil
}
