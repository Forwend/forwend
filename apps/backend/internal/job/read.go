package job

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/forwend/forwend/apps/backend/internal/invoice"
	"github.com/forwend/forwend/apps/backend/internal/outbox"
	"github.com/forwend/forwend/apps/backend/internal/search"
	"github.com/jackc/pgx/v5"
)

var (
	jobID    = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)
	jobToken = regexp.MustCompile(`^[0-9a-f]{64}$`)
)

const jobColumns = `j.id::text, j.token, j.profile_id::text, j.title, coalesce(j.scope, ''), j.client_name, j.client_email,
	coalesce(j.client_address, ''), coalesce(j.client_country, ''), coalesce(j.client_tax_id, ''), j.issuer_name,
	j.issuer_address, j.issuer_country, coalesce(j.issuer_tax_id, ''), j.issuer_email, coalesce(j.accepted_name, ''),
	coalesce(j.accepted_email, ''), j.accepted_at, j.created_at, j.livemode`

// The caller must check the user's access to the profile.
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
		&j.AcceptedName, &j.AcceptedEmail, &accepted, &j.CreatedAt, &j.Livemode)
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
		    coalesce(p.invoice_id, ''), coalesce(invoices.pay_token, ''), coalesce(invoices.number, 0),
		    CASE WHEN invoices.id IS NULL THEN '' ELSE `+invoice.StatusFilterSQL+` END, p.done_at,
		    coalesce(p.delivery_link, ''), invoices.created_at,
		    CASE WHEN invoices.payment_status = 'paid' THEN `+invoice.PaidAtSQL("invoices.option_id")+` END,
		    p.proposed_at, coalesce(p.accepted_name, ''), coalesce(p.accepted_email, ''), p.accepted_at,
		    EXISTS (SELECT 1 FROM outbox_events e WHERE e.job_id = p.job_id AND e.kind = $2
		            AND e.payload->>'change' = p.change_key)
		FROM job_payments p LEFT JOIN invoices_current invoices ON invoices.id = p.invoice_id
		WHERE p.job_id = $1 ORDER BY p.position`, j.ID, outbox.Change)
	if err != nil {
		return Job{}, fmt.Errorf("read job %s payments: %w", j.ID, err)
	}
	j.Payments, err = pgx.CollectRows(rows, func(row pgx.CollectableRow) (Payment, error) {
		var p Payment
		var done, invoiced, proposed, accepted *time.Time
		var paid *int64
		err := row.Scan(&p.Position, &p.Title, &p.AmountCents, &p.DueDays, &p.OnAccept, &p.InvoiceID, &p.PayToken, &p.Number,
			&p.Status, &done, &p.DeliveryLink, &invoiced, &paid, &proposed, &p.AcceptedName, &p.AcceptedEmail, &accepted,
			&p.ClientEmailed)
		if proposed != nil {
			p.ProposedAt = proposed.UTC()
		}
		if accepted != nil {
			p.AcceptedAt = accepted.UTC()
		}
		if done != nil {
			p.DoneAt = done.UTC()
		}
		if invoiced != nil {
			p.InvoicedAt = invoiced.UTC()
		}
		if paid != nil {
			p.PaidAt = time.Unix(*paid, 0).UTC()
		}
		return p, err
	})
	if err != nil {
		return Job{}, fmt.Errorf("read job %s payments: %w", j.ID, err)
	}
	return j, nil
}

// DefaultLimit and MaxLimit bound a page of jobs.
const (
	DefaultLimit = 50
	MaxLimit     = 100
)

// Page is one page of jobs; NextCursor is "" on the last one.
type Page struct {
	Jobs       []Summary
	NextCursor string
}

// List is the profile's jobs of its mode (D-120), newest first, limit after cursor; q matches the title or the
// client's name.
func (s *Service) List(ctx context.Context, profileID, cursor string, limit int, q search.Query) (Page, error) {
	if limit < 1 || limit > MaxLimit {
		return Page{}, fmt.Errorf("%w: limit must be 1 to %d", ErrInvalid, MaxLimit)
	}
	args := []any{profileID, limit + 1, q.Like}
	after := ""
	if cursor != "" {
		at, id, err := decodeCursor(cursor)
		if err != nil {
			return Page{}, err
		}
		args = append(args, at, id)
		after = " AND (created_at < $4 OR created_at = $4 AND id > $5)"
	}
	// The page is cut before the join, so a read sums only its own jobs' payments. A change counts once the client
	// accepted it (R-105).
	rows, err := s.pool.Query(ctx, `SELECT j.id::text, j.title, j.client_name, sum(p.amount_cents)::bigint, count(*),
		    count(*) FILTER (WHERE invoices.id IS NOT NULL AND `+invoice.StatusFilterSQL+` IN ('paid', 'settled')),
		    j.accepted_at, j.created_at
		FROM (SELECT * FROM jobs WHERE profile_id = $1 AND livemode = (SELECT livemode FROM profiles WHERE id = $1)
		      AND ($3::text IS NULL OR title ILIKE $3 OR client_name ILIKE $3)`+
		after+` ORDER BY created_at DESC, id LIMIT $2) j
		JOIN job_payments p ON p.job_id = j.id AND (p.proposed_at IS NULL OR p.accepted_at IS NOT NULL)
		LEFT JOIN invoices_current invoices ON invoices.id = p.invoice_id
		GROUP BY j.id, j.title, j.client_name, j.accepted_at, j.created_at ORDER BY j.created_at DESC, j.id`, args...)
	if err != nil {
		return Page{}, fmt.Errorf("list jobs: %w", err)
	}
	jobs, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (Summary, error) {
		var s Summary
		var accepted *time.Time
		err := row.Scan(&s.ID, &s.Title, &s.ClientName, &s.TotalCents, &s.Payments, &s.Paid, &accepted, &s.CreatedAt)
		if accepted != nil {
			s.AcceptedAt = accepted.UTC()
		}
		s.CreatedAt = s.CreatedAt.UTC()
		return s, err
	})
	if err != nil {
		return Page{}, fmt.Errorf("list jobs: %w", err)
	}
	var next string
	if len(jobs) > limit {
		jobs = jobs[:limit]
		last := jobs[limit-1]
		next = base64.RawURLEncoding.EncodeToString([]byte(fmt.Sprintf("%d|%s", last.CreatedAt.UnixMicro(), last.ID)))
	}
	return Page{Jobs: jobs, NextCursor: next}, nil
}

// A cursor is the last job's creation time (Unix microseconds, Postgres' precision) and id.
func decodeCursor(cursor string) (time.Time, string, error) {
	raw, err := base64.RawURLEncoding.DecodeString(cursor)
	at, id, ok := strings.Cut(string(raw), "|")
	micros, parseErr := strconv.ParseInt(at, 10, 64)
	if err != nil || !ok || parseErr != nil || !jobID.MatchString(id) {
		return time.Time{}, "", fmt.Errorf("%w: cursor is not one this API returned", ErrInvalid)
	}
	return time.UnixMicro(micros), id, nil
}

// Delete withdraws a quote the client has not accepted; the row lock orders it with an accept.
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
