package activity

import (
	"context"
	"encoding/base64"
	"fmt"
	"math/big"
	"strconv"
	"strings"
	"time"

	"github.com/forwend/forwend/apps/backend/internal/chain"
	"github.com/forwend/forwend/apps/backend/internal/invoice"
	"github.com/forwend/forwend/apps/backend/internal/ledger"
	"github.com/forwend/forwend/apps/backend/internal/search"
	"github.com/jackc/pgx/v5"
)

// Transfer is an enabled-token transfer of the profile's wallet (R-38); reorged ones are left out. At is the block
// time; Invoice, Label and own classify it (R-108): see Classification.
type Transfer struct {
	chain.Asset
	Direction    string
	Amount       *big.Int
	Counterparty string
	TxHash       string
	LogIndex     uint64
	BlockNumber  uint64
	At           time.Time
	Status       string
	Invoice      *TransferInvoice
	Payment      *TransferPayment
	Label        string
	// FeePaid is the gas the wallet paid for the Forwend send behind an outgoing transfer, in the token's base units
	// (R-224): 0 where Forwend paid, nil for other transfers or a fee not known yet.
	FeePaid *big.Int
	// RecordsCurrency is the profile's other records currency, "" for none (R-110); fx its ECB rates for this transfer.
	RecordsCurrency string
	fx              *rates
	own             bool
	id              int64
}

// rates are USD and the records currency per 1 EUR, on the ECB day that values a transfer.
type rates struct {
	day      time.Time
	usd, cur *big.Rat
}

// transferSQL selects a profile's transfers ($1) with what classifies them (R-108): the invoice paid from one of
// its receive addresses (a link invoice once it has a number, R-141), an own-profile counterparty, the user's label,
// and the ECB rates that value it (R-110).
var transferSQL = `
	SELECT t.id, t.chain_id, t.token_contract, tk.symbol, tk.decimals, t.direction, t.amount::text, t.counterparty,
	       t.tx_hash, t.log_index, t.block_number, t.block_time, t.status, inv.id, inv.number, inv.client_name,
        inv.purpose, inv.document_kind, inv.policy_exception, inv.unreconciled,
	       EXISTS (SELECT 1 FROM profile_wallets ow JOIN profiles op ON op.id = ow.profile_id
	               WHERE op.user_id = p.user_id AND op.id <> p.id AND ow.chain_family = t.chain_family
	                 AND ow.address = t.counterparty),
	       coalesce(l.label, ''), coalesce(p.records_currency, ''), fx.day, fx.usd::text, fx.cur::text,
	       (SELECT x.fee_paid::text FROM sends x WHERE t.direction = 'out' AND x.chain_id = t.chain_id
	            AND x.tx_hash = t.tx_hash AND x.from_address = t.wallet_address AND x.token_contract = t.token_contract
	            AND x.to_address = t.counterparty AND x.amount = t.amount)
	FROM wallet_transfers t
	JOIN profile_wallets w ON w.chain_family = t.chain_family AND w.address = t.wallet_address
	JOIN profiles p ON p.id = w.profile_id
	JOIN tokens tk ON tk.chain_id = t.chain_id AND tk.contract = t.token_contract
	LEFT JOIN LATERAL (SELECT m.id, m.number, m.client_name, m.purpose, m.document_kind,
                       coalesce(evidence.policy_exception,'') AS policy_exception, ` + ledger.UnreconciledSQL("o.id") + ` AS unreconciled
                    FROM invoices o JOIN invoices m ON m.id = coalesce(o.main_id, o.id)
	                   JOIN receiver_outflows evidence ON evidence.invoice_id = o.id AND evidence.kind = 'settlement'
                    WHERE t.direction = 'in' AND o.chain_id = t.chain_id AND o.token_contract = t.token_contract
                      AND o.receive_address = t.counterparty AND evidence.destination = t.wallet_address AND evidence.destination = o.recipient_address
                      AND evidence.tx_hash = t.tx_hash AND evidence.block_hash = t.block_hash
                      AND evidence.transfer_log_index = t.log_index AND evidence.amount = t.amount
                      AND evidence.ledger_transaction_id IS NOT NULL
                      AND m.profile_id = p.id) inv ON true
	LEFT JOIN transfer_labels l ON l.profile_id = p.id AND l.chain_id = t.chain_id AND l.tx_hash = t.tx_hash
	     AND l.log_index = t.log_index
	LEFT JOIN LATERAL (SELECT u.day, u.per_eur AS usd, CASE WHEN p.records_currency = 'EUR' THEN 1 ELSE c.per_eur END AS cur
	                   FROM ecb_rates u LEFT JOIN ecb_rates c ON c.currency = p.records_currency AND c.day = u.day
	                   WHERE p.records_currency IS NOT NULL AND u.currency = 'USD'
	                     AND u.day <= (to_timestamp(t.block_time) AT TIME ZONE 'UTC')::date
	                     -- The ECB closes at most 4 days in a row (Easter): an older rate is a missed read, so none.
	                     AND u.day > (to_timestamp(t.block_time) AT TIME ZONE 'UTC')::date - 7
	                   ORDER BY u.day DESC LIMIT 1) fx ON true
	WHERE w.profile_id = $1 AND t.status <> 'reorged' AND ` + inMode("t.chain_id") + " AND " + notFee

