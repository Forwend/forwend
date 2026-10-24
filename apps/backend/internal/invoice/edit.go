package invoice

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/ensp1re/forwend/apps/backend/internal/history"
	"github.com/ensp1re/forwend/apps/backend/internal/profile"
	"github.com/jackc/pgx/v5"
)

// MaxMemo bounds the memo, the owner's own note on an invoice (R-127).
const MaxMemo = 2000

var ErrNotEditable = errors.New("invoice details can't change after money was seen or the checkout closed")

// Editable is what the owner may change (R-127): the first three at any time, the rest only before any money while
// the checkout is open (R-128). "" clears a field.
type Editable struct {
	Memo, ClientEmail, ReturnURL string
	Reference, Note, DueDate     string
}

// Update is an edit the payer sees (R-128): a due date's has its old and new date.
type Update struct {
	At              time.Time
	Field, From, To string
}

// Edit saves e and writes one history row for each field that changed.
func (s *Service) Edit(ctx context.Context, profileID, id string, e Editable) (Invoice, error) {
	e = Editable{strings.TrimSpace(e.Memo), strings.TrimSpace(e.ClientEmail), strings.TrimSpace(e.ReturnURL),
		strings.TrimSpace(e.Reference), strings.TrimSpace(e.Note), strings.TrimSpace(e.DueDate)}
	if !utf8.ValidString(e.Memo) || utf8.RuneCountInString(e.Memo) > MaxMemo || !profile.PlainText(e.Memo, true) {
		return Invoice{}, fmt.Errorf("%w: memo must be at most %d characters of plain text", ErrInvalid, MaxMemo)
	}
	if err := (Details{ClientEmail: e.ClientEmail, ReturnURL: e.ReturnURL, Reference: e.Reference, Note: e.Note,
		DueDate: e.DueDate}).check(); err != nil {
		return Invoice{}, err
	}
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		// Options first, main row last, in the ledger's lock order, as Cancel: FOR UPDATE also holds off the watcher's
		// new transfers, whose foreign key needs a share lock on the row.
		rows, err := tx.Query(ctx, `SELECT main_id IS NULL, payment_status = 'open' AND expires_at > $3, expires_at,
			    id, coalesce(store_id::text, ''), coalesce(memo, ''), coalesce(client_email, ''), coalesce(return_url, ''),
			    coalesce(reference, ''), coalesce(note, ''), coalesce(to_char(due_date, 'YYYY-MM-DD'), '')
			FROM invoices WHERE coalesce(main_id, id) = (SELECT coalesce(main_id, id) FROM invoices WHERE id = $1)
			  AND profile_id = $2
			ORDER BY main_id IS NULL, id FOR UPDATE`, strings.ToLower(id), profileID, s.now().Unix())
		if err != nil {
			return fmt.Errorf("lock invoice %s: %w", id, err)
		}
		type row struct {
			Main, Open bool
			ExpiresAt  int64
			ID, Store  string
			Editable
		}
		locked, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (row, error) {
			var w row
			err := r.Scan(&w.Main, &w.Open, &w.ExpiresAt, &w.ID, &w.Store, &w.Memo, &w.ClientEmail, &w.ReturnURL,
				&w.Reference, &w.Note, &w.DueDate)
			return w, err
		})
		if err != nil {
			return fmt.Errorf("lock invoice %s: %w", id, err)
		}
		if len(locked) == 0 {
			return ErrNotFound
		}
		main := locked[len(locked)-1]
		was := main.Editable
		if was == e {
			return nil
		}
		// A link set before its store's origins changed stays until the owner changes it.
		if e.ReturnURL != was.ReturnURL && e.ReturnURL != "" && main.Store != "" {
			store, err := profile.InvoiceStore(ctx, tx, profileID, main.Store)
			if err != nil {
				return err
			}
			if !store.Allows(e.ReturnURL) {
				return fmt.Errorf("%w: returnUrl must start with one of the store's allowed origins", ErrInvalid)
			}
		}
		if was.Reference != e.Reference || was.Note != e.Note || was.DueDate != e.DueDate {
			for _, r := range locked {
				if !r.Open {
					return ErrNotEditable
				}
			}
			var seen bool
			if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM chain_transfers t JOIN invoices i ON i.id = t.invoice_id
				WHERE coalesce(i.main_id, i.id) = $1 AND t.status <> 'reorged')`, main.ID).Scan(&seen); err != nil {
				return fmt.Errorf("read invoice %s transfers: %w", main.ID, err)
			}
			if seen {
				return ErrNotEditable
			}
			closes := time.Unix(main.ExpiresAt, 0).UTC().Format(time.DateOnly)
			if e.DueDate != was.DueDate && e.DueDate != "" &&
				(e.DueDate < s.now().UTC().Format(time.DateOnly) || e.DueDate > closes) {
				return fmt.Errorf("%w: dueDate must be between today and %s, the day the checkout closes", ErrInvalid,
					closes)
			}
		}
		if _, err := tx.Exec(ctx, `UPDATE invoices SET memo = nullif($2, ''), client_email = nullif($3, ''),
			return_url = nullif($4, ''), reference = nullif($5, ''), note = nullif($6, ''), due_date = nullif($7, '')::date
			WHERE id = $1`, main.ID, e.Memo, e.ClientEmail, e.ReturnURL, e.Reference, e.Note, e.DueDate); err != nil {
			return fmt.Errorf("edit invoice %s: %w", main.ID, err)
		}
		for _, f := range []struct {
			data     history.Data
			was, now string
		}{{history.Data{Field: "memo"}, was.Memo, e.Memo},
			{history.Data{Field: "clientEmail"}, was.ClientEmail, e.ClientEmail},
			{history.Data{Field: "returnUrl"}, was.ReturnURL, e.ReturnURL},
			{history.Data{Field: "reference"}, was.Reference, e.Reference},
			{history.Data{Field: "note"}, was.Note, e.Note},
			{history.Data{Field: "dueDate", From: was.DueDate, To: e.DueDate}, was.DueDate, e.DueDate}} {
			if f.was == f.now {
				continue
			}
			if err := history.Add(ctx, tx, main.ID, history.Edited, history.Owner, f.data); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return Invoice{}, err
	}
	return s.GetOfProfile(ctx, profileID, id)
}

func (s *Service) memo(ctx context.Context, id string) (string, error) {
	var memo string
	if err := s.pool.QueryRow(ctx, "SELECT coalesce(memo, '') FROM invoices WHERE id = $1", id).Scan(&memo); err != nil {
		return "", fmt.Errorf("read invoice %s memo: %w", id, err)
	}
	return memo, nil
}

// updates are the invoice's edits the payer sees, newest first.
func (s *Service) updates(ctx context.Context, id string) ([]Update, error) {
	rows, err := s.pool.Query(ctx, `SELECT at, data->>'field', coalesce(data->>'from', ''), coalesce(data->>'to', '')
		FROM history_events WHERE invoice_id = $1 AND kind = $2 AND data->>'field' IN ('reference', 'note', 'dueDate')
		ORDER BY id DESC`, id, history.Edited)
	if err != nil {
		return nil, fmt.Errorf("read invoice %s updates: %w", id, err)
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (Update, error) {
		var u Update
		err := row.Scan(&u.At, &u.Field, &u.From, &u.To)
		return u, err
	})
}
