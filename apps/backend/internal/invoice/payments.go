package invoice

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"regexp"
	"slices"
	"strings"
	"time"

	"github.com/forwend/forwend/apps/backend/internal/ledger"
	"github.com/forwend/forwend/apps/backend/internal/search"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

var (
	ErrPaymentNotFound  = errors.New("payment not found")
	ErrCheckoutNotFound = errors.New("checkout session not found")
)

type paymentReader interface {
	Query(context.Context, string, ...any) (pgx.Rows, error)
	QueryRow(context.Context, string, ...any) pgx.Row
}

type PaymentSource string

const (
	SourceInvoice     PaymentSource = PaymentSource(PurposeInvoice)
	SourceCheckout    PaymentSource = PaymentSource(PurposeCheckout)
	SourceRequest     PaymentSource = PaymentSource(PurposeRequest)
	SourcePaymentLink PaymentSource = "payment_link"
)

func (i Invoice) PaymentSource() PaymentSource {
	if i.LinkID != "" {
		return SourcePaymentLink
	}
	return PaymentSource(i.Purpose)
}

// D-114: the merchant's payment and wallet states, derived from separate facts; the raw statuses keep their values.
var (
	PaymentStates = []string{"waiting", "confirming", "partially_paid", "paid", "overpaid", "expired", "canceled"}
	WalletStates  = []string{"none", "pending", "in_wallet", "delayed", "refused"}
)

// PaymentStateSQL: a checkout has no cancel of its own, so its expire action's cancel reads expired, as the session
// status does. Overpaid is paid with money held for the payer on any option.
const PaymentStateSQL = `CASE WHEN invoices.payment_status = 'canceled' AND invoices.purpose <> 'checkout' THEN 'canceled'
 WHEN invoices.payment_status = 'paid' AND EXISTS (SELECT 1 FROM invoices held_option
   JOIN ledger_transactions held_journal ON held_journal.invoice_id = held_option.id
   JOIN ledger_entries held_entry ON held_entry.transaction_id = held_journal.id AND held_entry.account = 'payer_held'
   WHERE held_option.id = invoices.id OR held_option.main_id = invoices.id
   GROUP BY held_option.id HAVING sum(held_entry.amount) < 0) THEN 'overpaid'
 WHEN invoices.payment_status = 'paid' THEN 'paid'
 WHEN invoices.payment_status IN ('expired', 'expired_partially_paid', 'canceled') OR ` + ClosedSQL + ` THEN 'expired'
 WHEN invoices.payment_status = 'detected' OR ` + ConfirmingSQL + ` THEN 'confirming'
 WHEN invoices.payment_status = 'partially_paid' THEN 'partially_paid'
 ELSE 'waiting' END`

// PaymentStateColumnsSQL is what each state needs of the raw status columns, as StatusColumnsSQL.
var PaymentStateColumnsSQL = map[string]string{
	"waiting":        "invoices.payment_status = 'open'",
	"confirming":     "invoices.payment_status IN ('open', 'detected', 'partially_paid')",
	"partially_paid": "invoices.payment_status = 'partially_paid'",
	"paid":           "invoices.payment_status = 'paid'",
	"overpaid":       "invoices.payment_status = 'paid'",
	"expired":        "invoices.payment_status <> 'paid'",
	"canceled":       "invoices.payment_status = 'canceled'",
}

// WalletSQL: a settle that waits for a retry, the daily cap or an unresolved transaction is delayed (D-114).
const WalletSQL = `CASE WHEN invoices.settlement_status = 'settled' THEN 'in_wallet' WHEN invoices.payment_status <> 'paid' THEN 'none'
 ELSE coalesce((SELECT CASE WHEN wallet.status = 'refused' THEN 'refused' WHEN wallet.wait IS NOT NULL THEN 'delayed' END
   FROM settlement_intents wallet WHERE wallet.invoice_id = invoices.option_id), 'pending') END`

// walletColumnsSQL is what each wallet state needs of the raw status columns, as StatusColumnsSQL.
var walletColumnsSQL = map[string]string{
	"none":      "invoices.settlement_status <> 'settled' AND invoices.payment_status <> 'paid'",
	"pending":   "invoices.settlement_status <> 'settled' AND invoices.payment_status = 'paid'",
	"in_wallet": "invoices.settlement_status = 'settled'",
	"delayed":   "invoices.settlement_status <> 'settled' AND invoices.payment_status = 'paid'",
	"refused":   "invoices.settlement_status <> 'settled' AND invoices.payment_status = 'paid'",
}

type PaymentQuery struct {
	Search                                                search.Query
	Summary                                               bool
	IncludeWebhookOperations                              bool
	Attention                                             bool
	Cursor, StoreID, LinkID, Reference                    string
	Source                                                PaymentSource
	Status, PaymentStatus, SettlementStatus, RefundStatus string
	State, Wallet                                         string
	Limit                                                 int
	Purpose                                               Purpose
	Stores                                                []string
	Livemode                                              *bool
}

