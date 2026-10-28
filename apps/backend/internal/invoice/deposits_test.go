package invoice

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

func TestInvoiceReadsBoundDepositHistory(t *testing.T) {
	pool, profile := open(t)
	ctx := context.Background()
	s := NewService(pool)
	inv, _, err := s.Create(ctx, profile, "deposit-preview", Request{ChainID: 84532, Token: usdc, Amount: "5000000"})
	if err != nil {
		t.Fatal(err)
	}
	_, err = pool.Exec(ctx, `INSERT INTO chain_transfers (invoice_id,chain_id,chain_family,token_contract,tx_hash,log_index,block_hash,block_number,block_time,from_address,to_address,amount,status)
 SELECT $1,84532,'evm',$2,'0x'||lpad(to_hex(i),64,'0'),0,'0x'||lpad(to_hex(i),64,'0'),i,
 extract(epoch from now())::bigint,'0x4444444444444444444444444444444444444444',$3,1,'detected'
 FROM generate_series(1,250) i`, inv.ID, usdc, inv.ReceiveAddress)
	if err != nil {
		t.Fatal(err)
	}
	cfg := pool.Config()
	cfg.MaxConns = 1
	single, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(single.Close)
	s = NewService(single)
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	for name, read := range map[string]func() (Invoice, error){
		"public":  func() (Invoice, error) { return s.Get(ctx, inv.PayToken) },
		"owner":   func() (Invoice, error) { return s.GetOfProfile(ctx, profile, inv.ID) },
		"summary": func() (Invoice, error) { return s.GetProfileSummary(ctx, profile, inv.ID) },
	} {
		t.Run(name, func(t *testing.T) {
			got, err := read()
			if err != nil {
				t.Fatal(err)
			}
			if len(got.Deposits) > 100 || len(got.Options[0].Deposits) > 100 {
				t.Fatalf("invoice returned %d deposits; option returned %d; maximum is 100", len(got.Deposits), len(got.Options[0].Deposits))
			}
			for _, summary := range []*DepositSummary{got.DepositSummary, got.Options[0].DepositSummary} {
				if summary == nil || summary.Count != 250 || summary.OnTimeAmount.String() != "250" || summary.LateAmount.Sign() != 0 || summary.PendingAmount.String() != "250" {
					t.Fatalf("incorrect full-history summary: %+v", summary)
				}
			}
		})
	}
}

