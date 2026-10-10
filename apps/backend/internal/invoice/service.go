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

const invoiceColumns = `id, chain_id, token_contract, amount::text, recipient_address, factory_address, receive_address,
	expires_at, settle_deadline, payment_status, settlement_status, refund_status, created_at`

func scanInvoice(row pgx.Row, before ...any) (Invoice, error) {
	var inv Invoice
	var amount string
	var expiresAt, settleDeadline int64
	dest := append(before, &inv.ID, &inv.ChainID, &inv.Token, &amount, &inv.Recipient, &inv.Factory,
		&inv.ReceiveAddress, &expiresAt, &settleDeadline, &inv.PaymentStatus, &inv.SettlementStatus, &inv.RefundStatus,
		&inv.CreatedAt)
	if err := row.Scan(dest...); errors.Is(err, pgx.ErrNoRows) {
		return Invoice{}, ErrNotFound
	} else if err != nil {
		return Invoice{}, fmt.Errorf("read invoice: %w", err)
	}
	inv.Amount, _ = new(big.Int).SetString(amount, 10)
	inv.ExpiresAt, inv.SettleDeadline = time.Unix(expiresAt, 0).UTC(), time.Unix(settleDeadline, 0).UTC()
	return inv, nil
}

func hexID(id [32]byte) string {
	return fmt.Sprintf("0x%x", id[:])
}
