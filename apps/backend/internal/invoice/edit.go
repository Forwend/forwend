package invoice

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"unicode/utf8"

	"github.com/ensp1re/forwend/apps/backend/internal/history"
	"github.com/ensp1re/forwend/apps/backend/internal/profile"
	"github.com/jackc/pgx/v5"
)

// MaxMemo bounds the memo, the owner's own note on an invoice (R-127).
const MaxMemo = 2000

// Editable is what the owner may change at any time (R-127); "" clears a field.
type Editable struct {
	Memo, ClientEmail, ReturnURL string
}

// Edit saves e and writes one history row for each field that changed.
func (s *Service) Edit(ctx context.Context, profileID, id string, e Editable) (Invoice, error) {
	e = Editable{strings.TrimSpace(e.Memo), strings.TrimSpace(e.ClientEmail), strings.TrimSpace(e.ReturnURL)}
	if !utf8.ValidString(e.Memo) || utf8.RuneCountInString(e.Memo) > MaxMemo || !profile.PlainText(e.Memo, true) {
		return Invoice{}, fmt.Errorf("%w: memo must be at most %d characters of plain text", ErrInvalid, MaxMemo)
	}
	if err := (Details{ClientEmail: e.ClientEmail, ReturnURL: e.ReturnURL}).check(); err != nil {
		return Invoice{}, err
	}
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		var main string
		var was Editable
		err := tx.QueryRow(ctx, `SELECT id, coalesce(memo, ''), coalesce(client_email, ''), coalesce(return_url, '')
			FROM invoices WHERE id = (SELECT coalesce(main_id, id) FROM invoices WHERE id = $1) AND profile_id = $2
			FOR NO KEY UPDATE`, strings.ToLower(id), profileID).Scan(&main, &was.Memo, &was.ClientEmail, &was.ReturnURL)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		} else if err != nil {
			return fmt.Errorf("read invoice %s: %w", id, err)
		}
		if was == e {
			return nil
		}
		if _, err := tx.Exec(ctx, `UPDATE invoices SET memo = nullif($2, ''), client_email = nullif($3, ''),
			return_url = nullif($4, '') WHERE id = $1`, main, e.Memo, e.ClientEmail, e.ReturnURL); err != nil {
			return fmt.Errorf("edit invoice %s: %w", main, err)
		}
		for _, f := range []struct{ name, was, is string }{{"memo", was.Memo, e.Memo},
			{"clientEmail", was.ClientEmail, e.ClientEmail}, {"returnUrl", was.ReturnURL, e.ReturnURL}} {
			if f.was == f.is {
				continue
			}
			if err := history.Add(ctx, tx, main, history.Edited, history.Owner, history.Data{Field: f.name}); err != nil {
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