func (s *Service) Payment(ctx context.Context, profileID, id string) (Invoice, error) {
	inv, err := s.GetOfProfile(ctx, profileID, id)
	if errors.Is(err, ErrNotFound) || err == nil && inv.ID != strings.ToLower(id) {
		return Invoice{}, ErrPaymentNotFound
	}
	return inv, err
}

// Payments includes attempts without documents; its cursor never depends on invoice numbering.
func (s *Service) Payments(ctx context.Context, profileID string, q PaymentQuery) (Page, error) {
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return Page{}, err
	}
	defer tx.Rollback(ctx)
	page, err := readPaymentPage(ctx, tx, profileID, q)
	if err != nil {
		return Page{}, err
	}
	return page, tx.Commit(ctx)
}

func readPaymentPage(ctx context.Context, db paymentReader, profileID string, q PaymentQuery) (Page, error) {
	args, where, err := paymentWhere(profileID, q)
	if err != nil {
		return Page{}, err
	}
	rows, err := db.Query(ctx, "SELECT "+invoiceColumns+" FROM "+invoicesCurrent+" WHERE "+where+
		" ORDER BY created_at DESC, id DESC LIMIT $2", args...)
	if err != nil {
		return Page{}, fmt.Errorf("list payments: %w", err)
	}
	items, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (Invoice, error) { return scanInvoice(row) })
	if err != nil {
		return Page{}, fmt.Errorf("list payments: %w", err)
	}
	page := Page{Items: items}
	if len(items) > q.Limit {
		page.Items = items[:q.Limit]
		last := page.Items[q.Limit-1]
		page.NextCursor = base64.RawURLEncoding.EncodeToString([]byte(last.CreatedAt.UTC().Format(time.RFC3339Nano) + "|" + last.ID))
	}
	ids := make([]string, len(page.Items))
	for i := range page.Items {
		ids[i] = page.Items[i].OptionID
	}
	amounts, err := ledger.ReadAmountsFor(ctx, db, ids)
	if err != nil {
		return Page{}, err
	}
	for i := range page.Items {
		page.Items[i].Amounts = amounts[page.Items[i].OptionID]
	}
	mains := make([]string, len(page.Items))
	for i := range page.Items {
		mains[i] = page.Items[i].ID
	}
	receipts, err := readPaymentReceipts(ctx, db, mains)
	if err != nil {
		return Page{}, err
	}
	for i := range page.Items {
		page.Items[i].Receipts = receipts[page.Items[i].ID]
	}
	// R-239: the list tags a payment a deposit through 1Click pays.
	crossChain, err := readCrossChainFor(ctx, db, mains, true)
	if err != nil {
		return Page{}, err
	}
	for i := range page.Items {
		page.Items[i].CrossChain = crossChain[page.Items[i].ID]
	}

	return page, nil
}

// Must stay the expression of the invoices_payment_search trigram index (migration 00088) on the main row's columns.
const paymentSearchText = `(coalesce(reference,'') || ' ' || coalesce(title,'') || ' ' || coalesce(client_name,'') || ' ' || coalesce(client_email,'') || ' ' || id
	|| ' ' || coalesce('INV-' || lpad(number::text, greatest(length(number::text), 4), '0'), '') || ' ' || main_receive_address)`

// A whole transaction hash or receive address also finds deposits, returns and other options; chains lead the unique
// (chain_id, ...) indexes these lookups use.
var fullHex = regexp.MustCompile(`^0x([0-9a-f]{40}|[0-9a-f]{64})$`)

const hexMatchSQL = `SELECT coalesce(o.main_id,o.id) FROM chains c JOIN invoices o ON o.chain_id=c.chain_id WHERE o.receive_address=$%[1]d
 UNION ALL SELECT coalesce(o.main_id,o.id) FROM chains c JOIN chain_transfers t ON t.chain_id=c.chain_id JOIN invoices o ON o.id=t.invoice_id
   WHERE t.tx_hash=$%[1]d AND t.status<>'reorged'
 UNION ALL SELECT coalesce(o.main_id,o.id) FROM chains c JOIN receiver_outflows f ON f.chain_id=c.chain_id JOIN invoices o ON o.id=f.invoice_id
   WHERE f.tx_hash=$%[1]d`

