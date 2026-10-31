package settlement

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/ethclient"
	"github.com/forwend/forwend/apps/backend/internal/chaintest"
)

func TestUnminedReceiptDoesNotHammerTheProvider(t *testing.T) {
	a := chaintest.Start(t)
	p := a.Proxy()
	client, err := ethclient.Dial(p.URL)
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 1300*time.Millisecond)
	defer cancel()
	_, err = (&Signer{receiptPoll: ReceiptPoll}).await(ctx, client, common.HexToHash("0x1234"))
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("wait returned %v, want deadline", err)
	}
	if calls := len(p.Calls()); calls > 2 {
		t.Fatalf("unmined receipt made %d requests in 1.3 seconds, want at most 2", calls)
	}
}
