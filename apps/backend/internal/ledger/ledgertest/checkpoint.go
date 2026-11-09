package ledgertest

import (
	"fmt"
	"testing"

	"github.com/forwend/forwend/apps/backend/internal/history"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Settlement supplies exact source and journal records to wallet-reader tests. The wallet's transfer is the amount less
// the option's fees, each booked as its own outflow of the same settle (R-230).
func Settlement(t *testing.T, pool *pgxpool.Pool, invoiceID, hash string, held bool) {
	t.Helper()
	ctx := t.Context()
	err := pgx.BeginFunc(ctx, pool, func(tx pgx.Tx) error {
		var amount, net, network, platform, recipient, wallet, token, receive, blockHash string
		var block, at, index uint64
		if err := tx.QueryRow(ctx, `SELECT i.amount::text,w.amount::text,i.network_fee::text,i.platform_fee::text,
    i.recipient_address,w.wallet_address,i.token_contract,i.receive_address,
    w.block_hash,w.block_number,w.block_time,w.log_index FROM invoices i JOIN wallet_transfers w
    ON w.chain_id = i.chain_id AND w.token_contract = i.token_contract AND w.counterparty = i.receive_address
    AND w.direction = 'in' AND w.tx_hash = $2 AND w.amount = i.amount - i.network_fee - i.platform_fee
    WHERE i.id = $1`, invoiceID, hash).
			Scan(&amount, &net, &network, &platform, &recipient, &wallet, &token, &receive, &blockHash, &block, &at,
				&index); err != nil {
			return err
		}
		if recipient != wallet {
			return fmt.Errorf("settlement destination differs from invoice recipient")
		}
		var transfer, deposit, settlement int64
		if err := tx.QueryRow(ctx, `INSERT INTO chain_transfers
    (invoice_id,chain_id,chain_family,token_contract,tx_hash,log_index,block_hash,block_number,block_time,from_address,to_address,amount,status)
    SELECT id,chain_id,chain_family,token_contract,id,0,$2,$3,$4,'0x9999999999999999999999999999999999999999',receive_address,amount,'confirmed'
    FROM invoices WHERE id = $1 RETURNING id`, invoiceID, fmt.Sprintf("0x%064x", block-1), block-1, at-1).Scan(&transfer); err != nil {
			return err
		}
		if err := tx.QueryRow(ctx, `INSERT INTO ledger_transactions (invoice_id,kind,chain_transfer_id) VALUES ($1,'deposit',$2) RETURNING id`, invoiceID, transfer).Scan(&deposit); err != nil {
			return err
		}
		liability := "recipient_payable"
		if held {
			liability = "payer_held"
		}
		if _, err := tx.Exec(ctx, `INSERT INTO ledger_entries (transaction_id,account,amount) VALUES ($1,'receiver',$2),($1,$3,-$2::numeric)`, deposit, amount, liability); err != nil {
			return err
		}
		if err := tx.QueryRow(ctx, `INSERT INTO ledger_transactions (invoice_id,kind) VALUES ($1,'settlement') RETURNING id`, invoiceID).Scan(&settlement); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `INSERT INTO ledger_entries (transaction_id,account,amount) VALUES ($1,'receiver',-$2::numeric),($1,$3,$2)`, settlement, net, liability); err != nil {
			return err
		}
		var policy *string
		if held {
			p := "settlement_consumed_held"
			policy = &p
		}
		if _, err := tx.Exec(ctx, `INSERT INTO receiver_outflows (invoice_id,chain_id,receiver_address,token_contract,kind,
    destination,amount,tx_hash,log_index,block_hash,block_number,block_time,verified_block,transfer_log_index,
    ledger_transaction_id,reconciliation_error,policy_exception)
    SELECT id,chain_id,receive_address,token_contract,'settlement',recipient_address,$10,$2,$3,$4,$5,$6,$5,$7,$8,'',$9
    FROM invoices WHERE id = $1`, invoiceID, hash, index+1, blockHash, block, at, index, settlement, policy, net); err != nil {
			return err
		}
		// FeesPaid follows Settled; its transfers are the settle's after the recipient's, far from the test's others.
		for i, fee := range []struct{ kind, amount string }{{"network_fee", network}, {"platform_fee", platform}} {
			if fee.amount == "0" {
				continue
			}
			var booking int64
			if err := tx.QueryRow(ctx, `INSERT INTO ledger_transactions (invoice_id,kind) VALUES ($1,$2) RETURNING id`,
				invoiceID, fee.kind).Scan(&booking); err != nil {
				return err
			}
			if _, err := tx.Exec(ctx, `INSERT INTO ledger_entries (transaction_id,account,amount) VALUES
    ($1,'receiver',-$2::numeric),($1,$3,$2)`, booking, fee.amount, liability); err != nil {
				return err
			}
			if _, err := tx.Exec(ctx, `INSERT INTO receiver_outflows (invoice_id,chain_id,receiver_address,token_contract,kind,
    destination,amount,tx_hash,log_index,block_hash,block_number,block_time,verified_block,transfer_log_index,
    ledger_transaction_id,reconciliation_error)
    SELECT id,chain_id,receive_address,token_contract,$2,'0x9999999999999999999999999999999999999999',$3,$4,$5,$6,$7,$8,$7,$9,$10,''
    FROM invoices WHERE id = $1`, invoiceID, fee.kind, fee.amount, hash, index+2, blockHash, block, at, index+1001+uint64(i),
				booking); err != nil {
				return err
			}
		}
		status := "paid"
		if held {
			status = "expired_partially_paid"
		}
		_, err := tx.Exec(ctx, `UPDATE invoices SET payment_status = $2,settlement_status = 'settled' WHERE id = $1`, invoiceID, status)
		if err != nil {
			return err
		}
		return history.Add(ctx, tx, invoiceID, history.ReceiverSettled, history.System, history.Data{TxHash: hash})
	})
	if err != nil {
		t.Fatal(err)
	}
}
