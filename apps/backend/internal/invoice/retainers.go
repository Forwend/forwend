package invoice

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/ensp1re/forwend/apps/backend/internal/outbox"
	"github.com/jackc/pgx/v5"
)

const (
	// RetainerLead is how many UTC days before its due date each later month's invoice is made and emailed (R-98).
	RetainerLead = 7
	// MaxRetainers bounds a profile's running retainers: each emails a client every month without the owner's click.
	MaxRetainers = 50
	// DueGraceDays is how long past its due date a checkout stays open (D-80), as the web form sets it.
	DueGraceDays = 60
)

// errRetainerStopped: the owner stopped the retainer while the worker was making its next invoice.
var errRetainerStopped = errors.New("retainer stopped")

// Repeat makes a new invoice repeat every month (R-98). EndDate (YYYY-MM-DD) is the last due date it may reach; ""
// repeats until stopped.
type Repeat struct {
	EndDate string
}

// Retainer is the retainer an invoice belongs to, for its owner. NextDue and NextOn are "" once it ended or stopped.
type Retainer struct {
	EndDate   string
	NextDue   string // the next invoice's due date
	NextOn    string // the UTC day the worker makes and emails it
	StoppedAt time.Time
}

// cycle is one later month of a retainer, numbered from 0, the owner's first invoice.
type cycle struct {
	retainer string
	n        int
}

// checkRepeat refuses a repeat without a due date or client email, or with an end date before the due date.
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

