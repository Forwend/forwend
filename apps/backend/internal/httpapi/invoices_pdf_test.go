package httpapi

import (
	"bytes"
	"compress/zlib"
	"context"
	"encoding/json"
	"io"
	"math/big"
	"net/http"
	"strings"
	"testing"
	"time"
	"unicode/utf16"

	"github.com/ensp1re/forwend/apps/backend/internal/ledger"
)

type pdfReply struct {
	status int
	header http.Header
	body   []byte
}

func (e invoiceEnv) pdf(t *testing.T, id, file, ifNoneMatch string) pdfReply {
	t.Helper()
	req, err := http.NewRequest(http.MethodGet, e.srv.URL+"/v1/invoices/"+id+"/"+file, nil)
	if err != nil {
		t.Fatal(err)
	}
	if ifNoneMatch != "" {
		req.Header.Set("If-None-Match", ifNoneMatch)
	}
	res, err := e.srv.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	body, err := io.ReadAll(res.Body)
	if err != nil {
		t.Fatal(err)
	}
	return pdfReply{res.StatusCode, res.Header, body}
}

func (r pdfReply) errorCode() string {
	var v struct{ Error struct{ Code string } }
	_ = json.Unmarshal(r.body, &v)
	return v.Error.Code
}

// pdfText returns the strings the PDF's page streams draw, one per line. fpdf deflates each stream and writes text as
// (UTF-16BE)Tj with \, ( and ) escaped and \r as \r.
func pdfText(t *testing.T, pdf []byte) string {
	t.Helper()
	var lines []string
	for rest := pdf; ; {
		start := bytes.Index(rest, []byte("stream\n"))
		if start < 0 {
			break
		}
		rest = rest[start+len("stream\n"):]
		end := bytes.Index(rest, []byte("\nendstream"))
		stream := rest[:end]
		rest = rest[end+len("\nendstream"):]
		zr, err := zlib.NewReader(bytes.NewReader(stream))
		if err != nil {
			continue
		}
		content, err := io.ReadAll(zr)
		if err != nil || !bytes.Contains(content, []byte("BT ")) {
			continue
		}
		for i := 0; i < len(content); i++ {
			if content[i] != '(' {
				continue
			}
			var s []byte
			for i++; content[i] != ')'; i++ {
				if content[i] == '\\' {
					i++
					if content[i] == 'r' {
						content[i] = '\r'
					}
				}
				s = append(s, content[i])
			}
			if !bytes.HasPrefix(content[i+1:], []byte("Tj")) {
				continue
			}
			units := make([]uint16, len(s)/2)
			for j := range units {
				units[j] = uint16(s[2*j])<<8 | uint16(s[2*j+1])
			}
			lines = append(lines, string(utf16.Decode(units)))
		}
	}
	if len(lines) == 0 {
		t.Fatalf("no text in the PDF")
	}
	return strings.Join(lines, "\n")
}

func mustContain(t *testing.T, text string, want ...string) {
	t.Helper()
	for _, w := range want {
		if !strings.Contains(text, w) {
			t.Fatalf("the PDF does not say %q; it says:\n%s", w, text)
		}
	}
}

