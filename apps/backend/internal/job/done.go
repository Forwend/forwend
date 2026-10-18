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

// MaxDeliveryLink is the longest delivery link, like an invoice's return link.
const MaxDeliveryLink = 2000

// MarkDone marks the profile's job's payment at position done and makes its invoice, like the deposit's (R-103). The
// steps go in order, after acceptance; a payment that has its invoice answers the same. link is "" or an https link to
// the delivered work, kept with the time (D-66). The last payment's invoice is the final one: its note lists the
// earlier payments.
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
	for _, earlier := range j.Payments[:position-1] {
		if earlier.InvoiceID == "" {
			return Job{}, ErrOutOfOrder
		}
	}
	r := s.paymentRequest(j, p)
	if position == len(j.Payments) && position > 1 {
		r.Note = finalNote(j, p)
	}
	r.After = func(ctx context.Context, tx pgx.Tx, invoiceID string) error {
		_, err := tx.Exec(ctx, `UPDATE job_payments SET invoice_id = $3, done_at = now(), delivery_link = NULLIF($4, '')
			WHERE job_id = $1 AND position = $2`, j.ID, position, invoiceID, link)
		return err
	}
	// A concurrent call the same UTC day makes the same request with the same key, so it gets this invoice back; one
	// with other values (a payment paid in between changes the final note) finds the invoice made.
	_, _, err = s.invoices.Create(ctx, profileID, fmt.Sprintf("job:%s:%d", j.ID, position), r)
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

// finalNote is the final invoice's note (R-103, D-81): the job's total and each earlier payment with its invoice,
// amount and whether it is paid, so the client sees what this invoice leaves to pay. It fits the invoice's note.
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
