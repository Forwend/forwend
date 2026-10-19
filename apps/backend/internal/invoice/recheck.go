package invoice

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"math/big"
	"time"

	"github.com/ensp1re/forwend/apps/backend/internal/chain"
	"github.com/ensp1re/forwend/apps/backend/internal/ledger"
	"github.com/jackc/pgx/v5"
)

// RecheckEvery spaces the checks of one invoice, across api replicas (R-55).
const RecheckEvery = 5 * time.Minute

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
	// Unreadable lists the chains of options whose RPC did not answer; the others were still checked.
	Unreadable []uint64
}

// Recheck reads the invoice's receive addresses on chain (every option's until one has money) and, for each that holds
// more than its recorded transfers, asks the worker to rescan it (D-77). It reads only: it never signs, never books
// and never moves a cursor. allow runs only for an invoice due a check, so unknown ids never spend the shared budget;
// it gets the invoice's owner, so one owner's invoices can be given a share of it.
func (s *Service) Recheck(ctx context.Context, payToken string, balanceOf ledger.BalanceOf,
	allow func(owner string) time.Duration) (Recheck, error) {
	inv, err := s.Get(ctx, payToken)
	if err != nil {
		return Recheck{}, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return Recheck{}, fmt.Errorf("start invoice %s check: %w", inv.ID, err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	var checked time.Time
	err = tx.QueryRow(ctx, `INSERT INTO invoice_rechecks (invoice_id) VALUES ($1)
		ON CONFLICT (invoice_id) DO UPDATE SET checked_at = now()
		WHERE invoice_rechecks.checked_at <= now() - make_interval(secs => $2)
		RETURNING checked_at`, inv.ID, RecheckEvery.Seconds()).Scan(&checked)
	if errors.Is(err, pgx.ErrNoRows) {
		var wait time.Duration
		if err := tx.QueryRow(ctx, `SELECT greatest(checked_at + make_interval(secs => $2) - now(), interval '0')
			FROM invoice_rechecks WHERE invoice_id = $1`, inv.ID, RecheckEvery.Seconds()).Scan(&wait); err != nil {
			return Recheck{}, fmt.Errorf("read invoice %s last check: %w", inv.ID, err)
		}
		return Recheck{}, &TooSoonError{Wait: wait}
	}
	if err != nil {
		return Recheck{}, fmt.Errorf("start invoice %s check: %w", inv.ID, err)
	}
	var owner string
	if err := tx.QueryRow(ctx, "SELECT p.user_id::text FROM invoices i JOIN profiles p ON p.id = i.profile_id WHERE i.id = $1",
		inv.ID).Scan(&owner); err != nil {
		return Recheck{}, fmt.Errorf("read invoice %s owner: %w", inv.ID, err)
	}
	// The rollback keeps the last check time, so a payer refused here may press again soon.
	if wait := allow(owner); wait > 0 {
		return Recheck{}, &TooSoonError{Wait: wait}
	}
	if err := tx.Commit(ctx); err != nil {
		return Recheck{}, fmt.Errorf("start invoice %s check: %w", inv.ID, err)
	}
	// Before an option has money the payer may have paid any of them; after, only the chosen one takes payments.
	var found Recheck
	var unreadable []uint64
	var lastErr error
	for _, o := range inv.Options {
		if inv.OptionLocked && o.ID != inv.OptionID {
			continue
		}
		r, err := s.recheckOption(ctx, o, balanceOf)
		if errors.Is(err, ErrChainUnavailable) {
			// One network down must not hide what the others show.
			slog.Warn("check status skipped an option", "invoice", inv.ID, "option", o.ID, "err", err)
			unreadable, lastErr = append(unreadable, o.ChainID), err
			continue
		}
		if err != nil {
			return Recheck{}, err
		}
		// What the page shows: an option holding more than recorded, else the current option. Another option's empty
		// read never stands in for the current one: the page names the current option's network.
		if (o.ID == inv.OptionID && (found.OnChain == nil || found.OnChain.Cmp(found.Recorded) <= 0)) ||
			r.OnChain.Cmp(r.Recorded) > 0 {
			found = r
		}
	}
	if found.OnChain == nil {
		return Recheck{}, lastErr
	}
	found.NextAt, found.Unreadable = checked.Add(RecheckEvery).UTC(), unreadable
	return found, nil
}

// recheckOption reads one option's receive address and asks for its rescan when it holds more than recorded.
func (s *Service) recheckOption(ctx context.Context, o Option, balanceOf ledger.BalanceOf) (Recheck, error) {
	onChain, _, err := balanceOf(ctx, o.ChainID, o.Token, o.ReceiveAddress)
	if err != nil {
		// Redacted: an RPC error can carry the provider URL with its key.
		return Recheck{}, fmt.Errorf("%w: read invoice %s balance: %s", ErrChainUnavailable, o.ID, chain.Redact(err))
	}
	// The main row's check is already there; an option gets its own row to hold its rescan.
	if _, err := s.pool.Exec(ctx, "INSERT INTO invoice_rechecks (invoice_id) VALUES ($1) ON CONFLICT DO NOTHING",
		o.ID); err != nil {
		return Recheck{}, fmt.Errorf("start invoice %s check: %w", o.ID, err)
	}
	var recordedText string
	var rescanning, recentlyRescanned bool
	err = s.pool.QueryRow(ctx, `
		SELECT coalesce((SELECT sum(amount) FROM chain_transfers WHERE invoice_id = $1 AND status <> 'reorged'), 0)::text,
		       rescan_requested_at IS NOT NULL,
		       coalesce(rescanned_at > now() - make_interval(secs => $2), false)
		FROM invoice_rechecks WHERE invoice_id = $1`, o.ID, RescanAgainAfter.Seconds()).
		Scan(&recordedText, &rescanning, &recentlyRescanned)
	if err != nil {
		return Recheck{}, fmt.Errorf("read invoice %s recorded transfers: %w", o.ID, err)
	}
	recorded, _ := new(big.Int).SetString(recordedText, 10)
	if onChain.Cmp(recorded) > 0 && !rescanning && !recentlyRescanned {
		if _, err := s.pool.Exec(ctx, `UPDATE invoice_rechecks SET rescan_requested_at = now(), rescan_from_block = NULL
			WHERE invoice_id = $1`, o.ID); err != nil {
			return Recheck{}, fmt.Errorf("ask for invoice %s rescan: %w", o.ID, err)
		}
		rescanning = true
	}
	return Recheck{OnChain: onChain, Recorded: recorded, Rescanning: rescanning}, nil
}
