package invoice

import (
	"context"
	"reflect"
	"testing"
	"time"

	"github.com/ensp1re/forwend/apps/backend/internal/history/historytest"
)

// Making, the payer's email and canceling each leave one history row, by who did them; the same email again changes
// nothing and leaves none (R-123).
func TestInvoiceChangesKeepHistory(t *testing.T) {
	ctx := context.Background()
	pool, profile := open(t)
	s := NewService(pool)
	inv, _, err := s.Create(ctx, profile, "key-1", Request{ChainID: 84532, Token: usdc, Amount: "5000000"})
	if err != nil {
		t.Fatal(err)
	}
	allow := func() time.Duration { return 0 }
	for _, email := range []string{"payer@example.com", "payer@example.com", "other@example.com"} {
		if _, err := s.SetPayerEmail(ctx, inv.PayToken, email, allow); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := s.Cancel(ctx, profile, inv.ID); err != nil {
		t.Fatal(err)
	}
	want := []string{"invoice.created by owner", "payer.email_given by payer", "payer.email_given by payer",
		"invoice.canceled by owner"}
	if got := historytest.Events(t, pool, inv.ID); !reflect.DeepEqual(got, want) {
		t.Fatalf("history\n got %q\nwant %q", got, want)
	}
}
