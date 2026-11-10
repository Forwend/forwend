package invoice

import (
	"cmp"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/forwend/forwend/apps/backend/internal/history"
	"github.com/forwend/forwend/apps/backend/internal/outbox"
	"github.com/jackc/pgx/v5"
)

const (
	// RetainerLead is how many UTC days before its due date each later month's invoice is made and emailed (R-98).
	RetainerLead = 7
	// Each running retainer emails a client every month without the owner's click.
	MaxRetainers = 50
	// DueGraceDays is how long past its due date a checkout stays open (D-80), as the web form sets it.
	DueGraceDays = 60
	// RetainerFailuresTold is the failures in a row after which the owner gets one email that a month can't be made.
	RetainerFailuresTold = 3
)

var errRetainerStopped = errors.New("retainer stopped")

// Repeat (R-98): EndDate (YYYY-MM-DD) is the last due date it may reach; "" repeats until stopped.
type Repeat struct {
	EndDate string
}

// NextDue and NextOn are "" once the retainer ended or stopped.
type Retainer struct {
	EndDate   string
	NextDue   string
	NextOn    string // the UTC day the worker makes and emails it
	StoppedAt time.Time
}

// cycle is one later month of a retainer, numbered from 0, the owner's first invoice.
type cycle struct {
	retainer string
	n        int
}

func checkRepeat(r Request) error {
	if r.Repeat == nil {
		return nil
	}
	if r.DueDate == "" || r.ClientEmail == "" {
		return fmt.Errorf("%w: repeat needs a dueDate and a client.email", ErrInvalid)
	}
	if e := r.Repeat.EndDate; e != "" {
		if _, err := time.Parse(time.DateOnly, e); err != nil || e < r.DueDate {
			return fmt.Errorf("%w: repeat.endDate must be a date like 2027-06-01, on or after dueDate", ErrInvalid)
		}
	}
	return nil
}

// Runs under the profile lock Create holds, so the running count can't be stale.
func (s *Service) startRetainer(ctx context.Context, tx pgx.Tx, profileID, invoiceID string, r Request) error {
	var running int
	if err := tx.QueryRow(ctx, `SELECT count(*) FROM retainers WHERE profile_id = $1 AND stopped_at IS NULL
		AND (end_date IS NULL OR end_date >= $2::date)`, profileID, s.currentTime().UTC().Format(time.DateOnly)).Scan(&running); err != nil {
		return fmt.Errorf("count running retainers: %w", err)
	}
	if running >= MaxRetainers {
		return fmt.Errorf("%w: a profile has at most %d running retainers", ErrInvalid, MaxRetainers)
	}
	// The later months reuse the request, stored as JSON with Go's field names: renaming a Request field needs a
	// migration of retainers.request.
	t := r
	t.DueDate, t.SupplyDate, t.ExpiresInSeconds, t.Repeat, t.Details.Agreed = "", "", nil, nil, nil
	t.Replaces = ""
	request, err := json.Marshal(t)
	if err != nil {
		return fmt.Errorf("save retainer: %w", err)
	}
	if _, err := tx.Exec(ctx, `WITH r AS (INSERT INTO retainers (profile_id, request, first_due, end_date)
		    VALUES ($1, $2, $3::date, NULLIF($4, '')::date) RETURNING id)
		INSERT INTO retainer_invoices (retainer_id, cycle, invoice_id) SELECT id, 0, $5 FROM r`,
		profileID, request, r.DueDate, r.Repeat.EndDate, invoiceID); err != nil {
		return fmt.Errorf("save retainer: %w", err)
	}
	return nil
}

