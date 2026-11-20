package job

import (
	"context"
	"errors"
	"fmt"
	"net/mail"
	"time"

	"github.com/forwend/forwend/apps/backend/internal/history"
	"github.com/forwend/forwend/apps/backend/internal/invoice"
	"github.com/forwend/forwend/apps/backend/internal/profile"
	"github.com/jackc/pgx/v5"
)

// Accept makes a deposit invoice in the same transaction; allow is asked only when the job would change.
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

// A job deleted since j was read gives ErrNotFound and no deposit invoice.
func (s *Service) accept(ctx context.Context, j Job, name, email string) (Job, error) {
	var err error
	accept := func(ctx context.Context, tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `UPDATE jobs SET accepted_name = $2, accepted_email = $3, accepted_at = now()
			WHERE id = $1 AND accepted_at IS NULL`, j.ID, name, email)
		if err != nil || tag.RowsAffected() == 1 {
			return err
		}
		// No row: another accept won (same answer) or the owner deleted the job.
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
		r.Caller.By = history.Payer
		r.Caller.After = func(ctx context.Context, tx pgx.Tx, invoiceID string) error {
			if err := accept(ctx, tx); err != nil {
				return err
			}
			_, err := tx.Exec(ctx, "UPDATE job_payments SET invoice_id = $3 WHERE job_id = $1 AND position = $2",
				j.ID, deposit.Position, invoiceID)
			return err
		}
		// A concurrent accept the same UTC day sends the same key and request, so it gets this invoice back.
		_, _, err = s.invoices.Create(ctx, j.profileID, paymentKey(j.ID, deposit.Position), r)
		if errors.Is(err, invoice.ErrConflict) {
			if again, readErr := s.ByToken(ctx, j.Token); readErr == nil && !again.AcceptedAt.IsZero() {
				return again, nil
			}
		}
	}
	if err != nil {
		// The client sees this text in a 422, so it names no job id.
		return Job{}, fmt.Errorf("accept job: %w", err)
	}
	return s.ByToken(ctx, j.Token)
}

func checkTyped(name, email string) error {
	if name == "" || !profile.ValidText(name, profile.MaxClientName, false) {
		return fmt.Errorf("%w: name must be 1 to %d characters of plain text", ErrInvalid, profile.MaxClientName)
	}
	if a, err := mail.ParseAddress(email); err != nil || a.Address != email || len(email) > profile.MaxClientEmail {
		return fmt.Errorf("%w: email must be an email address like name@example.com", ErrInvalid)
	}
	return nil
}

func paymentKey(jobID string, position int) string { return fmt.Sprintf("job:%s:%d", jobID, position) }

// paymentRequest is a payer-chooses invoice open DueGraceDays past its due date, so a same-day retry matches.
func (s *Service) paymentRequest(j Job, p Payment) invoice.Request {
	usd := invoice.USD(p.AmountCents)
	today := s.now().UTC().Truncate(24 * time.Hour)
	seconds := int64(p.DueDays+invoice.DueGraceDays+1) * 24 * 60 * 60
	c := j.Client
	live := j.Livemode
	return invoice.Request{
		AmountUSD:        usd,
		ExpiresInSeconds: &seconds,
		Lines:            []invoice.LineRequest{{Description: p.Title, Quantity: "1", UnitPrice: usd}},
		Details: invoice.Details{Title: j.Title, DueDate: today.AddDate(0, 0, p.DueDays).Format(time.DateOnly),
			ClientName: c.Name, ClientEmail: c.Email, ClientAddress: c.Address, ClientCountry: c.Country,
			ClientTaxID: c.TaxID},
		Caller: invoice.Caller{Livemode: &live},
	}
}
