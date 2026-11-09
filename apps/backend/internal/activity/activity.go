// Package activity lists a profile's invoices and deposits (R-33) and its wallet's token transfers (R-38), newest
// first, in cursor pages.
package activity

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"math/big"
	"slices"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/forwend/forwend/apps/backend/internal/chain"
	"github.com/forwend/forwend/apps/backend/internal/invoice"
	"github.com/forwend/forwend/apps/backend/internal/search"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	Invoice = "invoice"
	Deposit = "deposit"
)

const (
	DefaultLimit = 50
	MaxLimit     = 100
)

var ErrInvalid = errors.New("invalid activity request")

// Item is an invoice or a non-reorged deposit. For an invoice, Status is its payment status, SettlementStatus is set
// and TxHash is the settle transaction once settled; for a deposit, Status is detected or confirmed and At is its block
// time, or its payment's creation when that is later within the block's whole second.
type Item struct {
	PaymentStatus    string
	Confirming       bool
	Kind             string
	At               time.Time
	InvoiceID        string
	chain.Asset      // symbol and decimals also for a token no longer enabled
	Amount           *big.Int
	Status           string
	SettlementStatus string
	TxHash           string
	// OptionCount is the invoice's accepted options: above 1 the client chooses, so the invoice reads in USD rather
	// than its first option's token (R-70). 1 for a deposit, which is in the token it moved.
	OptionCount int
	// Closed: the invoice's checkout closed and it can no longer be paid (invoice.ClosedSQL); false for a deposit.
	Closed bool
	// Held: a deposit the owner gets none of, held for the payer (D-26); under no status filter but all. False for an
	// invoice.
	Held bool
	// A booked deposit's parts: what the ledger booked to the owner and what it holds for the payer (D-114). They add
	// up to Amount; both nil for an invoice and for a deposit not booked yet.
	MerchantAmount, HeldAmount *big.Int
	// The payment's: Number is nil for a checkout session, whose Reference names the order (D-107).
	Purpose      invoice.Purpose
	DocumentKind invoice.DocumentKind
	Number       *int64
	Reference    string
	ClientName   string
	Title        string
	key          string
}

// NextCursor is "" on the last page.
type Page struct {
	Items      []Item
	NextCursor string
}

type Service struct {
	pool *pgxpool.Pool
}

func NewService(pool *pgxpool.Pool) *Service {
	return &Service{pool: pool}
}

// heldSQL says whether the owner gets none of chain transfer t, on option row i.
// Booked: held when none went to the owner, or after a partly paid expiry moved it to the payer.
// Not booked yet: the ledger's split rule (ledger.Final, late, money on an option the client didn't pay with).
// Only deposit and reopen rows name a transfer; saying so lets the lookup use their index.
const heldSQL = `CASE WHEN t.booked THEN NOT EXISTS (SELECT 1 FROM ledger_transactions x
    JOIN ledger_entries e ON e.transaction_id = x.id WHERE x.chain_transfer_id = t.id
    AND x.kind IN ('deposit', 'reopen') AND e.account = 'recipient_payable') OR i.payment_status = 'expired_partially_paid'
  ELSE t.block_time > i.closes_at OR i.payment_status IN ('paid', 'expired', 'expired_partially_paid', 'canceled')
    OR coalesce((SELECT m.chosen_id <> i.id FROM invoices m WHERE m.id = coalesce(i.main_id, i.id)), false) END`

// depositAtSQL is chain transfer t's block time, but never before its option row i was made: a block time has whole
// seconds, and money paid within the second a payment was made still comes after it.
const depositAtSQL = `greatest(to_timestamp(t.block_time), i.created_at)`

// merchantSQL is the part of booked transfer t the owner gets: none once a partly paid expiry moved it to the payer.
const merchantSQL = `CASE WHEN t.booked THEN CASE WHEN i.payment_status = 'expired_partially_paid' THEN 0
  ELSE (` + invoice.DepositPaidSQL + `)::numeric END END`