// startRetainer saves the retainer of the invoice just inserted in tx, under the profile lock Create holds.
func (s *Service) startRetainer(ctx context.Context, tx pgx.Tx, profileID, invoiceID string, r Request) error {
	var running int
	if err := tx.QueryRow(ctx, `SELECT count(*) FROM retainers WHERE profile_id = $1 AND stopped_at IS NULL
		AND (end_date IS NULL OR end_date >= $2::date)`, profileID, s.now().UTC().Format(time.DateOnly)).Scan(&running); err != nil {
		return fmt.Errorf("count running retainers: %w", err)
	}
	if running >= MaxRetainers {
		return fmt.Errorf("%w: a profile has at most %d running retainers", ErrInvalid, MaxRetainers)
	}
	// The later months reuse the request, stored as JSON with Go's field names: renaming a Request field needs a
	// migration of retainers.request.
	t := r
	t.DueDate, t.SupplyDate, t.ExpiresInSeconds, t.Repeat, t.Details.Agreed = "", "", nil, nil, nil
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

// addCycle records the month's invoice just inserted in tx and queues its email to the client, unless the user's client
// emails are used up for the day (R-116). A retainer stopped in the meantime makes nothing: the row lock orders this
// after StopRetainer.
func addCycle(ctx context.Context, tx pgx.Tx, c cycle, profileID, invoiceID, key string) error {
	var stopped bool
	if err := tx.QueryRow(ctx, "SELECT stopped_at IS NOT NULL FROM retainers WHERE id = $1 FOR UPDATE",
		c.retainer).Scan(&stopped); err != nil {
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
	return outbox.QueueSend(ctx, tx, invoiceID, key)
}

// nextMonthSQL joins to retainers r the next month to make, as c.n and c.due: the first month after the last one
// made whose due date is the UTC day today (a SQL date) or later. A month that passed unmade, as when the first due
// date is in the past or the worker was down, is skipped: billing it then would email the client a late invoice.
func nextMonthSQL(today string) string {
	return `CROSS JOIN LATERAL (SELECT (extract(year FROM age(` + today + `, r.first_due)) * 12
		    + extract(month FROM age(` + today + `, r.first_due)))::int AS k) a
		CROSS JOIN LATERAL (SELECT greatest((SELECT max(cycle) + 1 FROM retainer_invoices WHERE retainer_id = r.id),
		    a.k + ((r.first_due + make_interval(months => a.k))::date < ` + today + `)::int) AS n) m
		CROSS JOIN LATERAL (SELECT m.n, (r.first_due + make_interval(months => m.n))::date AS due) c`
}

// MakeRetainerInvoices makes, for each running retainer, its next month's invoice once that due date is RetainerLead
// UTC days away or less, and emails it to the client (R-98). The worker calls it each round. A month starts with
// reminders as the first invoice was created, unless the client stopped them on an earlier month (R-96).
func (s *Service) MakeRetainerInvoices(ctx context.Context) error {
	type month struct {
		retainer, profile string
		request           []byte
		n                 int
		due               time.Time
		remindersStopped  bool
	}
	rows, err := s.pool.Query(ctx, `SELECT r.id, r.profile_id, r.request, c.n, c.due,
		    EXISTS (SELECT 1 FROM retainer_invoices x JOIN invoice_reminders ir ON ir.invoice_id = x.invoice_id
		            WHERE x.retainer_id = r.id AND ir.stopped_at IS NOT NULL)
		FROM retainers r `+nextMonthSQL("$1::date")+`
		WHERE r.stopped_at IS NULL AND c.due - $2::int <= $1::date AND (r.end_date IS NULL OR c.due <= r.end_date)`,
		s.now().UTC().Format(time.DateOnly), RetainerLead)
	if err != nil {
		return fmt.Errorf("read due retainers: %w", err)
	}
	months, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (month, error) {
		var m month
		return m, row.Scan(&m.retainer, &m.profile, &m.request, &m.n, &m.due, &m.remindersStopped)
	})
	if err != nil {
		return fmt.Errorf("read due retainers: %w", err)
	}
	var errs []error
	for _, m := range months {
		var r Request
		if err := json.Unmarshal(m.request, &r); err != nil {
			errs = append(errs, fmt.Errorf("retainer %s: %w", m.retainer, err))
			continue
		}
		// D-80: the checkout stays open to the end of the 60th day after the due date, in whole seconds rounded up.
		seconds := int64((m.due.AddDate(0, 0, DueGraceDays+1).Sub(s.now()) + time.Second - 1) / time.Second)
		r.DueDate, r.ExpiresInSeconds = m.due.Format(time.DateOnly), &seconds
		r.Reminders = r.Reminders && !m.remindersStopped
		r.cycle = &cycle{retainer: m.retainer, n: m.n}
		key := fmt.Sprintf("retainer:%s:%d", m.retainer, m.n)
		if _, _, err := s.Create(ctx, m.profile, key, r); err != nil && !errors.Is(err, errRetainerStopped) {
			errs = append(errs, fmt.Errorf("retainer %s month %d: %w", m.retainer, m.n, err))
		}
	}
	return errors.Join(errs...)
}

// StopRetainer stops the retainer the profile's invoice belongs to (R-98): no later month is made, and invoices
// already made stay. It answers the invoice, the same when already stopped or when the invoice doesn't repeat.
func (s *Service) StopRetainer(ctx context.Context, profileID, id string) (Invoice, error) {
	id = strings.ToLower(id)
	if _, err := s.pool.Exec(ctx, `UPDATE retainers SET stopped_at = coalesce(stopped_at, now())
		WHERE id = (SELECT retainer_id FROM retainer_invoices WHERE invoice_id = $1) AND profile_id = $2`,
		id, profileID); err != nil {
		return Invoice{}, fmt.Errorf("stop retainer of invoice %s: %w", id, err)
	}
	return s.GetOfProfile(ctx, profileID, id)
}

// retainer reads the retainer the invoice belongs to; nil when it doesn't repeat.
func (s *Service) retainer(ctx context.Context, id string) (*Retainer, error) {
	var r Retainer
	var stopped *time.Time
	var due, on string
	var running bool
	err := s.pool.QueryRow(ctx, `SELECT coalesce(to_char(r.end_date, 'YYYY-MM-DD'), ''), r.stopped_at,
		    to_char(c.due, 'YYYY-MM-DD'), to_char(greatest(c.due - $3::int, $2::date), 'YYYY-MM-DD'),
		    r.stopped_at IS NULL AND (r.end_date IS NULL OR c.due <= r.end_date)
		FROM retainer_invoices ri JOIN retainers r ON r.id = ri.retainer_id `+nextMonthSQL("$2::date")+`
		WHERE ri.invoice_id = $1`, id, s.now().UTC().Format(time.DateOnly), RetainerLead).
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
