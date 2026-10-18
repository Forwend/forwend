package job

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/ensp1re/forwend/apps/backend/internal/invoice"
)

// R-105: a change goes at the end of an accepted job's schedule once per key; the client accepts it like the quote,
// and only then can it be marked done; the owner can withdraw the last change until the client accepts it.
func TestScopeChange(t *testing.T) {
	ctx := context.Background()
	pool, profileID := open(t)
	invoices := invoice.NewService(pool)
	s := NewService(pool, invoices)
	j, _, err := s.Create(ctx, profileID, "k1", quote(true))
	if err != nil {
		t.Fatal(err)
	}
	extra := PaymentRequest{Title: "Extra page", AmountUSD: "150", DueDays: 7}
	if _, _, err := s.ProposeChange(ctx, profileID, j.ID, "c1", extra); !errors.Is(err, ErrNotAccepted) {
		t.Fatalf("before acceptance: %v, want ErrNotAccepted", err)
	}
	if _, err := s.Accept(ctx, j.Token, "Jane Doe", "jane@bob.example"); err != nil {
		t.Fatal(err)
	}
	proposed, created, err := s.ProposeChange(ctx, profileID, j.ID, "c1", extra)
	change := proposed.Payments[2]
	if err != nil || !created || len(proposed.Payments) != 3 || change.Title != "Extra page" || change.AmountCents != 15000 ||
		change.ProposedAt.IsZero() || !change.AcceptedAt.IsZero() || change.OnAccept {
		t.Fatalf("propose: %+v %v %v", proposed.Payments, created, err)
	}
	if proposed.TotalCents() != 100050 {
		t.Fatalf("total with a change not accepted: %d, want the quote's 100050", proposed.TotalCents())
	}
	if again, created, err := s.ProposeChange(ctx, profileID, j.ID, "c1", PaymentRequest{Title: "Extra page",
		AmountUSD: "150.00", DueDays: 7}); err != nil || created || len(again.Payments) != 3 {
		t.Fatalf("same request: %d payments, created %v, %v", len(again.Payments), created, err)
	}
	if _, _, err := s.ProposeChange(ctx, profileID, j.ID, "c1", PaymentRequest{Title: "Other", AmountUSD: "1",
		DueDays: 7}); !errors.Is(err, ErrConflict) {
		t.Fatalf("same key, other change: %v, want ErrConflict", err)
	}
	if _, _, err := s.ProposeChange(ctx, profileID, j.ID, "c2", PaymentRequest{Title: "Extra", AmountUSD: "1",
		DueDays: 7, OnAccept: true}); !errors.Is(err, ErrInvalid) {
		t.Fatalf("a change as deposit: %v, want ErrInvalid", err)
	}

	if _, err := s.MarkDone(ctx, profileID, j.ID, 2, ""); err != nil {
		t.Fatal(err)
	}
	if _, err := s.MarkDone(ctx, profileID, j.ID, 3, ""); !errors.Is(err, ErrChangeNotAccepted) {
		t.Fatalf("change not accepted: %v, want ErrChangeNotAccepted", err)
	}
	for _, bad := range []int{1, 2, 4} {
		if _, err := s.AcceptChange(ctx, j.Token, bad, change.ProposedAt, "Jane Doe", "jane@bob.example"); !errors.Is(err, ErrNotFound) {
			t.Fatalf("accept payment %d: %v, want ErrNotFound", bad, err)
		}
	}
	for range 2 {
		accepted, err := s.AcceptChange(ctx, j.Token, 3, change.ProposedAt, "Jane Doe", "jane@bob.example")
		if c := accepted.Payments[2]; err != nil || c.AcceptedName != "Jane Doe" || c.AcceptedEmail != "jane@bob.example" ||
			c.AcceptedAt.IsZero() {
			t.Fatalf("accept change: %+v %v", c, err)
		}
		if accepted.TotalCents() != 115050 {
			t.Fatalf("total with the accepted change: %d, want 115050", accepted.TotalCents())
		}
	}
	if err := s.WithdrawChange(ctx, profileID, j.ID, 3); !errors.Is(err, ErrNotWithdrawable) {
		t.Fatalf("withdraw an accepted change: %v, want ErrNotWithdrawable", err)
	}
	final, err := s.MarkDone(ctx, profileID, j.ID, 3, "")
	if err != nil {
		t.Fatal(err)
	}
	inv, err := invoices.GetOfProfile(ctx, profileID, final.Payments[2].InvoiceID)
	if err != nil || inv.Amount.String() != "150000000" || !strings.Contains(inv.Note, "- Final delivery (INV-0002)") {
		t.Fatalf("the change's invoice: %v %q %v", inv.Amount, inv.Note, err)
	}

	// A withdrawn change leaves no gap; only the last payment can go, and a payment of the quote never.
	pending, _, err := s.ProposeChange(ctx, profileID, j.ID, "c3", extra)
	if err != nil {
		t.Fatal(err)
	}
	if err := s.WithdrawChange(ctx, profileID, j.ID, 2); !errors.Is(err, ErrNotWithdrawable) {
		t.Fatalf("withdraw a payment of the quote: %v, want ErrNotWithdrawable", err)
	}
	if err := s.WithdrawChange(ctx, profileID, j.ID, 4); err != nil {
		t.Fatal(err)
	}
	if err := s.WithdrawChange(ctx, profileID, j.ID, 4); !errors.Is(err, ErrNotFound) {
		t.Fatalf("withdraw twice: %v, want ErrNotFound", err)
	}
	if _, err := s.AcceptChange(ctx, j.Token, 4, pending.Payments[3].ProposedAt, "Jane Doe", "jane@bob.example"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("accept a withdrawn change: %v, want ErrNotFound", err)
	}
	for i := 4; i <= MaxPayments; i++ {
		filled, _, err := s.ProposeChange(ctx, profileID, j.ID, "fill-"+string(rune('a'+i)), extra)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := s.AcceptChange(ctx, j.Token, i, filled.Payments[i-1].ProposedAt, "Jane Doe", "jane@bob.example"); err != nil {
			t.Fatal(err)
		}
	}
	if _, _, err := s.ProposeChange(ctx, profileID, j.ID, "over", extra); !errors.Is(err, ErrInvalid) {
		t.Fatalf("an 11th payment: %v, want ErrInvalid", err)
	}
}

