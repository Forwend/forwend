package ledger

import (
	"fmt"
	"testing"

	"github.com/forwend/forwend/apps/backend/internal/chaintest"
	"github.com/forwend/forwend/apps/backend/internal/ledger/ledgertest"
)

func TestDepositBacklogCommitsBoundedExactProgress(t *testing.T) {
	e := newChainEnv(t)
	ctx := t.Context()
	const count = 307
	for n, first := range []int{1000000, 1} {
		t.Run(fmt.Sprint(first), func(t *testing.T) {
			target := 150
			if first > 1 {
				target = first
			}
			id, receive := e.invoice(t, n+1, int64(target), 1800000000)
			_, err := e.pool.Exec(ctx, `INSERT INTO chain_transfers
 (invoice_id,chain_id,chain_family,token_contract,tx_hash,log_index,block_hash,block_number,block_time,from_address,to_address,amount,status)
 SELECT $1,$2,'evm',$3,'0x'||md5($1||i)||md5($1||i),$7::int,'0x'||lpad(to_hex(i),64,'0'),i,i,
 '0x4444444444444444444444444444444444444444',$4,CASE WHEN i=1 THEN $5 ELSE 1 END,'confirmed'
 FROM generate_series(1,$6::int) i`, id, chaintest.ChainID, e.token, receive, first, count, n)
			if err != nil {
				t.Fatal(err)
			}
			if _, err := e.pool.Exec(ctx, `UPDATE chain_cursors SET last_scanned_block=10000,last_finalized_block=10000,
 last_finalized_time=1800000001 WHERE chain_id=$1`, chaintest.ChainID); err != nil {
				t.Fatal(err)
			}
			ledgertest.Checkpoint(t, e.pool, id, 10000, 1800000001, fmt.Sprint(count+first-1))
			service := NewService(e.pool, nil, nil)
			for attempt := 1; attempt <= 5; attempt++ {
				if err := service.Process(ctx, id); err != nil {
					t.Fatal(err)
				}
				var booked int
				var status string
				if err := e.pool.QueryRow(ctx, `SELECT (SELECT count(*) FROM chain_transfers WHERE invoice_id=$1 AND booked),
 payment_status FROM invoices WHERE id=$1`, id).Scan(&booked, &status); err != nil {
					t.Fatal(err)
				}
				if expected := min(attempt*100, count); booked != expected {
					t.Fatalf("attempt %d booked %d, want %d", attempt, booked, expected)
				}
				if attempt == 1 && first == 1 && status != PartiallyPaid {
					t.Fatalf("unfinished on-time backlog closed early: %s", status)
				}
			}
			var payable, held string
			var paid, intents int
			if err := e.pool.QueryRow(ctx, `SELECT
 (SELECT coalesce(-sum(e.amount),0)::text FROM ledger_entries e JOIN ledger_transactions x ON x.id=e.transaction_id WHERE x.invoice_id=$1 AND e.account='recipient_payable'),
 (SELECT coalesce(-sum(e.amount),0)::text FROM ledger_entries e JOIN ledger_transactions x ON x.id=e.transaction_id WHERE x.invoice_id=$1 AND e.account='payer_held'),
 (SELECT count(*) FROM history_events WHERE invoice_id=$1 AND kind='invoice.paid'),
 (SELECT count(*) FROM settlement_intents WHERE invoice_id=$1)`, id).Scan(&payable, &held, &paid, &intents); err != nil {
				t.Fatal(err)
			}
			if payable != fmt.Sprint(target) || held != fmt.Sprint(count+first-1-target) || paid != 1 || intents != 1 {
				t.Fatalf("payable=%s held=%s paid=%d intents=%d", payable, held, paid, intents)
			}
		})
	}
}

func TestFundedBatchWaitsForRefundTailBeforeSettlement(t *testing.T) {
	e := newChainEnv(t)
	ctx := t.Context()
	id, receive := e.invoice(t, 1, 100, 1800000000)
	_, err := e.pool.Exec(ctx, `INSERT INTO chain_transfers
 (invoice_id,chain_id,chain_family,token_contract,tx_hash,log_index,block_hash,block_number,block_time,from_address,to_address,amount,status)
 SELECT $1,$2,'evm',$3,'0x'||lpad(to_hex(i),64,'0'),0,'0x'||lpad(to_hex(i+(i>100)::int),64,'0'),
 i+(i>100)::int,i+(i>100)::int,'0x4444444444444444444444444444444444444444',$4,1,'confirmed'
 FROM generate_series(1,101) i`, id, chaintest.ChainID, e.token, receive)
	if err != nil {
		t.Fatal(err)
	}
	_, err = e.pool.Exec(ctx, `INSERT INTO receiver_outflows
 (invoice_id,chain_id,receiver_address,token_contract,kind,destination,amount,tx_hash,log_index,block_hash,block_number,block_time,verified_block,transfer_log_index)
 VALUES($1,$2,$3,$4,'refund','0x4444444444444444444444444444444444444444',100,
 '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',1,
 '0x0000000000000000000000000000000000000000000000000000000000000065',101,101,10000,0)`, id, chaintest.ChainID, receive, e.token)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := e.pool.Exec(ctx, `UPDATE chain_cursors SET last_scanned_block=10000,last_finalized_block=10000,
 last_finalized_time=1800000001 WHERE chain_id=$1`, chaintest.ChainID); err != nil {
		t.Fatal(err)
	}
	ledgertest.Checkpoint(t, e.pool, id, 10000, 1800000001, "1")
	service := NewService(e.pool, nil, nil)
	if err := service.Process(ctx, id); err != nil {
		t.Fatal(err)
	}
	var state string
	var ready bool
	if err := e.pool.QueryRow(ctx, `SELECT payment_status,NOT (`+UnreconciledSQL("$1")+`) FROM invoices WHERE id=$1`, id).Scan(&state, &ready); err != nil {
		t.Fatal(err)
	}
	if state != Paid || ready {
		t.Fatalf("funded prefix state=%s settlement ready=%v", state, ready)
	}
	for range 2 {
		if err := service.Process(ctx, id); err != nil {
			t.Fatal(err)
		}
	}
	var receiver, payable, held string
	var refunds, paid int
	if err := e.pool.QueryRow(ctx, `SELECT
 (SELECT sum(e.amount)::text FROM ledger_entries e JOIN ledger_transactions t ON t.id=e.transaction_id WHERE t.invoice_id=$1 AND e.account='receiver'),
 (SELECT (-sum(e.amount))::text FROM ledger_entries e JOIN ledger_transactions t ON t.id=e.transaction_id WHERE t.invoice_id=$1 AND e.account='recipient_payable'),
 (SELECT (-sum(e.amount))::text FROM ledger_entries e JOIN ledger_transactions t ON t.id=e.transaction_id WHERE t.invoice_id=$1 AND e.account='payer_held'),
 (SELECT count(*) FROM ledger_transactions WHERE invoice_id=$1 AND kind='refund'),
 (SELECT count(*) FROM history_events WHERE invoice_id=$1 AND kind='invoice.paid')`, id).Scan(&receiver, &payable, &held, &refunds, &paid); err != nil {
		t.Fatal(err)
	}
	if receiver != "1" || payable != "0" || held != "1" || refunds != 1 || paid != 1 {
		t.Fatalf("receiver=%s payable=%s held=%s refunds=%d paid=%d", receiver, payable, held, refunds, paid)
	}
}
