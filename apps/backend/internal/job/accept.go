package job

import (
	"context"
	"errors"
	"fmt"
	"net/mail"
	"time"
	"unicode/utf8"

	"github.com/forwend/forwend/apps/backend/internal/history"
	"github.com/forwend/forwend/apps/backend/internal/invoice"
	"github.com/forwend/forwend/apps/backend/internal/profile"
	"github.com/jackc/pgx/v5"
)

// Accept (R-100) makes a deposit invoice in the same transaction; an accepted job answers the same. allow is asked
// only when this accept would change the job, so an unknown link or a bad body spends none of it (R-117).
func (s *Service) Accept(ctx context.Context, token, name, email string, allow func() time.Duration) (Job, error) {
	if err := checkTyped(name, email); err != nil {
		return Job{}, err
	}
	j, err := s.ByToken(ctx, token)
	if err != nil || !j.AcceptedAt.IsZero() {
		return j, err
	}
	if wait := allow(); wait > 0 {
		return Job{}, &invoice.TooSoonError{Wait: wait}
	}
	return s.accept(ctx, j, name, email)
}

// A job deleted since j was read is ErrNotFound, and its deposit invoice is not made.
func (s *Service) accept(ctx context.Context, j Job, name, email string) (Job, error) {
	var err error
	accept := func(ctx context.Context, tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `UPDATE jobs SET accepted_name = $2, accepted_email = $3, accepted_at = now()
			WHERE id = $1 AND accepted_at IS NULL`, j.ID, name, email)
		if err != nil || tag.RowsAffected() == 1 {
			return err
		}
		// Nothing changed: another accept won, which answers the same, or the owner deleted the job.
		var exists bool
		if err := tx.QueryRow(ctx, "SELECT EXISTS (SELECT 1 FROM jobs WHERE id = $1)", j.ID).Scan(&exists); err != nil {
			return err
		}
		if !exists {
			return ErrNotFound
		}
		return nil
	}
	deposit := j.Payments[0]
	if !deposit.OnAccept {
		err = pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error { return accept(ctx, tx) })
	} else {
		r := s.paymentRequest(j, deposit)
		r.By = history.Payer
		r.After = func(ctx context.Context, tx pgx.Tx, invoiceID string) error {
			if err := accept(ctx, tx); err != nil {
				return err
			}
			_, err := tx.Exec(ctx, "UPDATE job_payments SET invoice_id = $3 WHERE job_id = $1 AND position = $2",
				j.ID, deposit.Position, invoiceID)
			return err
		}
		// A concurrent accept the same UTC day makes the same request with the same key, so it gets this invoice back.
		// One across midnight has another due date: its key is taken, and the job reads as accepted.
		_, _, err = s.invoices.Create(ctx, j.profileID, fmt.Sprintf("job:%s:%d", j.ID, deposit.Position), r)
		if errors.Is(err, invoice.ErrConflict) {
			if again, readErr := s.ByToken(ctx, j.Token); readErr == nil && !again.AcceptedAt.IsZero() {
				return again, nil
			}
		}
	}
	if err != nil {
		// The client sees a 422's text: it names no job id.
		return Job{}, fmt.Errorf("accept job: %w", err)
	}
	return s.ByToken(ctx, j.Token)
}

func checkTyped(name, email string) error {
	if name == "" || !utf8.ValidString(name) || utf8.RuneCountInString(name) > profile.MaxClientName ||
		!profile.PlainText(name, false) {
		return fmt.Errorf("%w: name must be 1 to %d characters of plain text", ErrInvalid, profile.MaxClientName)
	}
	if a, err := mail.ParseAddress(email); err != nil || a.Address != email || len(email) > profile.MaxClientEmail {
		return fmt.Errorf("%w: email must be an email address like name@example.com", ErrInvalid)
	}
	return nil
}

// paymentRequest is a payer-chooses invoice (D-75), open DueGraceDays past its due date (D-80), and up to a day
// longer, so the same request made again the same UTC day has the same idempotency hash.
func (s *Service) paymentRequest(j Job, p Payment) invoice.Request {
	usd := USD(p.AmountCents)
	today := s.now().UTC().Truncate(24 * time.Hour)
	seconds := int64(p.DueDays+invoice.DueGraceDays+1) * 24 * 60 * 60
	c := j.Client
	return invoice.Request{
		AmountUSD:        usd,
		ExpiresInSeconds: &seconds,
		Lines:            []invoice.LineRequest{{Description: p.Title, Quantity: "1", UnitPrice: usd}},
		Details: invoice.Details{Title: j.Title, DueDate: today.AddDate(0, 0, p.DueDays).Format(time.DateOnly),
			ClientName: c.Name, ClientEmail: c.Email, ClientAddress: c.Address, ClientCountry: c.Country,
			ClientTaxID: c.TaxID},
	}
}
