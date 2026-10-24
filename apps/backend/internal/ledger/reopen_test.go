package ledger

import (
	"context"
	"testing"

	"github.com/jackc/pgx/v5"
)

// R-130: the money held at the close, a late payment included, is the creator's again up to the amount, named by the
// deposit it came from; a short close expires it again, and it reopens once.
func TestReopenCountsHeldAndNewMoneyUntilTheNewClose(t *testing.T) {
	s := newSim(t)
	ctx := context.Background()
	reopen := func(id string, until int64) error {
		return pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
			if _, err := tx.Exec(ctx, "SELECT 1 FROM invoices WHERE id = $1 FOR UPDATE", id); err != nil {
				return err
			}
			return Reopen(ctx, tx, id, until)
		})
	}
	balance := func(id, account string) int64 {
		var n int64
		if err := s.pool.QueryRow(ctx, `SELECT coalesce(sum(e.amount), 0) FROM ledger_entries e
			JOIN ledger_transactions x ON x.id = e.transaction_id WHERE x.invoice_id = $1 AND e.account = $2`,
			id, account).Scan(&n); err != nil {
			t.Fatal(err)
		}
		return -n // credit balances are negative
	}
	paidBy := func(transfer int64) int64 {
		var n int64
		if err := s.pool.QueryRow(ctx, `SELECT coalesce(-sum(e.amount), 0) FROM ledger_entries e
			JOIN ledger_transactions x ON x.id = e.transaction_id
			WHERE x.chain_transfer_id = $1 AND e.account = 'recipient_payable'`, transfer).Scan(&n); err != nil {
			t.Fatal(err)
		}
		return n
	}
	full, receive := s.invoice()
	short, shortReceive := s.invoice()
	onTime := s.transfer(full, receive, 2000000, 900, "confirmed")
	s.transfer(short, shortReceive, 1000000, 900, "confirmed")
	s.finalizedAt(1100)
	s.process(full)
	s.process(short)
	late := s.transfer(full, receive, 4000000, 1200, "confirmed") // late: held
	s.process(full)
	if p, _ := s.payment(full); p != ExpiredPartiallyPaid || balance(full, "payer_held") != 6000000 {
		t.Fatalf("before the reopen: %s, held %d", p, balance(full, "payer_held"))
	}

	if err := reopen(full, 50000); err != nil {
		t.Fatal(err)
	}
	s.process(full)
	if p, r := s.payment(full); p != Paid || r != "held" || balance(full, "recipient_payable") != 5000000 ||
		balance(full, "payer_held") != 1000000 || paidBy(onTime) != 2000000 || paidBy(late) != 3000000 {
		t.Fatalf("after the reopen: %s, refund %s, owed %d, held %d, paid by deposit %d and %d", p, r,
			balance(full, "recipient_payable"), balance(full, "payer_held"), paidBy(onTime), paidBy(late))
	}

	if err := reopen(short, 50000); err != nil {
		t.Fatal(err)
	}
	if _, r := s.payment(short); r != "none" {
		t.Fatalf("nothing held after the reopen, refund %s", r)
	}
	s.transfer(short, shortReceive, 1000000, 40000, "confirmed") // before the new close: paid to the creator
	s.process(short)
	if p, _ := s.payment(short); p != PartiallyPaid || balance(short, "recipient_payable") != 2000000 {
		t.Fatalf("reopened, short: %s, owed %d", p, balance(short, "recipient_payable"))
	}
	s.finalizedAt(60000)
	s.process(short)
	if p, _ := s.payment(short); p != ExpiredPartiallyPaid || balance(short, "payer_held") != 2000000 {
		t.Fatalf("closed short again: %s, held %d", p, balance(short, "payer_held"))
	}
	if err := reopen(short, 70000); err == nil {
		t.Fatal("reopened twice")
	}
}
