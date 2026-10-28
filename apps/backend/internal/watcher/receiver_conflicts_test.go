package watcher

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"

	"github.com/ethereum/go-ethereum/rpc"
	"github.com/forwend/forwend/apps/backend/internal/chaintest"
	"github.com/forwend/forwend/apps/backend/internal/ledger"
)

func TestMissingLogRetriesWithoutPermanentConflict(t *testing.T) {
	e := setup(t)
	ctx := t.Context()
	id := "0x" + strings.Repeat("01", 32)
	e.anvil.Transfer(e.token, receive, "5000000")
	e.anvil.Mine(2)
	e.scan(t)
	proxy := e.anvil.Proxy()
	proxy.Stale(func(call chaintest.Call) json.RawMessage {
		if call.Method == "eth_getLogs" {
			return json.RawMessage("[]")
		}
		return nil
	})
	client, err := rpc.Dial(proxy.URL)
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()
	if _, err := NewChain(e.pool, e.chain.chainID, client).Receiver(ctx, id); err == nil {
		t.Fatal("incomplete log response advanced coverage")
	}
	var conflicts int
	if err := e.pool.QueryRow(ctx, "SELECT count(*) FROM receiver_conflicts").Scan(&conflicts); err != nil || conflicts != 0 {
		t.Fatalf("conflicts=%d: %v", conflicts, err)
	}
	proxy.Stale(nil)
	for range 2 {
		if _, err := e.chain.Receiver(ctx, id); err != nil {
			t.Fatal(err)
		}
	}
	if err := ledger.NewService(e.pool, nil, nil).Process(ctx, id); err != nil {
		t.Fatal(err)
	}
	var status string
	if err := e.pool.QueryRow(ctx, "SELECT payment_status FROM invoices WHERE id=$1", id).Scan(&status); err != nil || status != ledger.Paid {
		t.Fatalf("payment=%s: %v", status, err)
	}
}

func TestLegacyMissingConflictRecoversAfterExactProof(t *testing.T) {
	for _, withProof := range []bool{false, true} {
		t.Run(fmt.Sprint(withProof), func(t *testing.T) {
			e := setup(t)
			ctx := t.Context()
			id := "0x" + strings.Repeat("01", 32)
			e.anvil.Transfer(e.token, receive, "5000000")
			e.anvil.Mine(5)
			e.scan(t)
			if withProof {
				if _, err := e.chain.Receiver(ctx, id); err != nil {
					t.Fatal(err)
				}
				e.chain.span = 1
			}
			head, _, err := e.chain.headers(ctx, nil)
			if err != nil {
				t.Fatal(err)
			}
			_, err = e.pool.Exec(ctx, `INSERT INTO receiver_conflicts
 (invoice_id,chain_id,block_hash,log_index,existing_transfer_id,observed)
 SELECT invoice_id,chain_id,block_hash,log_index,id,jsonb_build_object('missingTransfer',true)
 FROM chain_transfers WHERE invoice_id=$1`, id)
			if err != nil {
				t.Fatal(err)
			}
			_, err = e.pool.Exec(ctx, `UPDATE receiver_scans SET opening_checked=true,history_complete=true,
 start_block=0,next_block=$2::bigint+1,scanned_block=$2,scanned_hash=$3,block_time=$4,balance=5000000,
 reconciliation_error='deposit_identity_conflict' WHERE invoice_id=$1`, id, uint64(head.Number), strings.ToLower(head.Hash.Hex()), uint64(head.Timestamp))
			if err != nil {
				t.Fatal(err)
			}
			for range 8 {
				if _, err := e.chain.Receiver(ctx, id); err != nil {
					t.Fatal(err)
				}
			}
			var original, resolved, unresolved int
			if err := e.pool.QueryRow(ctx, `SELECT (SELECT count(*) FROM receiver_conflicts),
 (SELECT count(*) FROM receiver_conflict_resolutions),(SELECT count(*) FROM receiver_unresolved_conflicts)`).Scan(&original, &resolved, &unresolved); err != nil {
				t.Fatal(err)
			}
			if original != 1 || resolved != 1 || unresolved != 0 {
				t.Fatalf("original=%d resolved=%d unresolved=%d", original, resolved, unresolved)
			}
			if err := ledger.NewService(e.pool, nil, nil).Process(ctx, id); err != nil {
				t.Fatal(err)
			}
			var status string
			if err := e.pool.QueryRow(ctx, "SELECT payment_status FROM invoices WHERE id=$1", id).Scan(&status); err != nil || status != ledger.Paid {
				t.Fatalf("payment=%s: %v", status, err)
			}
			for _, sql := range []string{"UPDATE receiver_conflict_resolutions SET verified_block=verified_block+1", "DELETE FROM receiver_conflict_resolutions", "TRUNCATE receiver_conflict_resolutions"} {
				if _, err := e.pool.Exec(ctx, sql); err == nil {
					t.Fatalf("resolution evidence changed: %s", sql)
				}
			}
			if _, err := e.pool.Exec(ctx, `INSERT INTO receiver_conflicts
 (invoice_id,chain_id,block_hash,log_index,existing_transfer_id,observed)
 SELECT invoice_id,chain_id,block_hash,log_index,id,'{"amount":"1"}'::jsonb FROM chain_transfers WHERE invoice_id=$1`, id); err != nil {
				t.Fatal(err)
			}
			if err := e.pool.QueryRow(ctx, "SELECT count(*) FROM receiver_unresolved_conflicts").Scan(&unresolved); err != nil || unresolved != 1 {
				t.Fatalf("new contradiction hidden: %d %v", unresolved, err)
			}
			var later int64
			if err := e.pool.QueryRow(ctx, `INSERT INTO chain_transfers
 (invoice_id,chain_id,chain_family,token_contract,tx_hash,log_index,block_hash,block_number,block_time,from_address,to_address,amount,status)
 SELECT invoice_id,chain_id,chain_family,token_contract,'0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
 log_index+1,block_hash,block_number,block_time,from_address,to_address,1,'confirmed'
 FROM chain_transfers WHERE invoice_id=$1 RETURNING id`, id).Scan(&later); err != nil {
				t.Fatal(err)
			}
			if _, err := e.pool.Exec(ctx, `INSERT INTO receiver_deposit_proofs(chain_transfer_id,invoice_id,verified_block,verified_hash)
 SELECT $2,invoice_id,verified_block,verified_hash FROM receiver_deposit_proofs WHERE invoice_id=$1`, id, later); err != nil {
				t.Fatal(err)
			}
			if _, err := e.pool.Exec(ctx, `INSERT INTO receiver_conflict_resolutions
 (chain_id,block_hash,log_index,chain_transfer_id,verified_block,verified_hash)
 SELECT chain_id,block_hash,log_index,$1,verified_block,verified_hash FROM receiver_conflict_resolutions`, later); err == nil || !strings.Contains(err.Error(), "exact deposit proof") {
				t.Fatalf("wrong transfer resolved conflict: %v", err)
			}
			if err := ledger.NewService(e.pool, nil, nil).Process(ctx, id); err != nil {
				t.Fatal(err)
			}
			var booked bool
			if err := e.pool.QueryRow(ctx, "SELECT booked FROM chain_transfers WHERE id=$1", later).Scan(&booked); err != nil || booked {
				t.Fatalf("contradiction allowed booking: %v %v", booked, err)
			}
		})
	}
}
