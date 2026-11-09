package invoice

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"time"

	"github.com/forwend/forwend/apps/backend/internal/intents"
	"github.com/jackc/pgx/v5"
)

// CrossChainPayment is an invoice's shown cross-chain quote (R-235): the newest one 1Click saw a deposit for, else
// the newest one. Deposited, Delivered and Refunded are nil until 1Click says.
type CrossChainPayment struct {
	QuoteID, Asset, Blockchain, Symbol, DepositAddress, RefundTo, Status, RefundReason string
	Decimals                                                                           int
	AmountIn, MinAmountIn, AmountOut, Deposited, Delivered, Refunded                   *big.Int
	ShownUntil, Deadline, CreatedAt                                                    time.Time
	DepositSeenAt, ConvertedAt                                                         *time.Time
	OriginTxs, DestinationTxs                                                          []intents.Tx
	Signed                                                                             []byte // 1Click's answer, for the pay page's check (D-124)
}

func readCrossChain(ctx context.Context, db paymentReader, mainID string) (*CrossChainPayment, error) {
	var c CrossChainPayment
	var in, minIn, out string
	var deposited, delivered, refunded, reason *string
	var origin, destination, signed []byte
	err := db.QueryRow(ctx, `SELECT id::text, origin_asset, origin_blockchain, origin_symbol, origin_decimals,
		    deposit_address, refund_to, status, amount_in::text, min_amount_in::text, amount_out::text,
		    deposited_amount::text, delivered_amount::text, refunded_amount::text, refund_reason, shown_until, deadline,
		    created_at, deposit_seen_at, converted_at, origin_txs, destination_txs, signed
		FROM crosschain_quotes WHERE invoice_id = $1
		ORDER BY deposit_seen_at IS NOT NULL DESC, created_at DESC LIMIT 1`, mainID).Scan(&c.QuoteID, &c.Asset,
		&c.Blockchain, &c.Symbol, &c.Decimals, &c.DepositAddress, &c.RefundTo, &c.Status, &in, &minIn, &out, &deposited,
		&delivered, &refunded, &reason, &c.ShownUntil, &c.Deadline, &c.CreatedAt, &c.DepositSeenAt, &c.ConvertedAt,
		&origin, &destination, &signed)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read invoice %s cross-chain quote: %w", mainID, err)
	}
	c.AmountIn, _ = new(big.Int).SetString(in, 10)
	c.MinAmountIn, _ = new(big.Int).SetString(minIn, 10)
	c.AmountOut, _ = new(big.Int).SetString(out, 10)
	c.Deposited, c.Delivered, c.Refunded = bigOrNil(deposited), bigOrNil(delivered), bigOrNil(refunded)
	if reason != nil {
		c.RefundReason = *reason
	}
	if err := json.Unmarshal(origin, &c.OriginTxs); err != nil {
		return nil, fmt.Errorf("read invoice %s cross-chain transactions: %w", mainID, err)
	}
	if err := json.Unmarshal(destination, &c.DestinationTxs); err != nil {
		return nil, fmt.Errorf("read invoice %s cross-chain transactions: %w", mainID, err)
	}
	c.Signed = signed
	c.ShownUntil, c.Deadline, c.CreatedAt = c.ShownUntil.UTC(), c.Deadline.UTC(), c.CreatedAt.UTC()
	return &c, nil
}

func bigOrNil(s *string) *big.Int {
	if s == nil {
		return nil
	}
	n, _ := new(big.Int).SetString(*s, 10)
	return n
}
