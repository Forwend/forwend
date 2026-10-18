package invoice

import (
	"context"
	"fmt"
	"math/big"

	"github.com/ensp1re/forwend/apps/backend/internal/chain"
	"github.com/jackc/pgx/v5"
)

// Owed is one row of the Owed to you list (R-95). Amount is what is left to pay on the current option, or for held
// money the held amount on the option it came to.
type Owed struct {
	// overdue: the payer can still pay it and its due date has passed; partlyPaid: the payer can still pay it and part
	// of it is in; held: money on one of its options is held for the payer (D-26), not the owner's.
	Kind        string
	InvoiceID   string
	Number      int64
	Title       string
	ClientName  string
	DueDate     string // YYYY-MM-DD; "" without one
	DaysLate    int    // overdue only
	OptionCount int    // above 1 the client chooses, so an unpaid row reads in USD (D-75)
	chain.Asset
	Amount *big.Int
}

// Owed lists the profile's invoices the payer can still pay that are overdue (due date before today's UTC date) or
// partly paid, with what is left (PaidToOwnerSQL), then every option with money held for the payer. The caller has
// checked that the user owns the profile.
func (s *Service) Owed(ctx context.Context, profileID string) ([]Owed, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT kind, id, number, title, client_name, due_date, days_late, option_count, chain_id, token, symbol, decimals,
		       amount::text
		FROM (
		    SELECT CASE WHEN invoices.due_date < (now() AT TIME ZONE 'UTC')::date THEN 'overdue' ELSE 'partlyPaid' END AS kind,
		           invoices.id, invoices.number, coalesce(invoices.title, '') AS title,
		           coalesce(invoices.client_name, '') AS client_name,
		           coalesce(to_char(invoices.due_date, 'YYYY-MM-DD'), '') AS due_date,
		           greatest((now() AT TIME ZONE 'UTC')::date - invoices.due_date, 0) AS days_late,
		           (SELECT count(*) FROM invoices o WHERE o.id = invoices.id OR o.main_id = invoices.id) AS option_count,
		           invoices.chain_id, invoices.token_contract AS token, t.symbol, t.decimals,
		           invoices.amount + `+PaidToOwnerSQL("invoices.option_id")+` AS amount
		    FROM `+invoicesCurrent+` JOIN tokens t ON t.chain_id = invoices.chain_id AND t.contract = invoices.token_contract
		    WHERE invoices.profile_id = $1 AND `+StatusFilterSQL+` = 'open'
		      AND (invoices.due_date < (now() AT TIME ZONE 'UTC')::date OR invoices.payment_status = 'partially_paid')
		    UNION ALL
		    SELECT 'held', m.id, m.number, coalesce(m.title, ''), coalesce(m.client_name, ''),
		           coalesce(to_char(m.due_date, 'YYYY-MM-DD'), ''), 0,
		           (SELECT count(*) FROM invoices c WHERE c.id = m.id OR c.main_id = m.id),
		           o.chain_id, o.token_contract, t.symbol, t.decimals, -sum(e.amount)
		    FROM ledger_entries e JOIN ledger_transactions x ON x.id = e.transaction_id
		    JOIN invoices o ON o.id = x.invoice_id JOIN invoices m ON m.id = coalesce(o.main_id, o.id)
		    JOIN tokens t ON t.chain_id = o.chain_id AND t.contract = o.token_contract
		    WHERE m.profile_id = $1 AND e.account = 'payer_held'
		    GROUP BY m.id, o.id, t.symbol, t.decimals
		    HAVING sum(e.amount) <> 0
		) owed
		WHERE amount > 0 -- paid in full and waiting for the second RPC: nothing is left
		ORDER BY CASE kind WHEN 'overdue' THEN 0 WHEN 'partlyPaid' THEN 1 ELSE 2 END, days_late DESC, number DESC, token`,
		profileID)
	if err != nil {
		return nil, fmt.Errorf("read owed: %w", err)
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (Owed, error) {
		var o Owed
		var amount string
		err := row.Scan(&o.Kind, &o.InvoiceID, &o.Number, &o.Title, &o.ClientName, &o.DueDate, &o.DaysLate,
			&o.OptionCount, &o.ChainID, &o.Token, &o.Symbol, &o.Decimals, &amount)
		o.Amount, _ = new(big.Int).SetString(amount, 10)
		return o, err
	})
}
