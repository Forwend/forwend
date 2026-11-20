package invoice

import (
	"cmp"
	"context"
	"fmt"
	"math/big"
	"slices"
	"strings"
	"time"

	"github.com/forwend/forwend/apps/backend/internal/chain"
	"github.com/forwend/forwend/apps/backend/internal/ledger"
	"github.com/jackc/pgx/v5"
)

// Owed is one row of the Owed to you list; money held for a payer is never a row.
type Owed struct {
	Kind         string // overdue or partlyPaid
	InvoiceID    string
	Number       *int64
	Purpose      Purpose
	DocumentKind DocumentKind
	Reference    string
	Title        string
	ClientName   string
	DueDate      string // YYYY-MM-DD
	DaysLate     int
	OptionCount  int // above 1 the client chooses: an unpaid row reads in USD
	chain.Asset
	Amount *big.Int
}

// OwedTotal covers every row, not only the page's.
type OwedTotal struct {
	chain.Asset
	Amount *big.Int
}

type OwedPage struct {
	Items  []Owed
	Count  int
	Totals []OwedTotal
}

const DefaultOwedLimit = 50

// Owed compares due dates with today's UTC date; stores and live, when not nil, narrow it.
func (s *Service) Owed(ctx context.Context, profileID string, stores []string, live *bool, limit int) (OwedPage, error) {
	if limit < 1 || limit > MaxLimit {
		return OwedPage{}, fmt.Errorf("%w: limit must be 1 to %d", ErrInvalid, MaxLimit)
	}
	args := []any{profileID}
	where := `invoices.profile_id = $1 AND (invoices.number IS NOT NULL OR invoices.document_kind = 'none')
		AND (invoices.due_date < (now() AT TIME ZONE 'UTC')::date OR invoices.payment_status = 'partially_paid')
		AND ` + StatusColumnsSQL["open"] + ` AND ` + StatusFilterSQL + ` = 'open'`
	if stores != nil {
		args = append(args, stores)
		where += fmt.Sprintf(" AND invoices.store_id = ANY($%d::uuid[])", len(args))
	}
	if live != nil {
		args = append(args, *live)
		where += fmt.Sprintf(" AND (SELECT livemode FROM chains c WHERE c.chain_id = invoices.chain_id) = $%d", len(args))
	}
	// MATERIALIZED: the status filter, not the costlier amount left, picks the rows first.
	rows, err := s.pool.Query(ctx, `WITH owed AS MATERIALIZED (
		SELECT CASE WHEN invoices.due_date < (now() AT TIME ZONE 'UTC')::date THEN 'overdue' ELSE 'partlyPaid' END AS kind,
		    invoices.id, invoices.number, invoices.purpose, invoices.document_kind, coalesce(invoices.reference, ''),
		    coalesce(invoices.title, ''), coalesce(invoices.client_name, ''),
		    coalesce(to_char(invoices.due_date, 'YYYY-MM-DD'), ''),
		    greatest((now() AT TIME ZONE 'UTC')::date - invoices.due_date, 0) AS days_late,
		    (SELECT count(*) FROM invoices o WHERE o.id = invoices.id OR o.main_id = invoices.id),
		    invoices.chain_id, invoices.token_contract, t.symbol, t.decimals,
		    invoices.amount - `+ledger.OwedSQL("invoices.option_id")+` AS amount, invoices.created_at
		FROM `+invoicesCurrent+` JOIN tokens t ON t.chain_id = invoices.chain_id AND t.contract = invoices.token_contract
		WHERE `+where+`)
		SELECT * FROM owed WHERE amount > 0
		ORDER BY CASE kind WHEN 'overdue' THEN 0 ELSE 1 END, days_late DESC, number DESC NULLS LAST, created_at DESC, id`,
		args...)
	if err != nil {
		return OwedPage{}, fmt.Errorf("read owed: %w", err)
	}
	// ponytail: every row is read to sum the totals, bounded by the open receive addresses; sum in SQL if that grows.
	page := OwedPage{Items: []Owed{}, Totals: []OwedTotal{}}
	totals := map[chain.Asset]*big.Int{}
	var o Owed
	var amount string
	var created time.Time
	if _, err := pgx.ForEachRow(rows, []any{&o.Kind, &o.InvoiceID, &o.Number, &o.Purpose, &o.DocumentKind, &o.Reference,
		&o.Title, &o.ClientName, &o.DueDate, &o.DaysLate, &o.OptionCount, &o.ChainID, &o.Token, &o.Symbol, &o.Decimals,
		&amount, &created}, func() error {
		o.Amount, _ = new(big.Int).SetString(amount, 10)
		if totals[o.Asset] == nil {
			totals[o.Asset] = new(big.Int)
		}
		totals[o.Asset].Add(totals[o.Asset], o.Amount)
		if page.Count++; len(page.Items) < limit {
			page.Items = append(page.Items, o)
		}
		return nil
	}); err != nil {
		return OwedPage{}, fmt.Errorf("read owed: %w", err)
	}
	for asset, sum := range totals {
		page.Totals = append(page.Totals, OwedTotal{Asset: asset, Amount: sum})
	}
	slices.SortFunc(page.Totals, func(a, b OwedTotal) int {
		return cmp.Or(cmp.Compare(a.ChainID, b.ChainID), strings.Compare(a.Token, b.Token))
	})
	return page, nil
}
