package job

import (
	"bytes"
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
)

// ProposeChange adds a scope change to the profile's accepted job (R-105): a payment at the end of its schedule that
// the client accepts by the job's link. It is made once per (job, idempotency key): created is false when the same
// request was already made, and another request under the key is ErrConflict.
func (s *Service) ProposeChange(ctx context.Context, profileID, id, key string, r PaymentRequest) (Job, bool, error) {
	if !jobID.MatchString(id) {
		return Job{}, false, ErrNotFound
	}
	if r.OnAccept {
		return Job{}, false, fmt.Errorf("%w: a change is never the deposit", ErrInvalid)
	}
	cents, err := checkPayments([]PaymentRequest{r})
	if err != nil {
		return Job{}, false, err
	}
	hash := sha256.Sum256(fmt.Appendf(nil, "%q|%d|%d", r.Title, cents[0], r.DueDays))
	created := false
	err = pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		// The job row lock orders proposals, withdrawals and the client's accept of the job.
		var accepted bool
		err := tx.QueryRow(ctx, "SELECT accepted_at IS NOT NULL FROM jobs WHERE id = $1 AND profile_id = $2 FOR UPDATE",
			id, profileID).Scan(&accepted)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		} else if err != nil {
			return fmt.Errorf("lock job %s: %w", id, err)
		}
		var stored []byte
		err = tx.QueryRow(ctx, "SELECT change_hash FROM job_payments WHERE job_id = $1 AND change_key = $2", id,
			key).Scan(&stored)
		if err == nil {
			if !bytes.Equal(stored, hash[:]) {
				return ErrConflict
			}
			return nil
		} else if !errors.Is(err, pgx.ErrNoRows) {
			return fmt.Errorf("read job %s change: %w", id, err)
		}
		if !accepted {
			return ErrNotAccepted
		}
		var pending bool
		if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM job_payments WHERE job_id = $1 AND proposed_at IS NOT NULL
			AND accepted_at IS NULL)`, id).Scan(&pending); err != nil {
			return fmt.Errorf("read job %s changes: %w", id, err)
		}
		if pending {
			return ErrChangePending
		}
		var last int
		if err := tx.QueryRow(ctx, "SELECT max(position) FROM job_payments WHERE job_id = $1", id).Scan(&last); err != nil {
			return fmt.Errorf("read job %s payments: %w", id, err)
		}
		if last >= MaxPayments {
			return fmt.Errorf("%w: a job has at most %d payments", ErrInvalid, MaxPayments)
		}
		if _, err := tx.Exec(ctx, `INSERT INTO job_payments (job_id, position, title, amount_cents, due_days, on_accept,
			proposed_at, change_key, change_hash) VALUES ($1, $2, $3, $4, $5, false, now(), $6, $7)`,
			id, last+1, r.Title, cents[0], r.DueDays, key, hash[:]); err != nil {
			return fmt.Errorf("add job %s change: %w", id, err)
		}
		created = true
		return nil
	})
	if err != nil {
		return Job{}, false, err
	}
	j, err := s.Get(ctx, profileID, id)
	return j, created, err
}

// AcceptChange records the client's acceptance of the change at position on the job its link names (R-105), with
// their typed name and email, once; an accepted change answers the same. proposedAt is the change as the client read
// it, to the microsecond the database keeps, so consent never lands on another change at that position: one withdrawn
// and replaced is ErrNotFound, as is a position that is not a change.
func (s *Service) AcceptChange(ctx context.Context, token string, position int, proposedAt time.Time, name,
	email string) (Job, error) {
	if err := checkTyped(name, email); err != nil {
		return Job{}, err
	}
	j, err := s.ByToken(ctx, token)
	if err != nil {
		return Job{}, err
	}
	if position < 1 || position > len(j.Payments) || !j.Payments[position-1].ProposedAt.Equal(proposedAt) {
		return Job{}, ErrNotFound
	}
	if !j.Payments[position-1].AcceptedAt.IsZero() {
		return j, nil
	}
	if _, err := s.pool.Exec(ctx, `UPDATE job_payments SET accepted_name = $4, accepted_email = $5, accepted_at = now()
		WHERE job_id = $1 AND position = $2 AND proposed_at = $3 AND accepted_at IS NULL`,
		j.ID, position, proposedAt, name, email); err != nil {
		return Job{}, fmt.Errorf("accept job %s change: %w", j.ID, err)
	}
	j, err = s.ByToken(ctx, token)
	if err == nil && (position > len(j.Payments) || !j.Payments[position-1].ProposedAt.Equal(proposedAt)) {
		return Job{}, ErrNotFound
	}
	return j, err
}

// WithdrawChange removes the profile's job's change at position while the client has not accepted it (R-105). Only
// the last payment can go, so the schedule stays in order with no gap.
func (s *Service) WithdrawChange(ctx context.Context, profileID, id string, position int) error {
	if !jobID.MatchString(id) {
		return ErrNotFound
	}
	return pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		var one int
		err := tx.QueryRow(ctx, "SELECT 1 FROM jobs WHERE id = $1 AND profile_id = $2 FOR UPDATE", id, profileID).Scan(&one)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		} else if err != nil {
			return fmt.Errorf("lock job %s: %w", id, err)
		}
		tag, err := tx.Exec(ctx, `DELETE FROM job_payments WHERE job_id = $1 AND position = $2 AND proposed_at IS NOT NULL
			AND accepted_at IS NULL AND invoice_id IS NULL
			AND position = (SELECT max(position) FROM job_payments WHERE job_id = $1)`, id, position)
		if err != nil {
			return fmt.Errorf("withdraw job %s change: %w", id, err)
		}
		if tag.RowsAffected() == 1 {
			return nil
		}
		var found bool
		if err := tx.QueryRow(ctx, "SELECT EXISTS (SELECT 1 FROM job_payments WHERE job_id = $1 AND position = $2)",
			id, position).Scan(&found); err != nil {
			return fmt.Errorf("read job %s payment: %w", id, err)
		}
		if !found {
			return ErrNotFound
		}
		return ErrNotWithdrawable
	})
}
