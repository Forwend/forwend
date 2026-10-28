package invoice

import (
	"context"
	"math/big"

	"github.com/forwend/forwend/apps/backend/internal/chain"
)

// Received includes observed transfers; Pending has not been booked and is never proof of payment. Held is the booked
// money still owed to the payer.
type PaymentReceipt struct {
	OptionID string
	chain.Asset
	Received, Pending, Held *big.Int
}

func readPaymentReceipts(ctx context.Context, db paymentReader, ids []string) (map[string][]PaymentReceipt, error) {
	rows, err := db.Query(ctx, `SELECT coalesce(i.main_id,i.id),i.id,i.chain_id,i.token_contract,t.symbol,t.decimals,
 sum(d.amount)::text,coalesce(sum(d.amount) FILTER (WHERE NOT d.booked),0)::text,
 (SELECT -coalesce(sum(e.amount),0) FROM ledger_transactions l JOIN ledger_entries e ON e.transaction_id=l.id
   WHERE l.invoice_id=i.id AND e.account='payer_held')::text
 FROM invoices i JOIN chain_transfers d ON d.invoice_id=i.id AND d.status<>'reorged'
 JOIN tokens t ON t.chain_id=i.chain_id AND t.contract=i.token_contract
 WHERE i.id=ANY($1::text[]) OR i.main_id=ANY($1::text[])
 GROUP BY coalesce(i.main_id,i.id),i.id,t.symbol,t.decimals ORDER BY min(d.block_time),i.id`, ids)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := map[string][]PaymentReceipt{}
	for rows.Next() {
		var id, received, pending, held string
		var receipt PaymentReceipt
		if err := rows.Scan(&id, &receipt.OptionID, &receipt.ChainID, &receipt.Token, &receipt.Symbol, &receipt.Decimals, &received, &pending, &held); err != nil {
			return nil, err
		}
		receipt.Received, _ = new(big.Int).SetString(received, 10)
		receipt.Pending, _ = new(big.Int).SetString(pending, 10)
		receipt.Held, _ = new(big.Int).SetString(held, 10)
		result[id] = append(result[id], receipt)
	}
	return result, rows.Err()
}
