package invoice

import (
	"errors"
	"fmt"
	"math/big"
	"time"

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

// invoiceColumns reads FROM invoices (not aliased).
const invoiceColumns = `id, number, coalesce(title, ''), coalesce(note, ''),
	coalesce(to_char(due_date, 'YYYY-MM-DD'), ''), coalesce(client_name, ''), coalesce(client_email, ''),
	coalesce(client_address, ''), coalesce(sender_name, ''), issuer_name, coalesce(issuer_address, ''), coalesce(issuer_country, ''),
	coalesce(issuer_tax_id, ''), coalesce(issuer_email, ''),
	chain_id, token_contract, amount::text, recipient_address, factory_address, receive_address,
	expires_at, settle_deadline, payment_status, settlement_status, refund_status,
	coalesce((SELECT tx_hash FROM settlement_intents s WHERE s.invoice_id = invoices.id AND s.status = 'confirmed'), ''),
	created_at`

func scanInvoice(row pgx.Row, before ...any) (Invoice, error) {
	var inv Invoice
	var amount string
	var expiresAt, settleDeadline int64
	var issuerName *string
	var issuer Issuer
	dest := append(before, &inv.ID, &inv.Number, &inv.Title, &inv.Note, &inv.DueDate, &inv.ClientName,
		&inv.ClientEmail, &inv.ClientAddress, &inv.SenderName, &issuerName, &issuer.Address, &issuer.Country, &issuer.TaxID,
		&issuer.Email, &inv.ChainID, &inv.Token, &amount, &inv.Recipient, &inv.Factory,
		&inv.ReceiveAddress, &expiresAt, &settleDeadline, &inv.PaymentStatus, &inv.SettlementStatus, &inv.RefundStatus,
		&inv.SettlementTxHash, &inv.CreatedAt)
	if err := row.Scan(dest...); errors.Is(err, pgx.ErrNoRows) {
		return Invoice{}, ErrNotFound
	} else if err != nil {
		return Invoice{}, fmt.Errorf("read invoice: %w", err)
	}
	if issuerName != nil {
		issuer.Name = *issuerName
		inv.Issuer = &issuer
	}
	inv.Amount, _ = new(big.Int).SetString(amount, 10)
	inv.ExpiresAt, inv.SettleDeadline = time.Unix(expiresAt, 0).UTC(), time.Unix(settleDeadline, 0).UTC()
	return inv, nil
}

func hexID(id [32]byte) string {
	return fmt.Sprintf("0x%x", id[:])
}
