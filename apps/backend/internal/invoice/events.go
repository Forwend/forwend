package invoice

import (
	"context"
	"fmt"
	"math/big"
	"time"

	"github.com/ensp1re/forwend/apps/backend/internal/chain"
	"github.com/jackc/pgx/v5"
)

// MaxEvents bounds one read of the bell's events.
const MaxEvents = 50

// Event is a paid, settled or held-money event of one of the profile's invoices (R-81), the same as the owner's email
// (R-80). Amount is the option's amount, or for held money the amount newly held.
type Event struct {
	ID          int64
	Kind        string
	InvoiceID   string
	Number      int64
	chain.Asset // symbol and decimals of the option it happened on
	Amount      *big.Int
	At          time.Time
}

// Events lists the profile's newest events first; the caller has checked that the user owns the profile.
func (s *Service) Events(ctx context.Context, profileID string, limit int) ([]Event, error) {
	if limit < 1 || limit > MaxEvents {
		return nil, fmt.Errorf("%w: limit must be 1 to %d", ErrInvalid, MaxEvents)
	}
	rows, err := s.pool.Query(ctx, `SELECT e.id, e.kind, m.id, m.number, o.chain_id, o.token_contract, t.symbol, t.decimals,
		    coalesce(e.payload->>'amount', o.amount::text), e.created_at
		FROM outbox_events e JOIN invoices m ON m.id = e.invoice_id
		JOIN invoices o ON o.id = e.payload->>'option' JOIN tokens t ON t.chain_id = o.chain_id AND t.contract = o.token_contract
		WHERE m.profile_id = $1 AND m.main_id IS NULL ORDER BY e.id DESC LIMIT $2`, profileID, limit)
	if err != nil {
		return nil, fmt.Errorf("read events: %w", err)
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (Event, error) {
		var e Event
		var amount string
		err := row.Scan(&e.ID, &e.Kind, &e.InvoiceID, &e.Number, &e.ChainID, &e.Token, &e.Symbol, &e.Decimals, &amount, &e.At)
		e.Amount, _ = new(big.Int).SetString(amount, 10)
		return e, err
	})
}
