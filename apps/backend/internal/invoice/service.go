package invoice

import (
	"errors"
	"fmt"
	"math/big"
	"time"

	"github.com/forwend/forwend/apps/backend/internal/profile"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Service struct {
	pool *pgxpool.Pool
	now  func() time.Time
}

func NewService(pool *pgxpool.Pool) *Service {
	return &Service{pool: pool, now: time.Now}
}

// invoiceColumns reads FROM invoicesCurrent: the main row's number and details with the current option's terms.
const invoiceColumns = `id, option_id, chosen_id IS NOT NULL,
	(SELECT count(*) FROM invoices o WHERE o.id = invoices.id OR o.main_id = invoices.id), number, coalesce(title, ''), coalesce(note, ''),
	coalesce(to_char(due_date, 'YYYY-MM-DD'), ''), coalesce(client_name, ''), coalesce(client_email, ''),
	coalesce(client_address, ''), coalesce(sender_name, ''), issuer_name, coalesce(issuer_address, ''), coalesce(issuer_country, ''),
	coalesce(issuer_tax_id, ''), coalesce(issuer_email, ''), coalesce(return_url, ''),
	chain_id, token_contract, amount::text, recipient_address, factory_address, receive_address,
	expires_at, settle_deadline, payment_status, settlement_status, refund_status,
	coalesce((SELECT tx_hash FROM settlement_intents s WHERE s.invoice_id = invoices.option_id AND s.status = 'confirmed'), ''),
	created_at, coalesce(client_country, ''), coalesce(client_tax_id, ''),
	EXISTS (SELECT 1 FROM chain_transfers t WHERE t.invoice_id = invoices.option_id AND t.status = 'detected'
	        AND t.block_time <= invoices.closes_at), ` + ClosedSQL + `, canceled_at,
	coalesce(to_char(supply_date, 'YYYY-MM-DD'), ''), coalesce(reference, ''), agreed_currency, agreed_amount,
	agreed_decimals, to_char(agreed_date, 'YYYY-MM-DD'), coalesce(pay_token, ''), closes_at, receiver_deployed_at,
	coalesce(store_id::text, ''), coalesce((SELECT name FROM stores s WHERE s.id = invoices.store_id), ''),
	coalesce((SELECT brand_color FROM stores s WHERE s.id = invoices.store_id), ''),
	(SELECT logo_at FROM stores s WHERE s.id = invoices.store_id),
	(SELECT livemode FROM chains c WHERE c.chain_id = invoices.chain_id),
	coalesce((SELECT metadata FROM invoices m WHERE m.id = invoices.id), '{}')`

// The invoices_current view (migration 00020) aliased as invoices, so filters written for the table work on it.
const invoicesCurrent = "invoices_current invoices"

func scanInvoice(row pgx.Row) (Invoice, error) {
	var inv Invoice
	var amount string
	var expiresAt, settleDeadline, closesAt int64
	var issuerName *string
	var canceledAt *time.Time
	var issuer profile.Issuer
	var agreedCurrency, agreedDate *string
	var agreedAmount *int64
	var agreedDecimals *int
	dest := []any{&inv.ID, &inv.OptionID, &inv.OptionLocked, &inv.OptionCount, &inv.Number, &inv.Title, &inv.Note, &inv.DueDate, &inv.ClientName,
		&inv.ClientEmail, &inv.ClientAddress, &inv.SenderName, &issuerName, &issuer.Address, &issuer.Country, &issuer.TaxID,
		&issuer.Email, &inv.ReturnURL, &inv.ChainID, &inv.Token, &amount, &inv.Recipient, &inv.Factory,
		&inv.ReceiveAddress, &expiresAt, &settleDeadline, &inv.PaymentStatus, &inv.SettlementStatus, &inv.RefundStatus,
		&inv.SettlementTxHash, &inv.CreatedAt, &inv.ClientCountry, &inv.ClientTaxID, &inv.Confirming, &inv.Closed, &canceledAt,
		&inv.SupplyDate, &inv.Reference, &agreedCurrency, &agreedAmount, &agreedDecimals, &agreedDate, &inv.PayToken,
		&closesAt, &inv.receiverDeployedAt, &inv.StoreID, &inv.StoreName, &inv.BrandColor, &inv.LogoAt,
		&inv.Livemode, &inv.Metadata}
	if err := row.Scan(dest...); errors.Is(err, pgx.ErrNoRows) {
		return Invoice{}, ErrNotFound
	} else if err != nil {
		return Invoice{}, fmt.Errorf("read invoice: %w", err)
	}
	if issuerName != nil {
		issuer.Name = *issuerName
		inv.Issuer = &issuer
	}
	// The table holds all four or none.
	if agreedCurrency != nil {
		inv.Agreed = &AgreedValue{Currency: *agreedCurrency, Amount: *agreedAmount, Decimals: *agreedDecimals,
			Date: *agreedDate}
	}
	if canceledAt != nil {
		inv.CanceledAt = *canceledAt
	}
	inv.Amount, _ = new(big.Int).SetString(amount, 10)
	inv.ExpiresAt, inv.SettleDeadline = time.Unix(expiresAt, 0).UTC(), time.Unix(settleDeadline, 0).UTC()
	inv.ClosesAt = time.Unix(closesAt, 0).UTC()
	return inv, nil
}

func hexID(id [32]byte) string {
	return fmt.Sprintf("0x%x", id[:])
}