// notFee leaves out a send's network fee: a Tempo send's fee to the fee manager, or a paymaster's for a relayed send.
// The send's row shows it as the fee paid (R-224), not as money sent. The balance history still counts it, as the
// balance does.
var notFee = `NOT EXISTS (SELECT 1 FROM sends fs WHERE (` + chain.TempoFee("t", "fs") + `) OR (` +
	chain.PaymasterFee("t", "fs") + `))`

// inMode keeps the rows on a chain of profile $1's mode: the dashboard shows one mode at a time (D-120, R-221).
func inMode(chainID string) string {
	return "EXISTS (SELECT 1 FROM chains mc JOIN profiles mp ON mp.id = $1 WHERE mc.chain_id = " + chainID +
		" AND mc.livemode = mp.livemode)"
}

// listed leaves out an incoming transfer under 0.10 USD (R-38): such transfers are mostly spam that plants a
// look-alike address in the history. A settlement from one of the profile's invoices and a transfer from another of
// the user's profiles always show. The balance still counts every transfer; it is read from the chain.
const listed = `(t.direction = 'out' OR t.amount >= (10::numeric ^ (tk.decimals - 1))
	OR EXISTS (SELECT 1 FROM receiver_outflows o WHERE o.kind = 'settlement' AND o.chain_id = t.chain_id
	    AND o.tx_hash = t.tx_hash AND o.block_hash = t.block_hash AND o.transfer_log_index = t.log_index
	    AND o.destination = t.wallet_address)
	OR EXISTS (SELECT 1 FROM profiles p JOIN profiles op ON op.user_id = p.user_id AND op.id <> p.id
	    JOIN profile_wallets ow ON ow.profile_id = op.id
	    WHERE p.id = w.profile_id AND ow.chain_family = t.chain_family AND ow.address = t.counterparty))`

func scanTransfer(row pgx.CollectableRow) (Transfer, error) {
	var (
		t                                      Transfer
		amount                                 string
		at                                     int64
		invoiceID, client                      *string
		purpose, documentKind, policyException *string
		unreconciled                           *bool
		number                                 *int64
		day                                    *time.Time
		usd, cur, fee                          *string
	)
	err := row.Scan(&t.id, &t.ChainID, &t.Token, &t.Symbol, &t.Decimals, &t.Direction, &amount, &t.Counterparty,
		&t.TxHash, &t.LogIndex, &t.BlockNumber, &at, &t.Status, &invoiceID, &number, &client, &purpose, &documentKind, &policyException, &unreconciled, &t.own, &t.Label,
		&t.RecordsCurrency, &day, &usd, &cur, &fee)
	if err != nil {
		return t, err
	}
	if fee != nil {
		t.FeePaid, _ = new(big.Int).SetString(*fee, 10)
	}
	if day != nil && usd != nil && cur != nil {
		t.fx = &rates{day: *day}
		t.fx.usd, _ = new(big.Rat).SetString(*usd)
		t.fx.cur, _ = new(big.Rat).SetString(*cur)
	}
	t.Amount, _ = new(big.Int).SetString(amount, 10)
	t.At = time.Unix(at, 0).UTC()
	if invoiceID != nil {
		t.Payment = &TransferPayment{ID: *invoiceID, Purpose: invoice.Purpose(*purpose), DocumentKind: invoice.DocumentKind(*documentKind),
			PolicyException: *policyException, Unreconciled: *unreconciled}
		if number != nil && t.Payment.DocumentKind == invoice.DocumentInvoice {
			t.Invoice = &TransferInvoice{ID: *invoiceID, Number: *number}
			if client != nil {
				t.Invoice.ClientName = *client
			}
		}
	}

	return t, err
}