func TestDepositPreviewPreservesPaymentEvidenceAndExactTotals(t *testing.T) {
	pool, profile := open(t)
	ctx := context.Background()
	s := NewService(pool)
	inv, _, err := s.Create(ctx, profile, "deposit-evidence", Request{ChainID: 84532, Token: usdc, Amount: "5000000"})
	if err != nil {
		t.Fatal(err)
	}
	_, err = pool.Exec(ctx, `INSERT INTO chain_transfers (invoice_id,chain_id,chain_family,token_contract,tx_hash,log_index,block_hash,block_number,block_time,from_address,to_address,amount,status)
 SELECT $1,84532,'evm',$2,'0x'||lpad(to_hex(i),64,'0'),0,'0x'||lpad(to_hex(i),64,'0'),i,
 $4::bigint + CASE i WHEN 1 THEN -100 WHEN 2 THEN -50 WHEN 3 THEN 0 WHEN 4 THEN -1 WHEN 5 THEN 1 ELSE i+10 END,
 '0x4444444444444444444444444444444444444444',$3,CASE i WHEN 2 THEN 500 ELSE 1 END,
 CASE WHEN i IN (3,4) THEN 'detected' WHEN i=251 THEN 'reorged' ELSE 'confirmed' END
 FROM generate_series(1,251) i`, inv.ID, usdc, inv.ReceiveAddress, inv.ClosesAt.Unix())
	if err != nil {
		t.Fatal(err)
	}
	_, err = pool.Exec(ctx, `WITH journal AS (
 INSERT INTO ledger_transactions(invoice_id,kind,chain_transfer_id)
 SELECT invoice_id,'deposit',id FROM chain_transfers WHERE invoice_id=$1 AND (block_number IN (1,2) OR block_number BETWEEN 6 AND 250)
 RETURNING id,chain_transfer_id
 ) INSERT INTO ledger_entries(transaction_id,account,amount)
 SELECT j.id,'receiver',t.amount FROM journal j JOIN chain_transfers t ON t.id=j.chain_transfer_id
 UNION ALL SELECT j.id,CASE WHEN t.block_number=2 THEN 'recipient_payable' ELSE 'payer_held' END,-t.amount
 FROM journal j JOIN chain_transfers t ON t.id=j.chain_transfer_id`, inv.ID)
	if err != nil {
		t.Fatal(err)
	}
	got, err := s.Get(ctx, inv.PayToken)
	if err != nil {
		t.Fatal(err)
	}
	if len(got.Deposits) != DepositPreviewLimit {
		t.Fatalf("preview has %d deposits", len(got.Deposits))
	}
	summary := got.DepositSummary
	if summary == nil || summary.Count != 250 || summary.OnTimeAmount.String() != "503" || summary.LateAmount.String() != "246" || summary.PendingAmount.String() != "2" {
		t.Fatalf("incorrect summary: %+v", summary)
	}
	seen := map[uint64]Deposit{}
	var previous uint64
	for _, d := range got.Deposits {
		if d.BlockNumber <= previous {
			t.Fatal("preview is not ordered by block")
		}
		seen[d.BlockNumber] = d
		previous = d.BlockNumber
	}
	for _, block := range []uint64{1, 2, 3, 4, 5, 156, 250} {
		if _, ok := seen[block]; !ok {
			t.Errorf("preview omitted representative or recent block %d", block)
		}
	}
	paid, oldest := seen[2], seen[5]
	if paid.Paid == nil || paid.Paid.String() != "500" || oldest.Status != "confirmed" || oldest.Paid != nil || !oldest.Late {
		t.Fatalf("lost paid or delayed evidence: paid=%+v delayed=%+v", paid, oldest)
	}
	if _, ok := seen[251]; ok {
		t.Fatal("reorged deposit appeared in preview")
	}
}

func TestDepositPreviewKeepsAllRowsThroughItsLimit(t *testing.T) {
	pool, profile := open(t)
	ctx := context.Background()
	s := NewService(pool)
	for _, count := range []int{0, 97, 100} {
		t.Run(fmt.Sprint(count), func(t *testing.T) {
			inv, _, err := s.Create(ctx, profile, fmt.Sprintf("deposit-count-%d", count), Request{ChainID: 84532, Token: usdc, Amount: "5000000"})
			if err != nil {
				t.Fatal(err)
			}
			_, err = pool.Exec(ctx, `INSERT INTO chain_transfers (invoice_id,chain_id,chain_family,token_contract,tx_hash,log_index,block_hash,block_number,block_time,from_address,to_address,amount,status)
 SELECT $1,84532,'evm',$2,'0x'||md5($1||i)||md5($1||i),0,'0x'||md5($1||i)||md5($1||i),i,
 extract(epoch from now())::bigint,'0x4444444444444444444444444444444444444444',$3,1,'confirmed' FROM generate_series(1,$4::int) i`, inv.ID, usdc, inv.ReceiveAddress, count)
			if err != nil {
				t.Fatal(err)
			}
			got, err := s.Get(ctx, inv.PayToken)
			if err != nil {
				t.Fatal(err)
			}
			if len(got.Deposits) != count {
				t.Fatalf("returned %d of %d deposits", len(got.Deposits), count)
			}
			if count == 0 && (got.DepositSummary != nil || got.Options[0].DepositSummary != nil) {
				t.Fatal("empty history has a summary")
			}
		})
	}
}
