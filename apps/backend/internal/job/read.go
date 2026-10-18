package job

import (
	"context"
	"errors"
	"fmt"
	"regexp"
	"time"

	"github.com/ensp1re/forwend/apps/backend/internal/invoice"
	"github.com/jackc/pgx/v5"
)

var (
	jobID    = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)
	jobToken = regexp.MustCompile(`^[0-9a-f]{64}$`)
)

const jobColumns = `j.id::text, j.token, j.profile_id::text, j.title, coalesce(j.scope, ''), j.client_name, j.client_email,
	coalesce(j.client_address, ''), coalesce(j.client_country, ''), coalesce(j.client_tax_id, ''), j.issuer_name,
	j.issuer_address, j.issuer_country, coalesce(j.issuer_tax_id, ''), j.issuer_email, coalesce(j.accepted_name, ''),
	coalesce(j.accepted_email, ''), j.accepted_at, j.created_at`

// Get reads the profile's job; another profile's or a malformed id is ErrNotFound. The caller has checked that the
// user owns the profile.
func (s *Service) Get(ctx context.Context, profileID, id string) (Job, error) {
	if !jobID.MatchString(id) {
		return Job{}, ErrNotFound
	}
	return s.read(ctx, "j.id = $1 AND j.profile_id = $2", id, profileID)
}

// ByToken reads the job its client's link names: public, for /w/<token>.
func (s *Service) ByToken(ctx context.Context, token string) (Job, error) {
	if !jobToken.MatchString(token) {
		return Job{}, ErrNotFound
	}
	return s.read(ctx, "j.token = $1", token)
}

func (s *Service) read(ctx context.Context, where string, args ...any) (Job, error) {
	var j Job
	var accepted *time.Time
	err := s.pool.QueryRow(ctx, "SELECT "+jobColumns+" FROM jobs j WHERE "+where, args...).Scan(&j.ID, &j.Token,
		&j.profileID, &j.Title, &j.Scope, &j.Client.Name, &j.Client.Email, &j.Client.Address, &j.Client.Country,
		&j.Client.TaxID, &j.Issuer.Name, &j.Issuer.Address, &j.Issuer.Country, &j.Issuer.TaxID, &j.Issuer.Email,
		&j.AcceptedName, &j.AcceptedEmail, &accepted, &j.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return Job{}, ErrNotFound
	} else if err != nil {
		return Job{}, fmt.Errorf("read job: %w", err)
	}
	if accepted != nil {
		j.AcceptedAt = accepted.UTC()
	}
	j.CreatedAt = j.CreatedAt.UTC()
	rows, err := s.pool.Query(ctx, `SELECT p.position, p.title, p.amount_cents, p.due_days, p.on_accept,
		    coalesce(p.invoice_id, ''), coalesce(invoices.number, 0),
		    CASE WHEN invoices.id IS NULL THEN '' ELSE `+invoice.StatusFilterSQL+` END, p.done_at,
		    coalesce(p.delivery_link, '')
		FROM job_payments p LEFT JOIN invoices_current invoices ON invoices.id = p.invoice_id
		WHERE p.job_id = $1 ORDER BY p.position`, j.ID)
	if err != nil {
		return Job{}, fmt.Errorf("read job %s payments: %w", j.ID, err)
	}
	j.Payments, err = pgx.CollectRows(rows, func(row pgx.CollectableRow) (Payment, error) {
		var p Payment
		var done *time.Time
		err := row.Scan(&p.Position, &p.Title, &p.AmountCents, &p.DueDays, &p.OnAccept, &p.InvoiceID, &p.Number,
			&p.Status, &done, &p.DeliveryLink)
		if done != nil {
			p.DoneAt = done.UTC()
		}
		return p, err
	})
	if err != nil {
		return Job{}, fmt.Errorf("read job %s payments: %w", j.ID, err)
	}
	return j, nil
}

// List is the profile's jobs, newest first.
func (s *Service) List(ctx context.Context, profileID string) ([]Summary, error) {
	rows, err := s.pool.Query(ctx, `SELECT j.id::text, j.title, j.client_name, sum(p.amount_cents)::bigint, count(*),
		    count(*) FILTER (WHERE invoices.id IS NOT NULL AND `+invoice.StatusFilterSQL+` IN ('paid', 'settled')),
		    j.accepted_at, j.created_at
		FROM jobs j JOIN job_payments p ON p.job_id = j.id
		LEFT JOIN invoices_current invoices ON invoices.id = p.invoice_id
		WHERE j.profile_id = $1 GROUP BY j.id ORDER BY j.created_at DESC, j.id`, profileID)
	if err != nil {
		return nil, fmt.Errorf("list jobs: %w", err)
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (Summary, error) {
		var s Summary
		var accepted *time.Time
		err := row.Scan(&s.ID, &s.Title, &s.ClientName, &s.TotalCents, &s.Payments, &s.Paid, &accepted, &s.CreatedAt)
		if accepted != nil {
			s.AcceptedAt = accepted.UTC()
		}
		s.CreatedAt = s.CreatedAt.UTC()
		return s, err
	})
}

// Delete removes the profile's job while the client has not accepted it: a withdrawn quote. An accepted job is
// ErrAccepted; its invoices and the record of acceptance stay. The row lock orders it with an accept.
func (s *Service) Delete(ctx context.Context, profileID, id string) error {
	if !jobID.MatchString(id) {
		return ErrNotFound
	}
	return pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		var accepted bool
		err := tx.QueryRow(ctx, "SELECT accepted_at IS NOT NULL FROM jobs WHERE id = $1 AND profile_id = $2 FOR UPDATE",
			id, profileID).Scan(&accepted)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		} else if err != nil {
			return fmt.Errorf("read job %s: %w", id, err)
		}
		if accepted {
			return ErrAccepted
		}
		if _, err := tx.Exec(ctx, "DELETE FROM job_payments WHERE job_id = $1", id); err != nil {
			return fmt.Errorf("delete job %s payments: %w", id, err)
		}
		if _, err := tx.Exec(ctx, "DELETE FROM jobs WHERE id = $1", id); err != nil {
			return fmt.Errorf("delete job %s: %w", id, err)
		}
		return nil
	})
}