func paymentWhere(profileID string, q PaymentQuery) ([]any, string, error) {
	if q.Limit < 1 || q.Limit > MaxLimit {
		return nil, "", fmt.Errorf("%w: limit must be 1 to %d", ErrInvalid, MaxLimit)
	}
	args := []any{profileID, q.Limit + 1}
	where := "profile_id = $1"
	if q.Search.Like != nil {
		args = append(args, q.Search.Like, q.Search.Amount)
		match := fmt.Sprintf("%s ILIKE $%d OR amount=$%d::numeric * 10::numeric ^ (SELECT decimals FROM tokens WHERE chain_id=invoices.chain_id AND contract=invoices.token_contract)", paymentSearchText, len(args)-1, len(args))
		if hex := strings.ToLower(strings.Trim(*q.Search.Like, "%")); fullHex.MatchString(hex) {
			args = append(args, hex)
			match += " OR invoices.id = ANY(ARRAY(" + fmt.Sprintf(hexMatchSQL, len(args)) + "))"
		}
		where += " AND (" + match + ")"
	}
	if q.Reference != "" {
		args = append(args, q.Reference)
		where += fmt.Sprintf(" AND reference = $%d", len(args))
	}

	if q.Cursor != "" {
		if len(q.Cursor) > 256 {
			return nil, "", fmt.Errorf("%w: cursor is not one this API returned", ErrInvalid)
		}
		raw, err := base64.RawURLEncoding.DecodeString(q.Cursor)
		at, id, ok := strings.Cut(string(raw), "|")
		before, parseErr := time.Parse(time.RFC3339Nano, at)
		if err != nil || parseErr != nil || !ok || len(id) != 66 ||
			!strings.HasPrefix(id, "0x") || strings.Trim(id[2:], "0123456789abcdef") != "" {
			return nil, "", fmt.Errorf("%w: cursor is not one this API returned", ErrInvalid)
		}
		args = append(args, before, id)
		where += fmt.Sprintf(" AND (created_at,id) < ($%d,$%d)", len(args)-1, len(args))
	}
	if q.StoreID != "" {
		var id pgtype.UUID
		if id.Scan(q.StoreID) != nil {
			return nil, "", fmt.Errorf("%w: storeId must be a UUID", ErrInvalid)
		}
		args = append(args, id)
		where += fmt.Sprintf(" AND store_id = $%d", len(args))
	}
	if q.LinkID != "" {
		var id pgtype.UUID
		if id.Scan(q.LinkID) != nil {
			return nil, "", fmt.Errorf("%w: linkId must be a UUID", ErrInvalid)
		}
		args = append(args, id)
		where += fmt.Sprintf(" AND link_id = $%d", len(args))
	}
	if q.Stores != nil {
		args = append(args, q.Stores)
		where += fmt.Sprintf(" AND store_id = ANY($%d::uuid[])", len(args))
	}
	if q.Livemode != nil {
		args = append(args, *q.Livemode)
		where += fmt.Sprintf(" AND (SELECT livemode FROM chains c WHERE c.chain_id = invoices.chain_id) = $%d", len(args))
	}
	if q.Purpose != "" {
		args = append(args, q.Purpose)
		where += fmt.Sprintf(" AND purpose = $%d", len(args))
	}
	if q.Source != "" {
		switch q.Source {
		case SourcePaymentLink:
			where += " AND link_id IS NOT NULL"
		case SourceInvoice, SourceCheckout, SourceRequest:
			args = append(args, string(q.Source))
			where += fmt.Sprintf(" AND purpose = $%d AND link_id IS NULL", len(args))
		default:
			return nil, "", fmt.Errorf("%w: source must be invoice, checkout, payment_link or request", ErrInvalid)
		}
	}
	if q.Status != "" {
		if !slices.Contains(StatusFilters, q.Status) {
			return nil, "", fmt.Errorf("%w: invalid status", ErrInvalid)
		}
		args = append(args, q.Status)
		where += fmt.Sprintf(" AND %s AND ($%d = 'paid' AND invoices.payment_status = 'paid' OR %s = $%d)",
			StatusColumnsSQL[q.Status], len(args), ListStatusFilterSQL, len(args))
	}
	for _, filter := range []struct {
		name, sql, value string
		allowed          []string
		columns          map[string]string
	}{
		{"payment_status", "payment_status", q.PaymentStatus, []string{ledger.Open, ledger.Detected, ledger.PartiallyPaid, ledger.Paid, ledger.Expired, ledger.ExpiredPartiallyPaid, ledger.Canceled}, nil},
		{"settlement_status", "settlement_status", q.SettlementStatus, []string{"none", "pending", "settled"}, nil},
		{"refund_status", "refund_status", q.RefundStatus, []string{"none", "held", "refund_pending", "refunded"}, nil},
		{"state", PaymentStateSQL, q.State, PaymentStates, PaymentStateColumnsSQL},
		{"wallet", WalletSQL, q.Wallet, WalletStates, walletColumnsSQL},
	} {
		if filter.value == "" {
			continue
		}
		if !slices.Contains(filter.allowed, filter.value) {
			return nil, "", fmt.Errorf("%w: invalid %s", ErrInvalid, filter.name)
		}
		if filter.columns != nil {
			where += " AND " + filter.columns[filter.value]
		}
		args = append(args, filter.value)
		where += fmt.Sprintf(" AND %s = $%d", filter.sql, len(args))
	}
	if q.Attention {
		args = append(args, int64(SettlementAttentionAfter/time.Second))
		where += " AND (" + paymentAttentionSQL(fmt.Sprintf("$%d", len(args))) + ")"
	}
	return args, where, nil
}
