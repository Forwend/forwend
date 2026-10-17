package database_test

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/ensp1re/forwend/apps/backend/internal/database"
	"github.com/ensp1re/forwend/apps/backend/internal/database/databasetest"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

const (
	uint256Max = "115792089237316195423570985008687907853269984665640564039457584007913129639935"
	token      = "0x036cbd53842c5426634e7929541ec2318f3dcf7e"
	codeUnique = "23505"
	codeCheck  = "23514"
	codeFK     = "23503"
	codeRaise  = "P0001"
)

// moneyDB migrates a fresh database with one chain, token, user and profile.
func moneyDB(t *testing.T) (*pgx.Conn, string) {
	t.Helper()
	ctx := context.Background()
	url := databasetest.New(t)
	if err := database.Migrate(ctx, url); err != nil {
		t.Fatal(err)
	}
	conn, err := pgx.Connect(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { conn.Close(ctx) })
	var profile string
	err = conn.QueryRow(ctx, `
		WITH c AS (INSERT INTO chains (chain_id, chain_family, name) VALUES (84532, 'evm', 'base-sepolia')),
		     tk AS (INSERT INTO tokens (chain_id, chain_family, contract, symbol, decimals)
		            VALUES (84532, 'evm', $1, 'USDC', 6)),
		     u AS (INSERT INTO users (privy_user_id) VALUES ('did:privy:1') RETURNING id)
		INSERT INTO profiles (user_id, kind) SELECT id, 'freelancer' FROM u RETURNING id`, token).Scan(&profile)
	if err != nil {
		t.Fatal(err)
	}
	return conn, profile
}

// hex32 and hex20 build distinct lowercase hex values for ids, hashes and addresses.
func hex32(n int) string { return fmt.Sprintf("0x%064x", n) }
func hex20(n int) string { return fmt.Sprintf("0x%040x", n) }

func insertInvoice(conn *pgx.Conn, profile string, id int, receive, key, amount string) error {
	_, err := conn.Exec(context.Background(), `
		INSERT INTO invoices (id, profile_id, chain_id, chain_family, token_contract, amount, expires_at, settle_deadline,
		    recipient_address, receive_method, factory_address, receive_address, idempotency_key, request_hash)
		VALUES ($1, $2, 84532, 'evm', $3, $4, 1800000000, 1800086400, $5, 'evm_create2', $6, $7, $8, $9)`,
		hex32(id), profile, token, amount, hex20(1), hex20(2), receive, key, make([]byte, 32))
	return err
}

func insertTransfer(conn *pgx.Conn, invoice int, to string, tx, block, logIndex int) (int64, error) {
	var id int64
	err := conn.QueryRow(context.Background(), `
		INSERT INTO chain_transfers (chain_id, chain_family, token_contract, invoice_id, tx_hash, log_index, block_hash,
		    block_number, block_time, from_address, to_address, amount)
		VALUES (84532, 'evm', $1, $2, $3, $4, $5, $6, 1800000000, $7, $8, 5000000) RETURNING id`,
		token, hex32(invoice), hex32(tx), logIndex, hex32(block), block, hex20(9), to).Scan(&id)
	return id, err
}

func wantCode(t *testing.T, err error, code, what string) {
	t.Helper()
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) || pgErr.Code != code {
		t.Fatalf("%s: want SQLSTATE %s, got %v", what, code, err)
	}
}

func must(t *testing.T, err error) {
	t.Helper()
	if err != nil {
		t.Fatal(err)
	}
}

func TestReceiveAddressIsUniquePerChain(t *testing.T) {
	conn, profile := moneyDB(t)
	must(t, insertInvoice(conn, profile, 1, hex20(100), "key-1", "5000000"))
	wantCode(t, insertInvoice(conn, profile, 2, hex20(100), "key-2", "5000000"), codeUnique, "same receive address")
	// A checksummed (mixed-case) copy would dodge the unique index, so only lowercase is stored.
	must(t, insertInvoice(conn, profile, 3, hex20(0xabcdef), "key-3", "5000000"))
	mixed := "0x" + strings.ToUpper(hex20(0xabcdef)[2:])
	wantCode(t, insertInvoice(conn, profile, 4, mixed, "key-4", "5000000"), codeCheck, "mixed-case address")
}