// NextCursor is "" on the last page.
type TransferPage struct {
	Items      []Transfer
	NextCursor string
}

// Transfers returns a page in direction ("" for both) matching q, newest block time first. The caller has checked
// the user's access to the profile.
func (s *Service) Transfers(ctx context.Context, profileID, cursor string, limit int, direction string,
	q search.Query) (TransferPage, error) {
	if limit < 1 || limit > MaxLimit {
		return TransferPage{}, fmt.Errorf("%w: limit must be 1 to %d", ErrInvalid, MaxLimit)
	}
	var only *string
	if direction != "" {
		if direction != "in" && direction != "out" {
			return TransferPage{}, fmt.Errorf("%w: direction must be in or out", ErrInvalid)
		}
		only = &direction
	}
	var afterTime, afterID *int64
	if cursor != "" {
		at, id, err := decodeTransfer(cursor)
		if err != nil {
			return TransferPage{}, err
		}
		afterTime, afterID = &at, &id
	}
	// The row id breaks ties within one block time, so pages never skip or repeat a transfer. The page is chosen first,
	// wallet by wallet along the wallet_transfers_wallet index; the invoice, label and rate joins then run for those rows
	// alone, fetched by id.
	rows, err := s.pool.Query(ctx, `WITH page AS (
		SELECT p.id, p.block_time FROM profile_wallets w CROSS JOIN LATERAL (
		    SELECT t.id, t.block_time FROM wallet_transfers t
		    JOIN tokens tk ON tk.chain_id = t.chain_id AND tk.contract = t.token_contract
		    WHERE t.chain_family = w.chain_family AND t.wallet_address = w.address AND t.status <> 'reorged' AND `+listed+`
		      AND `+inMode("t.chain_id")+` AND `+notFee+`
		      AND ($2::bigint IS NULL OR (t.block_time, t.id) < ($2, $3)) AND ($5::text IS NULL OR t.direction = $5)
		      AND ($6::text IS NULL OR t.counterparty ILIKE $6 OR t.tx_hash ILIKE $6 OR tk.symbol ILIKE $6
		           OR t.amount = $7::numeric * 10::numeric ^ tk.decimals)
		    ORDER BY t.block_time DESC, t.id DESC LIMIT $4) p
		WHERE w.profile_id = $1 ORDER BY p.block_time DESC, p.id DESC LIMIT $4)`+transferSQL+`
		  AND t.id = ANY(ARRAY(SELECT id FROM page)) ORDER BY t.block_time DESC, t.id DESC`, profileID, afterTime, afterID, limit+1, only, q.Like, q.Amount)
	if err != nil {
		return TransferPage{}, fmt.Errorf("read wallet transfers: %w", err)
	}
	items, err := pgx.CollectRows(rows, scanTransfer)
	if err != nil {
		return TransferPage{}, fmt.Errorf("read wallet transfers: %w", err)
	}
	page := TransferPage{Items: items}
	if len(items) > limit {
		page.Items = items[:limit]
		last := page.Items[limit-1]
		page.NextCursor = base64.RawURLEncoding.EncodeToString([]byte(fmt.Sprintf("%d|%d", last.At.Unix(), last.id)))
	}
	return page, nil
}

func decodeTransfer(cursor string) (at, id int64, err error) {
	raw, err := base64.RawURLEncoding.DecodeString(cursor)
	parts := strings.Split(string(raw), "|")
	if err == nil && len(parts) == 2 {
		if at, err = strconv.ParseInt(parts[0], 10, 64); err == nil {
			if id, err = strconv.ParseInt(parts[1], 10, 64); err == nil {
				return at, id, nil
			}
		}
	}
	return 0, 0, fmt.Errorf("%w: cursor is not one this API returned", ErrInvalid)
}