// The invoice PDF is public and says who bills whom from the invoice's copies, the exact amount, network, due date and
// pay link, never the client's email. Without billing details it has no issuer block.
func TestInvoicePDF(t *testing.T) {
	e := invoiceAPI(t)
	const alice = "did:privy:alice"
	plain := e.post(t, alice, e.aliceProfile, "key-1", basicBody).body["invoiceId"].(string)
	if r := e.call(t, "PUT", "/v1/profiles/"+e.aliceProfile+"/billing-details", alice, "", billingBody); r.status != http.StatusOK {
		t.Fatalf("PUT billing details: %d %v", r.status, r.body)
	}
	made := e.post(t, alice, e.aliceProfile, "key-2", detailsBody).body
	id := made["invoiceId"].(string)
	expires, _ := time.Parse(time.RFC3339, made["expiresAt"].(string))
	created, _ := time.Parse(time.RFC3339, made["createdAt"].(string))

	r := e.pdf(t, id, "invoice.pdf", "")
	if r.status != http.StatusOK || r.header.Get("Content-Type") != "application/pdf" || !bytes.HasPrefix(r.body, []byte("%PDF-")) {
		t.Fatalf("got %d %s %.40q", r.status, r.header.Get("Content-Type"), r.body)
	}
	if got := r.header.Get("Content-Disposition"); got != `attachment; filename="forwend-INV-0002-invoice.pdf"` {
		t.Fatalf("Content-Disposition %q", got)
	}
	if r.header.Get("Cache-Control") != "private, no-cache" || r.header.Get("ETag") == "" {
		t.Fatalf("Cache-Control %q, ETag %q", r.header.Get("Cache-Control"), r.header.Get("ETag"))
	}
	text := pdfText(t, r.body)
	link := webURL + "/pay/" + id
	mustContain(t, text, "Invoice", "INV-0002", "Logo design",
		"FROM", "Alice Design GmbH", "Hauptstr. 1\n10115 Berlin", "DE", "Tax ID DE123456789", "billing@alice.example",
		"BILL TO", "Bob Ltd", "Main St 1\nBerlin",
		"Amount\n5.00 USDC", "Network\nbase-sepolia (chain 84532)", "Due date\n2026-11-01",
		"Checkout closes\n"+expires.Format("2006-01-02 15:04")+" UTC", "Issued\n"+created.Format("2006-01-02 15:04")+" UTC",
		"Thanks!\nPay within 14 days.", "Invoice ID\n"+id, link)
	if strings.Contains(text, "bob@example.com") {
		t.Fatalf("the public PDF shows the client's email:\n%s", text)
	}
	if !bytes.Contains(r.body, []byte("/URI ("+link+")")) {
		t.Fatalf("the pay link is not clickable")
	}

	// The same invoice gives the same bytes; the ETag answers 304 while they don't change.
	if again := e.pdf(t, id, "invoice.pdf", ""); !bytes.Equal(again.body, r.body) {
		t.Fatalf("a second render differs")
	}
	if c := e.pdf(t, id, "invoice.pdf", r.header.Get("ETag")); c.status != http.StatusNotModified || len(c.body) != 0 {
		t.Fatalf("If-None-Match: %d, %d bytes", c.status, len(c.body))
	}

	text = pdfText(t, e.pdf(t, plain, "invoice.pdf", "").body)
	mustContain(t, text, "INV-0001", "Amount\n5.00 USDC", webURL+"/pay/"+plain)
	for _, block := range []string{"FROM", "BILL TO", "Due date", "Note"} {
		if strings.Contains(text, block) {
			t.Fatalf("an invoice without billing details or client says %q:\n%s", block, text)
		}
	}
}

// The longest texts are wrapped and cut so the layout holds; characters fpdf can't draw become "?".
func TestInvoicePDFFitsLongTexts(t *testing.T) {
	e := invoiceAPI(t)
	r := e.post(t, "did:privy:alice", e.aliceProfile, "key-1", `{"chainId": 84532, "token": "`+usdc+`", "amount": "`+
		uint256Max+`", "title": "`+strings.Repeat("é", 200)+`", "note": "`+strings.Repeat("n", 2000)+`", "client": {"name": "Bob 🙂`+
		strings.Repeat("c", 190)+`", "address": "`+strings.Repeat("a\\n", 250)+`"}}`)
	if r.status != http.StatusCreated {
		t.Fatalf("create: %d %v", r.status, r.body)
	}
	pdf := e.pdf(t, r.body["invoiceId"].(string), "invoice.pdf", "")
	if pdf.status != http.StatusOK {
		t.Fatalf("got %d %s", pdf.status, pdf.body)
	}
	text := pdfText(t, pdf.body)
	mustContain(t, text, "ééé…", "Bob\n?ccc", "a\na\na\na\na\na\na\na…", "nnn…")
	// A number too wide for its column wraps inside it.
	mustContain(t, strings.ReplaceAll(text, "\n", ""),
		"Amount115792089237316195423570985008687907853269984665640564039457584007913129.639935 USDCNetwork")
}

func TestInvoicePDFNotFound(t *testing.T) {
	e := invoiceAPI(t)
	for _, file := range []string{"invoice.pdf", "receipt.pdf"} {
		for _, id := range []string{"0x" + strings.Repeat("ab", 32), "not-an-id"} {
			if r := e.pdf(t, id, file, ""); r.status != http.StatusNotFound || r.errorCode() != "invoice_not_found" {
				t.Fatalf("%s %s: got %d %s", file, id, r.status, r.body)
			}
		}
	}
}