func TestIdempotencyKeyIsUniquePerProfile(t *testing.T) {
	conn, profile := moneyDB(t)
	must(t, insertInvoice(conn, profile, 1, hex20(100), "key-1", "5000000"))
	wantCode(t, insertInvoice(conn, profile, 2, hex20(101), "key-1", "5000000"), codeUnique, "same profile and key")

	var other string
	must(t, conn.QueryRow(context.Background(), `INSERT INTO profiles (user_id, kind)
		SELECT user_id, 'merchant' FROM profiles WHERE id = $1 RETURNING id`, profile).Scan(&other))
	must(t, insertInvoice(conn, other, 3, hex20(102), "key-1", "5000000"))
}

func TestAmountFitsUint256(t *testing.T) {
	conn, profile := moneyDB(t)
	must(t, insertInvoice(conn, profile, 1, hex20(100), "key-1", uint256Max))
	over := "115792089237316195423570985008687907853269984665640564039457584007913129639936"
	wantCode(t, insertInvoice(conn, profile, 2, hex20(101), "key-2", over), codeCheck, "amount 2^256")
	wantCode(t, insertInvoice(conn, profile, 3, hex20(102), "key-3", "0"), codeCheck, "amount 0")
}

func TestTransferIsUniqueUntilReorged(t *testing.T) {
	conn, profile := moneyDB(t)
	ctx := context.Background()
	must(t, insertInvoice(conn, profile, 1, hex20(100), "key-1", "5000000"))
	first, err := insertTransfer(conn, 1, hex20(100), 7, 1000, 3)
	must(t, err)

	_, err = insertTransfer(conn, 1, hex20(100), 7, 1001, 3)
	wantCode(t, err, codeUnique, "same (chain_id, tx_hash, log_index) in another block")
	_, err = insertTransfer(conn, 1, hex20(101), 8, 1000, 4)
	wantCode(t, err, codeFK, "transfer to an address that is not the invoice's")

	// The block is reorged out and the same transaction is mined again with the same log index.
	_, err = conn.Exec(ctx, "UPDATE chain_transfers SET status = 'reorged' WHERE id = $1", first)
	must(t, err)
	_, err = insertTransfer(conn, 1, hex20(100), 7, 1001, 3)
	must(t, err)
}

func TestLedgerIsAppendOnly(t *testing.T) {
	conn, profile := moneyDB(t)
	ctx := context.Background()
	must(t, insertInvoice(conn, profile, 1, hex20(100), "key-1", "5000000"))
	transfer, err := insertTransfer(conn, 1, hex20(100), 7, 1000, 3)
	must(t, err)
	_, err = conn.Exec(ctx, "UPDATE chain_transfers SET status = 'confirmed' WHERE id = $1", transfer)
	must(t, err)
	_, err = conn.Exec(ctx, `
		WITH tx AS (INSERT INTO ledger_transactions (invoice_id, kind, chain_transfer_id)
		            VALUES ($1, 'deposit', $2) RETURNING id)
		INSERT INTO ledger_entries (transaction_id, account, amount)
		SELECT id, 'receiver', 5000000 FROM tx UNION ALL SELECT id, 'recipient_payable', -5000000 FROM tx`,
		hex32(1), transfer)
	must(t, err)

	for _, stmt := range []string{
		"UPDATE ledger_entries SET amount = amount * 2",
		"DELETE FROM ledger_entries",
		"TRUNCATE ledger_entries",
		"UPDATE ledger_transactions SET kind = 'refund'",
		"DELETE FROM ledger_transactions",
		"TRUNCATE ledger_transactions CASCADE",
	} {
		_, err := conn.Exec(ctx, stmt)
		wantCode(t, err, codeRaise, stmt)
	}
	// Replica mode skips ordinary triggers; the guards are ENABLE ALWAYS.
	_, err = conn.Exec(ctx, "SET session_replication_role = replica")
	must(t, err)
	_, err = conn.Exec(ctx, "DELETE FROM ledger_entries")
	wantCode(t, err, codeRaise, "DELETE in replica mode")
}

