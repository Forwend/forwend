package job

import (
	"bytes"
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"time"

	"github.com/forwend/forwend/apps/backend/internal/invoice"
	"github.com/forwend/forwend/apps/backend/internal/outbox"
	"github.com/jackc/pgx/v5"
)

// Per job in 24 hours (R-107), so proposing and withdrawing again and again can't flood the client.
// outbox.MaxClientEmails caps all the user's client emails (R-116): the owner can accept their own link.
const MaxChangeEmails = 5

// ProposeChange (R-105) is idempotent per (job, key), even after a withdrawal: a repeat has created false, another
// request under the key is ErrConflict.
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
		// The profile row first, as an invoice locks it; outbox.ClientEmailsLeft then locks the user's row.
		if _, err := tx.Exec(ctx, "SELECT 1 FROM profiles WHERE id = $1 FOR UPDATE", profileID); err != nil {
			return fmt.Errorf("lock profile %s: %w", profileID, err)
		}
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
		err = tx.QueryRow(ctx, `SELECT change_hash FROM job_payments WHERE job_id = $1 AND change_key = $2
			UNION ALL SELECT change_hash FROM job_withdrawn_changes WHERE job_id = $1 AND change_key = $2`, id,
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
		// No change waits, so the last payment is the final one the client agreed to.
		var (
			last     int
			finished bool
		)
		if err := tx.QueryRow(ctx, `SELECT position, done_at IS NOT NULL FROM job_payments WHERE job_id = $1
			ORDER BY position DESC LIMIT 1`, id).Scan(&last, &finished); err != nil {
			return fmt.Errorf("read job %s payments: %w", id, err)
		}
		if finished {
			return ErrJobFinished
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
		var job int
		if err := tx.QueryRow(ctx, `SELECT count(*) FROM outbox_events WHERE job_id = $1 AND kind = $2
			AND created_at > now() - interval '24 hours'`, id, outbox.Change).Scan(&job); err != nil {
			return fmt.Errorf("count job %s change emails: %w", id, err)
		}
		if left, _, err := outbox.ClientEmailsLeft(ctx, tx, profileID); err != nil || left == 0 || job >= MaxChangeEmails {
			return err
		}
		return outbox.QueueChange(ctx, tx, id, key)
	})
	if err != nil {
		return Job{}, false, err
	}
	j, err := s.Get(ctx, profileID, id)
	return j, created, err
}

// AcceptChange (R-105) matches proposedAt to the microsecond, so consent never lands on a change withdrawn and
// replaced at that position. allow is asked only when this accept would change the job (R-117).
func (s *Service) AcceptChange(ctx context.Context, token string, position int, proposedAt time.Time, name,
	email string, allow func() time.Duration) (Job, error) {
	if err := checkTyped(name, email); err != nil {
		return Job{}, err
	}
	j, err := s.ByToken(ctx, token)
	if err != nil {
		return Job{}, err
	}
	// A quote payment has a zero ProposedAt: it is no change, whatever proposedAt says.
	if position < 1 || position > len(j.Payments) || j.Payments[position-1].ProposedAt.IsZero() ||
		!j.Payments[position-1].ProposedAt.Equal(proposedAt) {
		return Job{}, ErrNotFound
	}
	if !j.Payments[position-1].AcceptedAt.IsZero() {
		return j, nil
	}
	if wait := allow(); wait > 0 {
		return Job{}, &invoice.TooSoonError{Wait: wait}
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

// WithdrawChange (R-105): only the last payment can go, so the schedule stays in order with no gap.
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
		// The change's key stays used, so a late retry of its proposal replays instead of adding it again.
		tag, err := tx.Exec(ctx, `WITH gone AS (DELETE FROM job_payments WHERE job_id = $1 AND position = $2
			AND proposed_at IS NOT NULL AND accepted_at IS NULL AND invoice_id IS NULL
			AND position = (SELECT max(position) FROM job_payments WHERE job_id = $1)
			RETURNING job_id, change_key, change_hash)
			INSERT INTO job_withdrawn_changes (job_id, change_key, change_hash) SELECT * FROM gone`, id, position)
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