// The receipt answers 409 until the invoice is paid, then shows the paid time (the block time of the deposit that
// completed it), the deposits' and the settlement's tx hashes. The public GET gives the same paid time and, once
// settled, the time the ledger booked the settlement.
func TestReceiptPDF(t *testing.T) {
	e := invoiceAPI(t)
	ctx := context.Background()
	made := e.post(t, "did:privy:alice", e.aliceProfile, "key-1",
		`{"chainId": 84532, "token": "`+usdc+`", "amount": "2000000"}`).body
	id, receive := made["invoiceId"].(string), made["receiveAddress"].(string)
	expires, _ := time.Parse(time.RFC3339, made["expiresAt"].(string))
	times := func(when string, paid, settled any) {
		t.Helper()
		if b := e.get(t, id).body; b["paidAt"] != paid || b["settledAt"] != settled {
			t.Fatalf("%s: paidAt %v, settledAt %v; want %v, %v", when, b["paidAt"], b["settledAt"], paid, settled)
		}
	}
	notPaid := func(when string) {
		t.Helper()
		if r := e.pdf(t, id, "receipt.pdf", ""); r.status != http.StatusConflict || r.errorCode() != "invoice_not_paid" {
			t.Fatalf("%s: got %d %s", when, r.status, r.body)
		}
		times(when, nil, nil)
	}
	notPaid("open")

	// Two final deposits; the ledger books them and checks the balance (2500000 at block 100) like the worker does.
	first, second := "0x"+strings.Repeat("01", 32), "0x"+strings.Repeat("02", 32)
	paidAt := time.Unix(expires.Unix()-100, 0).UTC()
	if _, err := e.pool.Exec(ctx, `INSERT INTO chain_cursors (chain_id, last_scanned_block, last_finalized_block,
		last_finalized_time) VALUES (84532, 100, 100, $1)`, paidAt.Unix()); err != nil {
		t.Fatal(err)
	}
	deposit := func(hash string, block int64, at time.Time, amount string) {
		t.Helper()
		if _, err := e.pool.Exec(ctx, `INSERT INTO chain_transfers (chain_id, chain_family, token_contract, invoice_id,
			tx_hash, log_index, block_hash, block_number, block_time, from_address, to_address, amount, status)
			VALUES (84532, 'evm', $1, $2, $3, 0, $3, $4, $5, $6, $6, $7, 'confirmed')`,
			usdc, id, hash, block, at.Unix(), receive, amount); err != nil {
			t.Fatal(err)
		}
		balances := func(context.Context, uint64, string, string) (*big.Int, uint64, error) {
			return big.NewInt(2500000), 100, nil
		}
		if err := ledger.NewService(e.pool, balances).Process(ctx, id); err != nil {
			t.Fatal(err)
		}
	}
	deposit(first, 90, paidAt.Add(-time.Minute), "1500000")
	notPaid("partially paid")
	deposit(second, 95, paidAt, "500000")

	r := e.pdf(t, id, "receipt.pdf", "")
	if r.status != http.StatusOK || r.header.Get("Content-Type") != "application/pdf" ||
		r.header.Get("Content-Disposition") != `attachment; filename="forwend-INV-0001-receipt.pdf"` {
		t.Fatalf("paid: %d %v %s", r.status, r.header, r.body)
	}
	link := webURL + "/pay/" + id
	mustContain(t, pdfText(t, r.body), "Receipt", "INV-0001", "Amount paid\n2.00 USDC",
		"Paid\n"+paidAt.Format("2006-01-02 15:04")+" UTC", "Deposits\n"+first+"\n1.50 USDC", second+"\n0.50 USDC",
		"Settlement\nPending", "Check this receipt at\n"+link)

	paid := paidAt.Format(time.RFC3339)
	times("paid", paid, nil)

	// As the signer confirms it: the ledger, the intent and the invoice in one transaction.
	settled := "0x" + strings.Repeat("0b", 32)
	tx, err := e.pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	if err := ledger.BookSettlement(ctx, tx, id, big.NewInt(2000000)); err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(ctx, `
		WITH i AS (UPDATE settlement_intents SET status = 'confirmed', nonce = 0, tx_hash = $2, raw_tx = '\x00'
		           WHERE invoice_id = $1)
		UPDATE invoices SET settlement_status = 'settled' WHERE id = $1`, id, settled); err != nil {
		t.Fatal(err)
	}
	var settledAt time.Time
	if err := tx.QueryRow(ctx, "SELECT now()").Scan(&settledAt); err != nil {
		t.Fatal(err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	times("settled", paid, settledAt.UTC().Format(time.RFC3339))
	after := e.pdf(t, id, "receipt.pdf", r.header.Get("ETag"))
	if after.status != http.StatusOK {
		t.Fatalf("settled, with the paid receipt's ETag: %d", after.status)
	}
	mustContain(t, pdfText(t, after.body), "Settlement\nSettled", "Settlement tx\n"+settled)

	// A deposit after the checkout closed is held for the payer (D-26), so the receipt leaves it out.
	late := "0x" + strings.Repeat("0c", 32)
	if _, err := e.pool.Exec(ctx, `INSERT INTO chain_transfers (chain_id, chain_family, token_contract, invoice_id,
		tx_hash, log_index, block_hash, block_number, block_time, from_address, to_address, amount, status)
		VALUES (84532, 'evm', $1, $2, $3, 0, $3, 110, $4, $5, $5, 700000, 'confirmed')`,
		usdc, id, late, expires.Unix()+60, receive); err != nil {
		t.Fatal(err)
	}
	if text := pdfText(t, e.pdf(t, id, "receipt.pdf", "").body); strings.Contains(text, late) {
		t.Fatalf("the receipt lists the late deposit %s:\n%s", late, text)
	}
}