func TestLedgerTransactionsBalance(t *testing.T) {
	conn, profile := moneyDB(t)
	ctx := context.Background()
	must(t, insertInvoice(conn, profile, 1, hex20(100), "key-1", "5000000"))
	transfer, err := insertTransfer(conn, 1, hex20(100), 7, 1000, 3)
	must(t, err)
	_, err = conn.Exec(ctx, "UPDATE chain_transfers SET status = 'confirmed' WHERE id = $1", transfer)
	must(t, err)

	// Checked at commit: the receiver gets 6 but only 5 is owed.
	tx, err := conn.Begin(ctx)
	must(t, err)
	_, err = tx.Exec(ctx, `
		WITH t AS (INSERT INTO ledger_transactions (invoice_id, kind, chain_transfer_id)
		           VALUES ($1, 'deposit', $2) RETURNING id)
		INSERT INTO ledger_entries (transaction_id, account, amount)
		SELECT id, 'receiver', 6000000 FROM t UNION ALL SELECT id, 'recipient_payable', -5000000 FROM t`,
		hex32(1), transfer)
	must(t, err)
	wantCode(t, tx.Commit(ctx), codeRaise, "unbalanced transaction")

	var n int
	must(t, conn.QueryRow(ctx, "SELECT count(*) FROM ledger_transactions").Scan(&n))
	if n != 0 {
		t.Fatalf("unbalanced transaction left %d rows", n)
	}
}

func TestLedgerTransactionNeedsEntries(t *testing.T) {
	conn, profile := moneyDB(t)
	ctx := context.Background()
	must(t, insertInvoice(conn, profile, 1, hex20(100), "key-1", "5000000"))
	transfer, err := insertTransfer(conn, 1, hex20(100), 7, 1000, 3)
	must(t, err)
	_, err = conn.Exec(ctx, "UPDATE chain_transfers SET status = 'confirmed' WHERE id = $1", transfer)
	must(t, err)
	// An empty transaction would take the transfer's only deposit slot.
	_, err = conn.Exec(ctx, "INSERT INTO ledger_transactions (invoice_id, kind, chain_transfer_id) VALUES ($1, 'deposit', $2)",
		hex32(1), transfer)
	wantCode(t, err, codeRaise, "ledger transaction without entries")
}

func TestBookedTransferCannotChange(t *testing.T) {
	conn, profile := moneyDB(t)
	ctx := context.Background()
	must(t, insertInvoice(conn, profile, 1, hex20(100), "key-1", "5000000"))
	transfer, err := insertTransfer(conn, 1, hex20(100), 7, 1000, 3)
	must(t, err)
	book := `
		WITH tx AS (INSERT INTO ledger_transactions (invoice_id, kind, chain_transfer_id)
		            VALUES ($1, 'deposit', $2) RETURNING id)
		INSERT INTO ledger_entries (transaction_id, account, amount)
		SELECT id, 'receiver', 5000000 FROM tx UNION ALL SELECT id, 'recipient_payable', -5000000 FROM tx`
	_, err = conn.Exec(ctx, book, hex32(1), transfer)
	wantCode(t, err, codeRaise, "booking a transfer that is not confirmed")

	_, err = conn.Exec(ctx, "UPDATE chain_transfers SET status = 'confirmed' WHERE id = $1", transfer)
	must(t, err)
	_, err = conn.Exec(ctx, "UPDATE chain_transfers SET booked = true WHERE id = $1", transfer)
	wantCode(t, err, codeRaise, "marking a transfer booked without a ledger deposit")
	_, err = conn.Exec(ctx, `
		INSERT INTO chain_transfers (chain_id, chain_family, token_contract, invoice_id, tx_hash, log_index, block_hash,
		    block_number, block_time, from_address, to_address, amount, status, booked)
		VALUES (84532, 'evm', $1, $2, $3, 0, $3, 1, 1800000000, $4, $5, 1, 'confirmed', true)`,
		token, hex32(1), hex32(99), hex20(9), hex20(100))
	wantCode(t, err, codeRaise, "inserting a transfer already marked booked")
	_, err = conn.Exec(ctx, book, hex32(1), transfer)
	must(t, err)
	// Marking it reorged would let a re-mined copy be booked again: the money counted twice.
	_, err = conn.Exec(ctx, "UPDATE chain_transfers SET status = 'reorged' WHERE id = $1", transfer)
	wantCode(t, err, codeRaise, "reorging a booked transfer")
	_, err = conn.Exec(ctx, "UPDATE chain_transfers SET status = 'reorged', booked = false WHERE id = $1", transfer)
	wantCode(t, err, codeRaise, "unbooking and reorging a booked transfer")
}

// A reorg update racing a booking waits for it, then fails: in READ COMMITTED on the booked row, in REPEATABLE READ
// on the concurrent write.
func TestBookingAndReorgDoNotRace(t *testing.T) {
	for _, level := range []pgx.TxIsoLevel{pgx.ReadCommitted, pgx.RepeatableRead} {
		t.Run(string(level), func(t *testing.T) { bookingRacesReorg(t, level) })
	}
}

