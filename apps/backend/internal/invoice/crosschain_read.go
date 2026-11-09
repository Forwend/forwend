package invoice

import (
	"context"
	"encoding/json"
	"fmt"
	"math/big"
	"time"

	"github.com/forwend/forwend/apps/backend/internal/intents"
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
	found, err := readCrossChainFor(ctx, db, []string{mainID}, false)
	return found[mainID], err
}

// readCrossChainFor reads each invoice's shown quote, by main invoice id; paying keeps only a deposit 1Click converts
// or converted, as a list needs: one it returned didn't pay the invoice.
func readCrossChainFor(ctx context.Context, db paymentReader, mainIDs []string, paying bool) (map[string]*CrossChainPayment, error) {
	rows, err := db.Query(ctx, `SELECT DISTINCT ON (invoice_id) invoice_id, id::text, origin_asset, origin_blockchain,
		    origin_symbol, origin_decimals, deposit_address, refund_to, status, amount_in::text, min_amount_in::text,
		    amount_out::text, deposited_amount::text, delivered_amount::text, refunded_amount::text, refund_reason,
		    shown_until, deadline, created_at, deposit_seen_at, converted_at, origin_txs, destination_txs, signed
		FROM crosschain_quotes WHERE invoice_id = ANY($1::text[]) AND (NOT $2 OR status IN ('KNOWN_DEPOSIT_TX', 'PROCESSING', 'SUCCESS'))
		ORDER BY invoice_id, deposit_seen_at IS NOT NULL DESC, created_at DESC`, mainIDs, paying)
	if err != nil {
		return nil, fmt.Errorf("read cross-chain quotes: %w", err)
	}
	defer rows.Close()
	found := map[string]*CrossChainPayment{}
	for rows.Next() {
		var c CrossChainPayment
		var main, in, minIn, out string
		var deposited, delivered, refunded, reason *string
		var origin, destination, signed []byte
		if err := rows.Scan(&main, &c.QuoteID, &c.Asset, &c.Blockchain, &c.Symbol, &c.Decimals, &c.DepositAddress,
			&c.RefundTo, &c.Status, &in, &minIn, &out, &deposited, &delivered, &refunded, &reason, &c.ShownUntil,
			&c.Deadline, &c.CreatedAt, &c.DepositSeenAt, &c.ConvertedAt, &origin, &destination, &signed); err != nil {
			return nil, fmt.Errorf("read cross-chain quotes: %w", err)
		}
		c.AmountIn, _ = new(big.Int).SetString(in, 10)
		c.MinAmountIn, _ = new(big.Int).SetString(minIn, 10)
		c.AmountOut, _ = new(big.Int).SetString(out, 10)
		c.Deposited, c.Delivered, c.Refunded = bigOrNil(deposited), bigOrNil(delivered), bigOrNil(refunded)
		if reason != nil {
			c.RefundReason = *reason
		}
		if err := json.Unmarshal(origin, &c.OriginTxs); err != nil {
			return nil, fmt.Errorf("read cross-chain transactions: %w", err)
		}
		if err := json.Unmarshal(destination, &c.DestinationTxs); err != nil {
			return nil, fmt.Errorf("read cross-chain transactions: %w", err)
		}
		c.Signed = signed
		c.ShownUntil, c.Deadline, c.CreatedAt = c.ShownUntil.UTC(), c.Deadline.UTC(), c.CreatedAt.UTC()
		found[main] = &c
	}
	return found, rows.Err()
}

func bigOrNil(s *string) *big.Int {
	if s == nil {
		return nil
	}
	n, _ := new(big.Int).SetString(*s, 10)
	return n
}
