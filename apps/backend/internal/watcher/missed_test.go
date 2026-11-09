package watcher

import (
	"context"
	"errors"
	"testing"

	"github.com/ethereum/go-ethereum/common"
	"github.com/forwend/forwend/apps/backend/internal/chaintest"
)

// A deposit the scan missed is recorded from its receipt once final, as the scan would have recorded it, and only once.
func TestMissedDepositIsRecordedFromItsReceiptOnce(t *testing.T) {
	e := setup(t)
	ctx := context.Background()
	id := "0x" + "0101010101010101010101010101010101010101010101010101010101010101"
	tx := common.HexToHash(e.anvil.Transfer(e.token, receive, "1000000"))
	if _, err := e.chain.RecordDeposits(ctx, tx, []string{id}); !errors.Is(err, ErrNotFinal) {
		t.Fatalf("before its block is final: %v, want ErrNotFinal", err)
	}
	e.anvil.Mine(2)
	if _, err := e.chain.RecordDeposits(ctx, tx, []string{"0x" + "02"}); !errors.Is(err, ErrNoDeposit) {
		t.Fatalf("for an invoice it doesn't pay: %v, want ErrNoDeposit", err)
	}
	for run, want := range []int64{1, 0} {
		if n, err := e.chain.RecordDeposits(ctx, tx, []string{id}); err != nil || n != want {
			t.Fatalf("run %d recorded %d (%v), want %d", run+1, n, err, want)
		}
	}
	var amount, from, status string
	if err := e.pool.QueryRow(ctx, "SELECT amount::text, from_address, status FROM chain_transfers WHERE invoice_id = $1",
		id).Scan(&amount, &from, &status); err != nil || amount != "1000000" || from != chaintest.Sender ||
		status != "confirmed" {
		t.Fatalf("row: %s from %s, %s (%v)", amount, from, status, err)
	}
}