func bookingRacesReorg(t *testing.T, level pgx.TxIsoLevel) {
	conn, profile := moneyDB(t)
	ctx := context.Background()
	must(t, insertInvoice(conn, profile, 1, hex20(100), "key-1", "5000000"))
	transfer, err := insertTransfer(conn, 1, hex20(100), 7, 1000, 3)
	must(t, err)
	_, err = conn.Exec(ctx, "UPDATE chain_transfers SET status = 'confirmed' WHERE id = $1", transfer)
	must(t, err)
	other, err := pgx.Connect(ctx, conn.Config().ConnString())
	must(t, err)
	defer other.Close(ctx)

	reorgTx, err := other.BeginTx(ctx, pgx.TxOptions{IsoLevel: level})
	must(t, err)
	defer reorgTx.Rollback(ctx)
	_, err = reorgTx.Exec(ctx, "SELECT 1 FROM chain_transfers") // take the snapshot before the booking commits
	must(t, err)

	booking, err := conn.Begin(ctx)
	must(t, err)
	_, err = booking.Exec(ctx, `
		WITH tx AS (INSERT INTO ledger_transactions (invoice_id, kind, chain_transfer_id)
		            VALUES ($1, 'deposit', $2) RETURNING id)
		INSERT INTO ledger_entries (transaction_id, account, amount)
		SELECT id, 'receiver', 5000000 FROM tx UNION ALL SELECT id, 'recipient_payable', -5000000 FROM tx`,
		hex32(1), transfer)
	must(t, err)

	reorg := make(chan error)
	go func() {
		_, err := reorgTx.Exec(ctx, "UPDATE chain_transfers SET status = 'reorged' WHERE id = $1", transfer)
		reorg <- err
	}()
	select {
	case err := <-reorg:
		t.Fatalf("reorg update did not wait for the booking: %v", err)
	case <-time.After(300 * time.Millisecond):
	}
	must(t, booking.Commit(ctx))
	want := codeRaise
	if level == pgx.RepeatableRead {
		want = "40001" // serialization_failure
	}
	wantCode(t, <-reorg, want, "reorg after a concurrent booking")
}

// A 5 USDC invoice paid in three 2 USDC transfers: each is booked once, the third splits into 1 owed to the creator
// and 1 held for the payer, and the receiver balance equals the 6 on chain.
func TestInvoicePaidInSeveralTransfers(t *testing.T) {
	conn, profile := moneyDB(t)
	ctx := context.Background()
	must(t, insertInvoice(conn, profile, 1, hex20(100), "key-1", "5000000"))
	book := `
		WITH tx AS (INSERT INTO ledger_transactions (invoice_id, kind, chain_transfer_id)
		            VALUES ($1, 'deposit', $2) RETURNING id)
		INSERT INTO ledger_entries (transaction_id, account, amount)
		SELECT id, 'receiver', $3::numeric FROM tx
		UNION ALL SELECT id, 'recipient_payable', -$4::numeric FROM tx WHERE $4::numeric > 0
		UNION ALL SELECT id, 'payer_held', -($3::numeric - $4::numeric) FROM tx WHERE $3::numeric > $4::numeric`
	for i, payable := range []int64{2000000, 2000000, 1000000} {
		transfer, err := insertTransfer(conn, 1, hex20(100), 10+i, 1000+i, 0)
		must(t, err)
		_, err = conn.Exec(ctx, "UPDATE chain_transfers SET amount = 2000000, status = 'confirmed' WHERE id = $1", transfer)
		must(t, err)
		_, err = conn.Exec(ctx, book, hex32(1), transfer, int64(2000000), payable)
		must(t, err)
	}

	var receiver, payable, held int64
	must(t, conn.QueryRow(ctx, `
		SELECT coalesce(sum(e.amount) FILTER (WHERE account = 'receiver'), 0),
		       -coalesce(sum(e.amount) FILTER (WHERE account = 'recipient_payable'), 0),
		       -coalesce(sum(e.amount) FILTER (WHERE account = 'payer_held'), 0)
		FROM ledger_entries e JOIN ledger_transactions t ON t.id = e.transaction_id WHERE t.invoice_id = $1`,
		hex32(1)).Scan(&receiver, &payable, &held))
	if receiver != 6000000 || payable != 5000000 || held != 1000000 {
		t.Fatalf("receiver %d, payable %d, held %d; want 6000000, 5000000, 1000000", receiver, payable, held)
	}
	var booked int
	must(t, conn.QueryRow(ctx, "SELECT count(*) FROM chain_transfers WHERE invoice_id = $1 AND booked", hex32(1)).Scan(&booked))
	if booked != 3 {
		t.Fatalf("%d transfers booked, want 3", booked)
	}
}