// The client email is skipped when the user's client emails are used up for the day (R-116). A retainer stopped
// in the meantime makes nothing: the row lock orders this after StopRetainer. A month made ends a run of failures.
func addCycle(ctx context.Context, tx pgx.Tx, c cycle, profileID, invoiceID, key string) error {
	var stopped bool
	if err := tx.QueryRow(ctx, `UPDATE retainers SET failures = 0, retry_at = NULL WHERE id = $1
		RETURNING stopped_at IS NOT NULL`, c.retainer).Scan(&stopped); err != nil {
		return fmt.Errorf("lock retainer %s: %w", c.retainer, err)
	}
	if stopped {
		return errRetainerStopped
	}
	if _, err := tx.Exec(ctx, "INSERT INTO retainer_invoices (retainer_id, cycle, invoice_id) VALUES ($1, $2, $3)",
		c.retainer, c.n, invoiceID); err != nil {
		return fmt.Errorf("add retainer %s month %d: %w", c.retainer, c.n, err)
	}
	if left, _, err := outbox.ClientEmailsLeft(ctx, tx, profileID); err != nil || left == 0 {
		return err
	}
	return outbox.QueueSend(ctx, tx, invoiceID, key, history.System)
}

// nextMonthSQL joins c.n and c.due to retainers r: the next month due today (a SQL date) or later. A month that
// passed unmade is skipped: billing it then would email the client a late invoice.
func nextMonthSQL(today string) string {
	return `CROSS JOIN LATERAL (SELECT (extract(year FROM age(` + today + `, r.first_due)) * 12
		    + extract(month FROM age(` + today + `, r.first_due)))::int AS k) a
		CROSS JOIN LATERAL (SELECT greatest((SELECT max(cycle) + 1 FROM retainer_invoices WHERE retainer_id = r.id),
		    a.k + ((r.first_due + make_interval(months => a.k))::date < ` + today + `)::int) AS n) m
		CROSS JOIN LATERAL (SELECT m.n, (r.first_due + make_interval(months => m.n))::date AS due) c`
}

// MakeRetainerInvoices makes each next month's invoice RetainerLead UTC days before its due date (R-98). It keeps
// the first invoice's reminders unless the client stopped them on an earlier month (R-96).
func (s *Service) MakeRetainerInvoices(ctx context.Context) error {
	type month struct {
		retainer, profile string
		request           []byte
		n                 int
		due               time.Time
		remindersStopped  bool
		feesPaidBy        string // the first month's (D-122)
	}
	rows, err := s.pool.Query(ctx, `SELECT r.id, r.profile_id, r.request, c.n, c.due,
		    EXISTS (SELECT 1 FROM retainer_invoices x JOIN invoice_reminders ir ON ir.invoice_id = x.invoice_id
		            WHERE x.retainer_id = r.id AND ir.stopped_at IS NOT NULL),
		    coalesce((SELECT i.fees_paid_by FROM retainer_invoices x JOIN invoices i ON i.id = x.invoice_id
		              WHERE x.retainer_id = r.id ORDER BY x.cycle LIMIT 1), '')
		FROM retainers r `+nextMonthSQL("$1::date")+`
		WHERE r.stopped_at IS NULL AND c.due - $2::int <= $1::date AND (r.end_date IS NULL OR c.due <= r.end_date)
		  AND (r.retry_at IS NULL OR r.retry_at <= $3)`,
		s.currentTime().UTC().Format(time.DateOnly), RetainerLead, s.currentTime())
	if err != nil {
		return fmt.Errorf("read due retainers: %w", err)
	}
	months, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (month, error) {
		var m month
		return m, row.Scan(&m.retainer, &m.profile, &m.request, &m.n, &m.due, &m.remindersStopped, &m.feesPaidBy)
	})
	if err != nil {
		return fmt.Errorf("read due retainers: %w", err)
	}
	var errs []error
	for _, m := range months {
		var r Request
		if err := json.Unmarshal(m.request, &r); err != nil {
			errs = append(errs, fmt.Errorf("retainer %s: %w", m.retainer, err), s.retainerFailed(ctx, m.retainer, m.due))
			continue
		}
		// A Revise belongs only to the first month, including templates saved with that action.
		r.Replaces = ""
		// A retainer saved before who pays the fees was in its request keeps its first month's.
		r.FeesPaidBy = cmp.Or(r.FeesPaidBy, m.feesPaidBy)
		// D-80: the checkout stays open to the end of the 60th day after the due date, in whole seconds rounded up.
		seconds := int64((m.due.AddDate(0, 0, DueGraceDays+1).Sub(s.currentTime()) + time.Second - 1) / time.Second)
		r.DueDate, r.ExpiresInSeconds = m.due.Format(time.DateOnly), &seconds
		r.Reminders = r.Reminders && !m.remindersStopped
		r.cycle, r.By = &cycle{retainer: m.retainer, n: m.n}, history.System
		key := fmt.Sprintf("retainer:%s:%d", m.retainer, m.n)
		if _, _, err := s.Create(ctx, m.profile, key, r); err != nil && !errors.Is(err, errRetainerStopped) {
			errs = append(errs, fmt.Errorf("retainer %s month %d: %w", m.retainer, m.n, err),
				s.retainerFailed(ctx, m.retainer, m.due))
		}
	}
	return errors.Join(errs...)
}

