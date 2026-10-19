package job

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/ensp1re/forwend/apps/backend/internal/invoice"
	"github.com/ensp1re/forwend/apps/backend/internal/profile"
)

func threeSteps() Request {
	return Request{Title: "Logo design", Client: profile.ClientDetails{Name: "Bob Ltd", Email: "ap@bob.example"},
		Payments: []PaymentRequest{{Title: "Deposit", AmountUSD: "300", DueDays: 7, OnAccept: true},
			{Title: "Design approved", AmountUSD: "400", DueDays: 14}, {Title: "Final delivery", AmountUSD: "300.50", DueDays: 30}}}
}

// R-103: steps are marked done in order, after acceptance; each makes its invoice once, due its days later, with the
// delivery link and time kept; the final invoice's note lists the earlier payments.
func TestMarkDone(t *testing.T) {
	ctx := context.Background()
	pool, profileID := open(t)
	invoices := invoice.NewService(pool)
	s := NewService(pool, invoices)
	j, _, err := s.Create(ctx, profileID, "k1", threeSteps())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.MarkDone(ctx, profileID, j.ID, 2, ""); !errors.Is(err, ErrNotAccepted) {
		t.Fatalf("before acceptance: %v, want ErrNotAccepted", err)
	}
	if _, err := s.Accept(ctx, j.Token, "Jane Doe", "jane@bob.example", noLimit); err != nil {
		t.Fatal(err)
	}
	if _, err := s.MarkDone(ctx, profileID, j.ID, 3, ""); !errors.Is(err, ErrOutOfOrder) {
		t.Fatalf("the final before the milestone: %v, want ErrOutOfOrder", err)
	}
	for _, bad := range []struct {
		position int
		link     string
		want     error
	}{{0, "", ErrNotFound}, {4, "", ErrNotFound}, {2, "http://drive.example/logo", ErrInvalid}, {2, "https://", ErrInvalid},
		// The database takes only a lower-case scheme, so the check does too.
		{2, "HTTPS://drive.example/logo", ErrInvalid}} {
		if _, err := s.MarkDone(ctx, profileID, j.ID, bad.position, bad.link); !errors.Is(err, bad.want) {
			t.Fatalf("payment %d link %q: %v, want %v", bad.position, bad.link, err, bad.want)
		}
	}

	// Two clicks at once make one invoice.
	hold, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := hold.Exec(ctx, "SELECT 1 FROM profiles WHERE id = $1 FOR UPDATE", profileID); err != nil {
		t.Fatal(err)
	}
	var wg sync.WaitGroup
	got := make([]Job, 2)
	errs := make([]error, 2)
	for i := range 2 {
		wg.Go(func() { got[i], errs[i] = s.MarkDone(ctx, profileID, j.ID, 2, "https://drive.example/logo") })
	}
	for waiting := 0; waiting < 2; {
		if err := pool.QueryRow(ctx, `SELECT count(*) FROM pg_stat_activity WHERE wait_event_type = 'Lock'
			AND datname = current_database()`).Scan(&waiting); err != nil {
			t.Fatal(err)
		}
	}
	if err := hold.Rollback(ctx); err != nil {
		t.Fatal(err)
	}
	wg.Wait()
	milestone := got[0].Payments[1]
	if errs[0] != nil || errs[1] != nil || milestone.InvoiceID == "" || got[1].Payments[1].InvoiceID != milestone.InvoiceID ||
		milestone.DeliveryLink != "https://drive.example/logo" || milestone.DoneAt.IsZero() {
		t.Fatalf("milestone: %+v %v", got, errs)
	}
	inv, err := invoices.GetOfProfile(ctx, profileID, milestone.InvoiceID)
	if err != nil {
		t.Fatal(err)
	}
	if due := time.Now().UTC().AddDate(0, 0, 14).Format(time.DateOnly); inv.DueDate != due || inv.Note != "" ||
		inv.Amount.String() != "400000000" || inv.Lines[0].Description != "Design approved" {
		t.Fatalf("milestone invoice %+v %+v", inv.Details, inv.Lines)
	}
	if again, err := s.MarkDone(ctx, profileID, j.ID, 2, "https://other.example"); err != nil ||
		again.Payments[1].InvoiceID != milestone.InvoiceID || again.Payments[1].DeliveryLink != "https://drive.example/logo" {
		t.Fatalf("marked again: %+v %v", again.Payments[1], err)
	}

	if _, err := pool.Exec(ctx, "UPDATE invoices SET payment_status = 'paid' WHERE id = $1",
		got[0].Payments[0].InvoiceID); err != nil {
		t.Fatal(err)
	}
	final, err := s.MarkDone(ctx, profileID, j.ID, 3, "")
	if err != nil {
		t.Fatal(err)
	}
	inv, err = invoices.GetOfProfile(ctx, profileID, final.Payments[2].InvoiceID)
	if err != nil {
		t.Fatal(err)
	}
	want := "Final invoice for Logo design. Job total: 1000.50 USD.\nEarlier payments:" +
		"\n- Deposit (INV-0001): 300.00 USD, paid\n- Design approved (INV-0002): 400.00 USD, not paid yet" +
		"\nThis invoice: Final delivery, 300.50 USD."
	if inv.Note != want || final.Payments[2].DeliveryLink != "" {
		t.Fatalf("final note:\n%s\nwant:\n%s", inv.Note, want)
	}
}