// Payment status moves only along the state machine, and invoice terms never change (R-21).
func TestInvoiceStatusTransitionsAndTerms(t *testing.T) {
	conn, profile := moneyDB(t)
	ctx := context.Background()
	set := func(id int, status string) error {
		_, err := conn.Exec(ctx, "UPDATE invoices SET payment_status = $2 WHERE id = $1", hex32(id), status)
		return err
	}
	for i, path := range [][]string{
		{"detected", "open", "partially_paid", "paid"},
		{"detected", "expired"},
		{"partially_paid", "expired_partially_paid"},
	} {
		must(t, insertInvoice(conn, profile, i+1, hex20(100+i), fmt.Sprintf("key-%d", i), "5000000"))
		for _, status := range path {
			if err := set(i+1, status); err != nil {
				t.Fatalf("path %v, step %s: %v", path, status, err)
			}
		}
	}
	for _, bad := range []struct {
		id     int
		status string
	}{{1, "open"}, {1, "partially_paid"}, {2, "paid"}, {2, "open"}, {3, "partially_paid"}} {
		wantCode(t, set(bad.id, bad.status), codeRaise, fmt.Sprintf("invoice %d -> %s", bad.id, bad.status))
	}
	for _, column := range []string{"amount = amount + 1", "receive_address = '" + hex20(999) + "'",
		"expires_at = expires_at + 1", "recipient_address = '" + hex20(998) + "'"} {
		_, err := conn.Exec(ctx, "UPDATE invoices SET "+column+" WHERE id = $1", hex32(1))
		wantCode(t, err, codeRaise, column)
	}
}

// Each profile numbers its invoices from 1 inside the insert itself: a failed insert uses no number, and the number
// and the invoice's details never change (D-50).
func TestInvoiceNumbers(t *testing.T) {
	conn, profile := moneyDB(t)
	ctx := context.Background()
	var other string
	must(t, conn.QueryRow(ctx, `INSERT INTO profiles (user_id, kind)
		SELECT user_id, 'merchant' FROM profiles WHERE id = $1 RETURNING id`, profile).Scan(&other))
	must(t, insertInvoice(conn, profile, 1, hex20(100), "key-1", "5000000"))
	wantCode(t, insertInvoice(conn, profile, 2, hex20(101), "key-2", "0"), codeCheck, "amount 0")
	must(t, insertInvoice(conn, profile, 3, hex20(102), "key-3", "5000000"))
	must(t, insertInvoice(conn, other, 4, hex20(103), "key-1", "5000000"))
	for id, want := range map[int]int64{1: 1, 3: 2, 4: 1} {
		var got int64
		must(t, conn.QueryRow(ctx, "SELECT number FROM invoices WHERE id = $1", hex32(id)).Scan(&got))
		if got != want {
			t.Fatalf("invoice %d has number %d, want %d", id, got, want)
		}
	}
	for _, column := range []string{"number = 9", "title = 'Logo'", "note = 'Thanks'", "due_date = '2026-11-01'",
		"client_name = 'Bob'", "client_email = 'bob@example.com'", "client_address = 'Main St 1'",
		"client_country = 'DE'", "client_tax_id = 'DE1'", "issuer_name = 'Alice'", "issuer_address = 'Main St 2'",
		"issuer_country = 'DE'", "issuer_tax_id = 'DE1'", "issuer_email = 'alice@example.com'", "sender_name = 'Alice'",
		"return_url = 'https://alice.example'", "supply_date = '2026-10-31'", "reference = 'PO-1'",
		"(agreed_currency, agreed_amount, agreed_decimals, agreed_date) = ('EUR', 100, 2, '2026-10-01')"} {
		_, err := conn.Exec(ctx, "UPDATE invoices SET "+column+" WHERE id = $1", hex32(1))
		wantCode(t, err, codeRaise, column)
	}
}