// R-105: the client's acceptance binds to the change they read, one change waits at a time, and the last agreed payment
// stays the final one while a change waits.
func TestScopeChangeConsent(t *testing.T) {
	ctx := context.Background()
	pool, profileID := open(t)
	invoices := invoice.NewService(pool)
	s := NewService(pool, invoices)
	j, _, err := s.Create(ctx, profileID, "k1", quote(true))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.Accept(ctx, j.Token, "Jane Doe", "jane@bob.example"); err != nil {
		t.Fatal(err)
	}
	small, _, err := s.ProposeChange(ctx, profileID, j.ID, "c1", PaymentRequest{Title: "Extra", AmountUSD: "150", DueDays: 7})
	if err != nil {
		t.Fatal(err)
	}
	read := small.Payments[2].ProposedAt
	if _, _, err := s.ProposeChange(ctx, profileID, j.ID, "c2", PaymentRequest{Title: "More", AmountUSD: "1", DueDays: 7}); !errors.Is(err, ErrChangePending) {
		t.Fatalf("a second change while one waits: %v, want ErrChangePending", err)
	}
	// The last agreed payment is the final one, though a change waits after it.
	final, err := s.MarkDone(ctx, profileID, j.ID, 2, "")
	if err != nil {
		t.Fatal(err)
	}
	inv, err := invoices.GetOfProfile(ctx, profileID, final.Payments[1].InvoiceID)
	if err != nil || !strings.HasPrefix(inv.Note, "Final invoice for Logo design.") {
		t.Fatalf("the last agreed payment's note %q %v", inv.Note, err)
	}
	// The owner swaps the change for a bigger one; the client's accept of the one they read lands on nothing.
	if err := s.WithdrawChange(ctx, profileID, j.ID, 3); err != nil {
		t.Fatal(err)
	}
	if _, _, err := s.ProposeChange(ctx, profileID, j.ID, "c3", PaymentRequest{Title: "Extra", AmountUSD: "5000", DueDays: 7}); err != nil {
		t.Fatal(err)
	}
	if _, err := s.AcceptChange(ctx, j.Token, 3, read, "Jane Doe", "jane@bob.example"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("accept the withdrawn change's read: %v, want ErrNotFound", err)
	}
	if got, err := s.Get(ctx, profileID, j.ID); err != nil || !got.Payments[2].AcceptedAt.IsZero() {
		t.Fatalf("the new change got the acceptance: %+v %v", got.Payments[2], err)
	}
}
