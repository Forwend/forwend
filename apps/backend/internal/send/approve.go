package send

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// Submit records the browser's hash; only an approved send takes one, or a hash could explain away a theft.
func (s *Service) Submit(ctx context.Context, profileID, sendID, txHash string) (Send, error) {
	txHash = strings.ToLower(txHash)
	if !hashPattern.MatchString(txHash) {
		return Send{}, fmt.Errorf("%w: txHash is not a transaction hash", ErrInvalid)
	}
	out, err := scan(s.pool.QueryRow(ctx, `
		UPDATE sends SET status = 'submitted', tx_hash = $3, submitted_at = now(), finished_at = NULL
		WHERE id::text = $1 AND profile_id = $2 AND approved_at IS NOT NULL AND status IN ('approved', 'expired')
		  AND fee_asset IS NULL
		RETURNING `+columns,
		strings.ToLower(sendID), profileID, txHash))
	if errors.Is(err, pgx.ErrNoRows) {
		out, err = s.Get(ctx, profileID, sendID)
		if err != nil {
			return Send{}, err
		}
		if out.TxHash == nil || *out.TxHash != txHash {
			return Send{}, fmt.Errorf("%w: this send can't take a hash now", ErrInvalid)
		}
		return out, nil
	} else if pgErr := (*pgconn.PgError)(nil); errors.As(err, &pgErr) && pgErr.ConstraintName == "sends_tx" {
		return Send{}, fmt.Errorf("%w: this hash belongs to another send", ErrInvalid)
	} else if err != nil {
		return Send{}, fmt.Errorf("submit send: %w", err)
	}
	return out, nil
}

// Approve lets the browser sign a prepared send once (then ErrApproved), so one summary is never signed twice.
func (s *Service) Approve(ctx context.Context, profileID, sendID string) (Send, error) {
	out, err := s.Get(ctx, profileID, sendID)
	if err != nil {
		return Send{}, err
	}
	if out.Status == Approved {
		return Send{}, ErrApproved
	}
	if out.Status != Prepared {
		return out, nil
	}
	approved, err := scan(s.pool.QueryRow(ctx, `UPDATE sends SET status = 'approved', approved_at = now()
		WHERE id = $1 AND status = 'prepared' RETURNING `+columns, out.ID))
	if errors.Is(err, pgx.ErrNoRows) { // approved, given up or replaced since the read
		if out, err = s.Get(ctx, profileID, sendID); err == nil && out.Status == Approved {
			return Send{}, ErrApproved
		}
		return out, err
	} else if err != nil {
		return Send{}, fmt.Errorf("approve send: %w", err)
	}
	approved.Gas, approved.NetworkFee = out.Gas, out.NetworkFee
	if approved.FeeAsset != nil {
		r, err := s.relayRequest(approved)
		if err != nil {
			return Send{}, err
		}
		approved.Relay = &r
	}
	return approved, nil
}

func (s *Service) Cancel(ctx context.Context, profileID, sendID string) error {
	tag, err := s.pool.Exec(ctx, `UPDATE sends SET status = 'canceled', finished_at = now()
		WHERE id::text = $1 AND profile_id = $2 AND status = 'prepared'`, strings.ToLower(sendID), profileID)
	if err != nil {
		return fmt.Errorf("cancel send: %w", err)
	}
	if tag.RowsAffected() == 0 {
		if _, err := s.Get(ctx, profileID, sendID); err != nil {
			return err
		}
		return fmt.Errorf("%w: only an unsigned send can be canceled", ErrInvalid)
	}
	return nil
}