// An option row (R-56, D-76) shares its main invoice's number, recipient, expiry and request, moves no counter, and
// the main row's chosen option is set once, to one of its own options.
func TestInvoiceOptions(t *testing.T) {
	conn, profile := moneyDB(t)
	ctx := context.Background()
	option := func(id, main int, receive, recipient string, expires int64) error {
		_, err := conn.Exec(ctx, `
			INSERT INTO invoices (id, main_id, profile_id, chain_id, chain_family, token_contract, amount, expires_at,
			    settle_deadline, recipient_address, receive_method, factory_address, receive_address, idempotency_key,
			    request_hash)
			VALUES ($1, $2, $3, 84532, 'evm', $4, 5000000, $5::bigint, $5::bigint + 86400, $6, 'evm_create2', $7, $8, 'key-1', $9)`,
			hex32(id), hex32(main), profile, token, expires, recipient, hex20(2), receive, make([]byte, 32))
		return err
	}
	must(t, insertInvoice(conn, profile, 1, hex20(100), "key-1", "5000000"))
	must(t, option(2, 1, hex20(101), hex20(1), 1800000000))
	must(t, insertInvoice(conn, profile, 3, hex20(102), "key-3", "5000000"))
	for id, want := range map[int]int64{1: 1, 2: 1, 3: 2} {
		var got int64
		must(t, conn.QueryRow(ctx, "SELECT number FROM invoices WHERE id = $1", hex32(id)).Scan(&got))
		if got != want {
			t.Fatalf("invoice %d has number %d, want %d", id, got, want)
		}
	}
	wantCode(t, option(4, 1, hex20(103), hex20(7), 1800000000), codeRaise, "another recipient")
	wantCode(t, option(4, 1, hex20(103), hex20(1), 1800000001), codeRaise, "another expiry")
	wantCode(t, option(4, 2, hex20(103), hex20(1), 1800000000), codeRaise, "an option of an option")
	wantCode(t, insertInvoice(conn, profile, 4, hex20(103), "key-1", "5000000"), codeUnique, "a second main row with the key")

	choose := func(main, chosen int) error {
		_, err := conn.Exec(ctx, "UPDATE invoices SET chosen_id = $2 WHERE id = $1", hex32(main), hex32(chosen))
		return err
	}
	wantCode(t, choose(1, 3), codeRaise, "another invoice as the chosen option")
	wantCode(t, choose(2, 2), codeCheck, "a chosen option on an option row")
	must(t, choose(1, 2))
	wantCode(t, choose(1, 1), codeRaise, "choosing again")
	_, err := conn.Exec(ctx, "UPDATE invoices SET main_id = NULL WHERE id = $1", hex32(2))
	wantCode(t, err, codeRaise, "leaving the group")
	must(t, choose(3, 3))

	// An option joins only an open invoice with no money (F144).
	must(t, insertInvoice(conn, profile, 5, hex20(105), "key-5", "5000000"))
	_, err = insertTransfer(conn, 5, hex20(105), 50, 50, 0)
	must(t, err)
	opt := func(id, main int, key string) error {
		_, err := conn.Exec(ctx, `
			INSERT INTO invoices (id, main_id, profile_id, chain_id, chain_family, token_contract, amount, expires_at,
			    settle_deadline, recipient_address, receive_method, factory_address, receive_address, idempotency_key,
			    request_hash)
			VALUES ($1, $2, $3, 84532, 'evm', $4, 5000000, 1800000000, 1800086400, $5, 'evm_create2', $6, $7, $8, $9)`,
			hex32(id), hex32(main), profile, token, hex20(1), hex20(2), hex20(id+100), key, make([]byte, 32))
		return err
	}
	wantCode(t, opt(6, 5, "key-5"), codeRaise, "an option for an invoice that has money")
	must(t, insertInvoice(conn, profile, 7, hex20(107), "key-7", "5000000"))
	_, err = conn.Exec(ctx, "UPDATE invoices SET payment_status = 'expired' WHERE id = $1", hex32(7))
	must(t, err)
	wantCode(t, opt(8, 7, "key-7"), codeRaise, "an option for an expired invoice")

	// The view shows each invoice once, with the chosen option's terms.
	var current string
	var count int
	must(t, conn.QueryRow(ctx, `SELECT (SELECT option_id FROM invoices_current WHERE id = $1),
		(SELECT count(*) FROM invoices_current)`, hex32(1)).Scan(&current, &count))
	if current != hex32(2) || count != 4 {
		t.Fatalf("invoices_current: invoice 1 shows option %s of %d rows, want %s of 4", current, count, hex32(2))
	}
}