// retainerFailed makes the retainer wait before its next try, twice as long after each failure in a row up to an hour,
// and emails the owner once when the run reaches RetainerFailuresTold.
func (s *Service) retainerFailed(ctx context.Context, id string, due time.Time) error {
	payload, err := json.Marshal(outbox.Payload{Due: due.Format(time.DateOnly)})
	if err != nil {
		return fmt.Errorf("record retainer %s failure: %w", id, err)
	}
	if _, err := s.pool.Exec(ctx, `WITH r AS (
		    UPDATE retainers SET failures = failures + 1,
		        retry_at = $2::timestamptz + least(interval '1 minute' * 2 ^ least(failures, 6), interval '1 hour')
		    WHERE id = $1 RETURNING failures)
		INSERT INTO outbox_events (kind, invoice_id, payload)
		SELECT $3, x.invoice_id, $4 FROM r JOIN retainer_invoices x ON x.retainer_id = $1 AND x.cycle = 0
		WHERE r.failures = $5`, id, s.currentTime(), outbox.RetainerFailed, payload, RetainerFailuresTold); err != nil {
		return fmt.Errorf("record retainer %s failure: %w", id, err)
	}
	return nil
}

// StopRetainer (R-98): invoices already made stay; it answers the same when already stopped or not repeating.
func (s *Service) StopRetainer(ctx context.Context, profileID, id string) (Invoice, error) {
	id = strings.ToLower(id)
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `UPDATE retainers SET stopped_at = now()
			WHERE id = (SELECT retainer_id FROM retainer_invoices WHERE invoice_id = $1) AND profile_id = $2
			  AND stopped_at IS NULL`, id, profileID)
		if err != nil {
			return fmt.Errorf("stop retainer of invoice %s: %w", id, err)
		}
		if tag.RowsAffected() == 0 {
			return nil
		}
		return history.Add(ctx, tx, id, history.RepeatStopped, history.Owner, history.Data{})
	})
	if err != nil {
		return Invoice{}, err
	}
	return s.GetOfProfile(ctx, profileID, id)
}

func (s *Service) retainer(ctx context.Context, id string) (*Retainer, error) {
	var r Retainer
	var stopped *time.Time
	var due, on string
	var running bool
	err := s.pool.QueryRow(ctx, `SELECT coalesce(to_char(r.end_date, 'YYYY-MM-DD'), ''), r.stopped_at,
		    to_char(c.due, 'YYYY-MM-DD'), to_char(greatest(c.due - $3::int, $2::date), 'YYYY-MM-DD'),
		    r.stopped_at IS NULL AND (r.end_date IS NULL OR c.due <= r.end_date)
		FROM retainer_invoices ri JOIN retainers r ON r.id = ri.retainer_id `+nextMonthSQL("$2::date")+`
		WHERE ri.invoice_id = $1`, id, s.currentTime().UTC().Format(time.DateOnly), RetainerLead).
		Scan(&r.EndDate, &stopped, &due, &on, &running)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	} else if err != nil {
		return nil, fmt.Errorf("read invoice %s retainer: %w", id, err)
	}
	if running {
		r.NextDue, r.NextOn = due, on
	}
	if stopped != nil {
		r.StoppedAt = stopped.UTC()
	}
	return &r, nil
}
