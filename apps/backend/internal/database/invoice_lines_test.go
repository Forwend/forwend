package database_test

import (
	"context"
	"testing"
)

// R-88.
func TestInvoiceLines(t *testing.T) {
	conn, profile := moneyDB(t)
	ctx := context.Background()
	line := func(invoice, position int, quantity, unitPrice, amount string) error {
		_, err := conn.Exec(ctx, `INSERT INTO invoice_lines (invoice_id, position, description, quantity, unit_price,
			amount) VALUES ($1, $2, 'Work', $3, $4, $5)`, hex32(invoice), position, quantity, unitPrice, amount)
		return err
	}
	inTx := func(work func() error) error {
		if _, err := conn.Exec(ctx, "BEGIN"); err != nil {
			t.Fatal(err)
		}
		if err := work(); err != nil {
			_, _ = conn.Exec(ctx, "ROLLBACK")
			return err
		}
		_, err := conn.Exec(ctx, "COMMIT")
		return err
	}

	must(t, inTx(func() error {
		if err := insertInvoice(conn, profile, 1, hex20(100), "key-1", "5000000"); err != nil {
			return err
		}
		if err := line(1, 1, "7.50", "500000", "3750000"); err != nil {
			return err
		}
		return line(1, 2, "1", "1250000", "1250000")
	}))
	_, err := conn.Exec(ctx, "UPDATE invoice_lines SET description = 'Other' WHERE invoice_id = $1", hex32(1))
	wantCode(t, err, codeRaise, "a changed line")
	wantCode(t, line(1, 3, "1", "0", "0"), codeRaise, "a line added to an issued invoice")
	_, err = conn.Exec(ctx, "DELETE FROM invoice_lines WHERE invoice_id = $1 AND position = 2", hex32(1))
	wantCode(t, err, codeRaise, "a removed line")
	// Replication (session_replication_role = replica) skips ordinary triggers, not these.
	_, err = conn.Exec(ctx, `SET session_replication_role = replica;
		UPDATE invoice_lines SET description = 'Other' WHERE invoice_id = '`+hex32(1)+`'`)
	_, _ = conn.Exec(ctx, "SET session_replication_role = DEFAULT")
	wantCode(t, err, codeRaise, "a changed line under replication")

	wantCode(t, inTx(func() error {
		if err := insertInvoice(conn, profile, 2, hex20(101), "key-2", "5000000"); err != nil {
			return err
		}
		return line(2, 1, "4", "1000000", "4000000")
	}), codeRaise, "lines short of the amount")
	wantCode(t, inTx(func() error {
		if err := insertInvoice(conn, profile, 3, hex20(102), "key-3", "5000000"); err != nil {
			return err
		}
		return line(3, 1, "2", "2500000", "5000001")
	}), codeCheck, "a line amount that is not quantity times unit price")
}