// List filters both billing events and deposits by their payment's state. Held deposits appear only without a filter.
// An invoice or request appears once numbered; a checkout session has no document, so only its deposits appear.
func (s *Service) List(ctx context.Context, profileID, cursor string, limit int, status, state string, q search.Query) (Page, error) {
	if limit < 1 || limit > MaxLimit {
		return Page{}, fmt.Errorf("%w: limit must be 1 to %d", ErrInvalid, MaxLimit)
	}
	if status != "" && !slices.Contains(invoice.StatusFilters, status) {
		return Page{}, fmt.Errorf("%w: status must be one of %v", ErrInvalid, invoice.StatusFilters)
	}
	if state != "" && !slices.Contains(invoice.PaymentStates, state) {
		return Page{}, fmt.Errorf("%w: state must be one of %v", ErrInvalid, invoice.PaymentStates)
	}
	// Each condition is added only when used: a cached generic plan of "$n IS NULL OR ..." never uses the index.
	args := []any{profileID, limit + 1}
	arg := func(v any) string {
		args = append(args, v)
		return fmt.Sprintf("$%d", len(args))
	}
	invoices := "invoices.profile_id = $1 AND invoices.number IS NOT NULL AND " + inMode("invoices.chain_id")
	deposits := "i.profile_id = $1 AND t.status <> 'reorged' AND " + inMode("t.chain_id")
	depositsFrom := "chain_transfers t JOIN invoices i ON i.id = t.invoice_id"
	// Newest first; at the same time a deposit comes before an invoice, and the key breaks the other ties, so pages
	// never skip or repeat an item. Each part reads only rows after the cursor, and at most a page of them.
	if cursor != "" {
		after, kind, afterKey, err := decode(cursor)
		if err != nil {
			return Page{}, err
		}
		at, key := arg(after), arg(afterKey)
		if kind == Invoice {
			invoices += " AND (invoices.created_at, invoices.id) < (" + at + ", " + key + ")"
			deposits += " AND " + depositAtSQL + " < " + at
		} else {
			invoices += " AND invoices.created_at <= " + at
			deposits += " AND (" + depositAtSQL + ", t.id::text) < (" + at + ", " + key + ")"
		}
	}
	if status != "" {
		filter := arg(status)
		match := invoice.StatusColumnsSQL[status] + " AND (" + filter + " = 'paid' AND invoices.payment_status = 'paid' OR " +
			invoice.ListStatusFilterSQL + " = " + filter + ")"
		invoices += " AND " + match
		deposits += " AND NOT " + heldSQL + " AND " + match
	}
	// D-114: the Payments list's states; a deposit takes its payment's.
	if state != "" {
		match := invoice.PaymentStateColumnsSQL[state] + " AND " + invoice.PaymentStateSQL + " = " + arg(state)
		invoices += " AND " + match
		deposits += " AND NOT " + heldSQL + " AND " + match
	}
	if status != "" || state != "" {
		depositsFrom += " JOIN invoices_current invoices ON invoices.id = coalesce(i.main_id, i.id)"
	}
	if q.Like != nil {
		like := arg(*q.Like)
		amount := "NULL"
		if q.Amount != nil {
			amount = arg(*q.Amount)
		}
		token := func(chainID, contract, value string) string {
			return "EXISTS (SELECT 1 FROM tokens tk WHERE tk.chain_id = " + chainID + " AND tk.contract = " + contract +
				" AND (tk.symbol ILIKE " + like + " OR " + value + " = " + amount + "::numeric * 10::numeric ^ tk.decimals))"
		}
		// A settled invoice matches its settle transaction.
		invoices += ` AND (coalesce((SELECT s.tx_hash FROM settlement_intents s WHERE s.invoice_id = invoices.option_id
			AND s.status = 'confirmed'), '') ILIKE ` + like + " OR " +
			token("invoices.chain_id", "invoices.token_contract", "invoices.amount") + ")"
		deposits += " AND (t.tx_hash ILIKE " + like + " OR " + token("t.chain_id", "t.token_contract", "t.amount") + ")"
	}
	rows, err := s.pool.Query(ctx, `
		SELECT a.kind, a.at, a.key, a.invoice_id, a.chain_id, a.token, tk.symbol, tk.decimals, a.amount::text, a.status,
		    CASE a.kind WHEN 'invoice' THEN invoices.settlement_status ELSE '' END,
		    CASE a.kind WHEN 'invoice' THEN coalesce((SELECT s.tx_hash FROM settlement_intents s
		        WHERE s.invoice_id = invoices.option_id AND s.status = 'confirmed'), '') ELSE t.tx_hash END,
		    CASE a.kind WHEN 'invoice' THEN (SELECT count(*) FROM invoices o WHERE o.id = invoices.id OR o.main_id = invoices.id)
		        ELSE 1 END,
		    `+invoice.ClosedSQL+`, CASE a.kind WHEN 'deposit' THEN `+heldSQL+` ELSE false END,
		    invoices.payment_status, `+invoice.ConfirmingSQL+`, (`+merchantSQL+`)::text, (t.amount - (`+merchantSQL+`))::text,
		    invoices.purpose, invoices.document_kind, invoices.number, coalesce(invoices.reference, ''),
		    coalesce(invoices.client_name, ''), coalesce(invoices.title, '')
		FROM (
		    (SELECT 'invoice' AS kind, invoices.created_at AS at, invoices.id AS key, invoices.id AS invoice_id,
		         NULL::bigint AS transfer_id, invoices.chain_id, invoices.token_contract AS token, invoices.amount,
		         invoices.payment_status AS status
		     FROM invoices_current invoices WHERE `+invoices+`
		     ORDER BY invoices.created_at DESC, invoices.id DESC LIMIT $2)
		    UNION ALL
		    (SELECT 'deposit', `+depositAtSQL+`, t.id::text, coalesce(i.main_id, i.id), t.id, t.chain_id, t.token_contract,
		         t.amount, t.status
		     FROM `+depositsFrom+` WHERE `+deposits+`
		     ORDER BY `+depositAtSQL+` DESC, t.id::text DESC LIMIT $2)
		) a JOIN tokens tk ON tk.chain_id = a.chain_id AND tk.contract = a.token
		JOIN invoices_current invoices ON invoices.id = a.invoice_id
		LEFT JOIN chain_transfers t ON t.id = a.transfer_id LEFT JOIN invoices i ON i.id = t.invoice_id
		ORDER BY a.at DESC, a.kind, a.key DESC LIMIT $2`, args...)
	if err != nil {
		return Page{}, fmt.Errorf("read activity: %w", err)
	}
	items, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (Item, error) {
		var it Item
		var amount string
		var merchant, held *string
		err := row.Scan(&it.Kind, &it.At, &it.key, &it.InvoiceID, &it.ChainID, &it.Token, &it.Symbol, &it.Decimals,
			&amount, &it.Status, &it.SettlementStatus, &it.TxHash, &it.OptionCount, &it.Closed, &it.Held, &it.PaymentStatus,
			&it.Confirming, &merchant, &held, &it.Purpose, &it.DocumentKind, &it.Number, &it.Reference, &it.ClientName,
			&it.Title)
		it.Amount, _ = new(big.Int).SetString(amount, 10)
		if merchant != nil && held != nil {
			it.MerchantAmount, _ = new(big.Int).SetString(*merchant, 10)
			it.HeldAmount, _ = new(big.Int).SetString(*held, 10)
		}
		return it, err
	})
	if err != nil {
		return Page{}, fmt.Errorf("read activity: %w", err)
	}
	page := Page{Items: items}
	if len(items) > limit {
		page.Items = items[:limit]
		last := page.Items[limit-1]
		page.NextCursor = encode(last.At, last.Kind, last.key)
	}
	return page, nil
}

// A cursor is the last item's time (Unix microseconds, Postgres' precision), kind and key.
func encode(at time.Time, kind, key string) string {
	return base64.RawURLEncoding.EncodeToString([]byte(fmt.Sprintf("%d|%s|%s", at.UnixMicro(), kind, key)))
}

func decode(cursor string) (time.Time, string, string, error) {
	raw, err := base64.RawURLEncoding.DecodeString(cursor)
	parts := strings.SplitN(string(raw), "|", 3)
	if err != nil || len(parts) != 3 || (parts[1] != Invoice && parts[1] != Deposit) ||
		!utf8.ValidString(parts[2]) || strings.ContainsRune(parts[2], 0) {
		return time.Time{}, "", "", fmt.Errorf("%w: cursor is not one this API returned", ErrInvalid)
	}
	micros, err := strconv.ParseInt(parts[0], 10, 64)
	if err != nil {
		return time.Time{}, "", "", fmt.Errorf("%w: cursor is not one this API returned", ErrInvalid)
	}
	return time.UnixMicro(micros), parts[1], parts[2], nil
}
