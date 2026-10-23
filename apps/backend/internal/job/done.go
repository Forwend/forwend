package job

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"strings"
	"unicode/utf8"

	"github.com/ensp1re/forwend/apps/backend/internal/invoice"
	"github.com/ensp1re/forwend/apps/backend/internal/profile"
	"github.com/jackc/pgx/v5"
)

const MaxDeliveryLink = 2000

// errScheduleChanged rolls back an invoice made for a schedule a change altered meanwhile.
var errScheduleChanged = errors.New("the job's payments changed")

// MarkDone (R-103, D-66) answers the same once the payment has its invoice. The final invoice waits until no change
// does (ErrChangePending), so a change can't come after it.
func (s *Service) MarkDone(ctx context.Context, profileID, id string, position int, link string) (Job, error) {
	if link != "" {
		// url.Parse lowers the scheme; the database takes only "https://" as written.
		u, err := url.Parse(link)
		if err != nil || !strings.HasPrefix(link, "https://") || u.Host == "" || u.User != nil ||
			utf8.RuneCountInString(link) > MaxDeliveryLink || !profile.PlainText(link, false) {
			return Job{}, fmt.Errorf("%w: deliveryLink must be an https link of at most %d characters", ErrInvalid,
				MaxDeliveryLink)
		}
	}
	j, err := s.Get(ctx, profileID, id)
	if err != nil {
		return Job{}, err
	}
	if position < 1 || position > len(j.Payments) {
		return Job{}, ErrNotFound
	}
	p := j.Payments[position-1]
	if p.InvoiceID != "" {
		return j, nil
	}
	if j.AcceptedAt.IsZero() {
		return Job{}, ErrNotAccepted
	}
	if !p.ProposedAt.IsZero() && p.AcceptedAt.IsZero() {
		return Job{}, ErrChangeNotAccepted
	}
	for _, earlier := range j.Payments[:position-1] {
		if earlier.InvoiceID == "" {
			return Job{}, ErrOutOfOrder
		}
	}
	r := s.paymentRequest(j, p)
	// The final invoice is the last payment the client agreed to; a change still waiting comes first (R-105).
	last := len(j.Payments)
	if pending := j.Payments[last-1]; !pending.ProposedAt.IsZero() && pending.AcceptedAt.IsZero() {
		if position == last-1 {
			return Job{}, ErrChangePending
		}
		last--
	}
	if position == last && position > 1 {
		r.Note = finalNote(j, p)
	}
	r.After = func(ctx context.Context, tx pgx.Tx, invoiceID string) error {
		// The job row lock orders this with a proposal: a schedule that changed since the read is read again. The count
		// is its own statement, so it sees what committed while the lock waited.
		if _, err := tx.Exec(ctx, "SELECT 1 FROM jobs WHERE id = $1 FOR UPDATE", j.ID); err != nil {
			return err
		}
		var n int
		if err := tx.QueryRow(ctx, "SELECT count(*) FROM job_payments WHERE job_id = $1", j.ID).Scan(&n); err != nil {
			return err
		}
		if n != len(j.Payments) {
			return errScheduleChanged
		}
		_, err := tx.Exec(ctx, `UPDATE job_payments SET invoice_id = $3, done_at = now(), delivery_link = NULLIF($4, '')
			WHERE job_id = $1 AND position = $2`, j.ID, position, invoiceID, link)
		return err
	}
	// A concurrent call the same UTC day makes the same request with the same key, so it gets this invoice back; one
	// with other values (a payment paid in between changes the final note) finds the invoice made.
	_, _, err = s.invoices.Create(ctx, profileID, fmt.Sprintf("job:%s:%d", j.ID, position), r)
	if errors.Is(err, errScheduleChanged) {
		return s.MarkDone(ctx, profileID, id, position, link)
	}
	if errors.Is(err, invoice.ErrConflict) {
		if again, readErr := s.Get(ctx, profileID, id); readErr == nil && again.Payments[position-1].InvoiceID != "" {
			return again, nil
		}
	}
	if err != nil {
		return Job{}, fmt.Errorf("mark job %s payment %d done: %w", j.ID, position, err)
	}
	return s.Get(ctx, profileID, id)
}

// finalNote (R-103, D-81) fits the invoice's note length.
func finalNote(j Job, final Payment) string {
	var b strings.Builder
	fmt.Fprintf(&b, "Final invoice for %s. Job total: %s USD.\nEarlier payments:", j.Title, USD(j.TotalCents()))
	for _, p := range j.Payments[:final.Position-1] {
		paid := "not paid yet"
		switch p.Status {
		case "paid", "settled":
			paid = "paid"
		case "canceled":
			paid = "canceled"
		case "expired":
			paid = "not paid, closed"
		}
		fmt.Fprintf(&b, "\n- %s (INV-%04d): %s USD, %s", p.Title, p.Number, USD(p.AmountCents), paid)
	}
	fmt.Fprintf(&b, "\nThis invoice: %s, %s USD.", final.Title, USD(final.AmountCents))
	return b.String()
}
