package job

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/ensp1re/forwend/apps/backend/internal/invoice"
	"github.com/ensp1re/forwend/apps/backend/internal/outbox"
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
	emails := func() int {
		t.Helper()
		var n int
		if err := pool.QueryRow(ctx, "SELECT count(*) FROM outbox_events WHERE job_id = $1 AND kind = 'job.change'",
			j.ID).Scan(&n); err != nil {
			t.Fatal(err)
		}
		return n
	}
	if emails() != 1 || !change.ClientEmailed || proposed.Payments[1].ClientEmailed {
		t.Fatalf("change emails %d, clientEmailed %v, want 1 on the change alone (R-107)", emails(), change.ClientEmailed)
	}
	if again, created, err := s.ProposeChange(ctx, profileID, j.ID, "c1", PaymentRequest{Title: "Extra page",
		AmountUSD: "150.00", DueDays: 7}); err != nil || created || len(again.Payments) != 3 {
		t.Fatalf("same request: %d payments, created %v, %v", len(again.Payments), created, err)
	}
	if _, _, err := s.ProposeChange(ctx, profileID, j.ID, "c1", PaymentRequest{Title: "Other", AmountUSD: "1",
		DueDays: 7}); !errors.Is(err, ErrConflict) {
		t.Fatalf("same key, other change: %v, want ErrConflict", err)
	}
	if emails() != 1 {
		t.Fatalf("change emails after a replay %d, want 1", emails())
	}
	if _, _, err := s.ProposeChange(ctx, profileID, j.ID, "c2", PaymentRequest{Title: "Extra", AmountUSD: "1",
		DueDays: 7, OnAccept: true}); !errors.Is(err, ErrInvalid) {
		t.Fatalf("a change as deposit: %v, want ErrInvalid", err)
	}

	if _, err := s.MarkDone(ctx, profileID, j.ID, 2, ""); !errors.Is(err, ErrChangePending) {
		t.Fatalf("the last agreed payment while a change waits: %v, want ErrChangePending", err)
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
	if _, err := s.MarkDone(ctx, profileID, j.ID, 2, ""); err != nil {
		t.Fatal(err)
	}
	final, err := s.MarkDone(ctx, profileID, j.ID, 3, "")
	if err != nil {
		t.Fatal(err)
	}
	inv, err := invoices.GetOfProfile(ctx, profileID, final.Payments[2].InvoiceID)
	if err != nil || inv.Amount.String() != "150000000" || !strings.Contains(inv.Note, "- Final delivery (INV-0002)") {
		t.Fatalf("the change's invoice: %v %q %v", inv.Amount, inv.Note, err)
	}

	// The last payment is done: more work is a new job.
	if _, _, err := s.ProposeChange(ctx, profileID, j.ID, "c3", extra); !errors.Is(err, ErrJobFinished) {
		t.Fatalf("a change on a finished job: %v, want ErrJobFinished", err)
	}

	// A withdrawn change leaves no gap; only the last payment can go, and a payment of the quote never.
	j, _, err = s.Create(ctx, profileID, "k2", quote(true))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.Accept(ctx, j.Token, "Jane Doe", "jane@bob.example"); err != nil {
		t.Fatal(err)
	}
	pending, _, err := s.ProposeChange(ctx, profileID, j.ID, "c3", extra)
	if err != nil {
		t.Fatal(err)
	}
	if err := s.WithdrawChange(ctx, profileID, j.ID, 2); !errors.Is(err, ErrNotWithdrawable) {
		t.Fatalf("withdraw a payment of the quote: %v, want ErrNotWithdrawable", err)
	}
	if err := s.WithdrawChange(ctx, profileID, j.ID, 3); err != nil {
		t.Fatal(err)
	}
	if err := s.WithdrawChange(ctx, profileID, j.ID, 3); !errors.Is(err, ErrNotFound) {
		t.Fatalf("withdraw twice: %v, want ErrNotFound", err)
	}
	if _, err := s.AcceptChange(ctx, j.Token, 3, pending.Payments[2].ProposedAt, "Jane Doe", "jane@bob.example"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("accept a withdrawn change: %v, want ErrNotFound", err)
	}
	for i := 3; i <= MaxPayments; i++ {
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

// R-105: the client's acceptance binds to the change they read, one change waits at a time, a withdrawn change's key
// stays used, and the final invoice waits until no change does; then the job is finished.
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
	// A late retry of the withdrawn change's request replays: it adds nothing, and its key stays used.
	again, created, err := s.ProposeChange(ctx, profileID, j.ID, "c1", PaymentRequest{Title: "Extra", AmountUSD: "150", DueDays: 7})
	if err != nil || created || len(again.Payments) != 3 || again.Payments[2].AmountCents != 500000 {
		t.Fatalf("retry of the withdrawn change: %+v, created %v, %v", again.Payments, created, err)
	}
	if _, _, err := s.ProposeChange(ctx, profileID, j.ID, "c1", PaymentRequest{Title: "Other", AmountUSD: "1", DueDays: 7}); !errors.Is(err, ErrConflict) {
		t.Fatalf("the withdrawn change's key with another change: %v, want ErrConflict", err)
	}
	// The final invoice waits until no change does, so its note never misses one.
	if _, err := s.MarkDone(ctx, profileID, j.ID, 2, ""); !errors.Is(err, ErrChangePending) {
		t.Fatalf("the final while a change waits: %v, want ErrChangePending", err)
	}
	if err := s.WithdrawChange(ctx, profileID, j.ID, 3); err != nil {
		t.Fatal(err)
	}
	final, err := s.MarkDone(ctx, profileID, j.ID, 2, "")
	if err != nil {
		t.Fatal(err)
	}
	inv, err := invoices.GetOfProfile(ctx, profileID, final.Payments[1].InvoiceID)
	if err != nil || !strings.HasPrefix(inv.Note, "Final invoice for Logo design.") {
		t.Fatalf("the final note %q %v", inv.Note, err)
	}
	if _, _, err := s.ProposeChange(ctx, profileID, j.ID, "c4", PaymentRequest{Title: "More", AmountUSD: "1", DueDays: 7}); !errors.Is(err, ErrJobFinished) {
		t.Fatalf("a change after the final: %v, want ErrJobFinished", err)
	}
}

// R-105: a final invoice made while a change is being proposed rolls back and reads the job again, so it waits for the
// change like any final.
func TestFinalWaitsForAChangeInFlight(t *testing.T) {
	ctx := context.Background()
	pool, profileID := open(t)
	s := NewService(pool, invoice.NewService(pool))
	j, _, err := s.Create(ctx, profileID, "k1", quote(true))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.Accept(ctx, j.Token, "Jane Doe", "jane@bob.example"); err != nil {
		t.Fatal(err)
	}
	// A proposal in flight: it holds the job row and adds the change, as ProposeChange does.
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, "SELECT 1 FROM jobs WHERE id = $1 FOR UPDATE", j.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(ctx, `INSERT INTO job_payments (job_id, position, title, amount_cents, due_days, on_accept,
		proposed_at, change_key, change_hash) VALUES ($1, 3, 'Extra', 100, 7, false, now(), 'c1', $2)`, j.ID,
		make([]byte, 32)); err != nil {
		t.Fatal(err)
	}
	done := make(chan error, 1)
	go func() {
		_, err := s.MarkDone(ctx, profileID, j.ID, 2, "")
		done <- err
	}()
	// MarkDone read the job before the change and now waits for the job row.
	deadline := time.Now().Add(10 * time.Second)
	for waiting := false; !waiting; time.Sleep(10 * time.Millisecond) {
		if time.Now().After(deadline) {
			t.Fatal("MarkDone never waited for the job row")
		}
		if err := pool.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE datname = current_database()
			AND pid <> pg_backend_pid() AND wait_event_type = 'Lock' AND query LIKE 'SELECT 1 FROM jobs WHERE id = $1 FOR UPDATE')`).Scan(&waiting); err != nil {
			t.Fatal(err)
		}
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	if err := <-done; !errors.Is(err, ErrChangePending) {
		t.Fatalf("the final while a change is proposed: %v, want ErrChangePending", err)
	}
	if got, err := s.Get(ctx, profileID, j.ID); err != nil || got.Payments[1].InvoiceID != "" {
		t.Fatalf("payment 2 got an invoice: %+v %v", got.Payments[1], err)
	}
}

// R-105: a job paid in full up front is never finished by Mark done (its deposit is invoiced at acceptance), so it
// still takes a change, which then becomes its final payment.
func TestDepositOnlyJobTakesAChange(t *testing.T) {
	ctx := context.Background()
	pool, profileID := open(t)
	invoices := invoice.NewService(pool)
	s := NewService(pool, invoices)
	r := quote(true)
	r.Payments = r.Payments[:1]
	j, _, err := s.Create(ctx, profileID, "k1", r)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.Accept(ctx, j.Token, "Jane Doe", "jane@bob.example"); err != nil {
		t.Fatal(err)
	}
	proposed, _, err := s.ProposeChange(ctx, profileID, j.ID, "c1", PaymentRequest{Title: "Extra", AmountUSD: "150", DueDays: 7})
	if err != nil {
		t.Fatalf("a change on a deposit-only job: %v", err)
	}
	if _, err := s.AcceptChange(ctx, j.Token, 2, proposed.Payments[1].ProposedAt, "Jane Doe", "jane@bob.example"); err != nil {
		t.Fatal(err)
	}
	final, err := s.MarkDone(ctx, profileID, j.ID, 2, "")
	if err != nil {
		t.Fatal(err)
	}
	inv, err := invoices.GetOfProfile(ctx, profileID, final.Payments[1].InvoiceID)
	if err != nil || !strings.HasPrefix(inv.Note, "Final invoice for Logo design.") {
		t.Fatalf("the change's final note %q %v", inv.Note, err)
	}
	if _, _, err := s.ProposeChange(ctx, profileID, j.ID, "c2", PaymentRequest{Title: "More", AmountUSD: "1", DueDays: 7}); !errors.Is(err, ErrJobFinished) {
		t.Fatalf("a change after the change's final: %v, want ErrJobFinished", err)
	}
}

// R-107, R-116: a job sends its client at most MaxChangeEmails change emails in a day, and a user
// outbox.MaxClientEmails client emails of every kind; past that the change is still added, and the owner's read says no
// email went.
func TestChangeEmailsPerDay(t *testing.T) {
	ctx := context.Background()
	pool, profileID := open(t)
	s := NewService(pool, invoice.NewService(pool))
	j, _, err := s.Create(ctx, profileID, "k1", quote(true))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.Accept(ctx, j.Token, "Jane Doe", "jane@bob.example"); err != nil {
		t.Fatal(err)
	}
	for i := range MaxChangeEmails + 1 {
		proposed, created, err := s.ProposeChange(ctx, profileID, j.ID, fmt.Sprint("c", i), PaymentRequest{Title: "Extra",
			AmountUSD: "150", DueDays: 7})
		if err != nil || !created || len(proposed.Payments) != 3 || proposed.Payments[2].ClientEmailed != (i < MaxChangeEmails) {
			t.Fatalf("change %d: %v %+v %v", i, created, proposed.Payments, err)
		}
		if err := s.WithdrawChange(ctx, profileID, j.ID, 3); err != nil {
			t.Fatal(err)
		}
	}
	var n int
	if err := pool.QueryRow(ctx, "SELECT count(*) FROM outbox_events WHERE job_id = $1", j.ID).Scan(&n); err != nil ||
		n != MaxChangeEmails {
		t.Fatalf("change emails %d %v, want %d", n, err, MaxChangeEmails)
	}

	// The user's other client emails count too, of any kind.
	other, _, err := s.Create(ctx, profileID, "k2", quote(true))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.Accept(ctx, other.Token, "Jane Doe", "jane@bob.example"); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO outbox_events (kind, invoice_id, payload, idempotency_key)
		SELECT 'invoice.sent', invoice_id, '{}', 'old-' || n FROM job_payments, generate_series(1, $2) n
		WHERE job_id = $1 AND position = 1`, j.ID, outbox.MaxClientEmails-MaxChangeEmails); err != nil {
		t.Fatal(err)
	}
	proposed, created, err := s.ProposeChange(ctx, profileID, other.ID, "c", PaymentRequest{Title: "Extra", AmountUSD: "150",
		DueDays: 7})
	if err != nil || !created || proposed.Payments[2].ClientEmailed {
		t.Fatalf("a change past the profile's cap: %v %+v %v", created, proposed.Payments, err)
	}
}
