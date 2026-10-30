package tests

import (
	"bytes"
	"compress/zlib"
	"context"
	"encoding/json"
	"io"
	"math/big"
	"net/http"
	"reflect"
	"strings"
	"testing"
	"time"
	"unicode/utf16"

	"github.com/forwend/forwend/apps/backend/internal/invoice"
	"github.com/forwend/forwend/apps/backend/internal/ledger"
)

func TestInvoiceDepositPreviewKeepsExactTotalsAndReceipt(t *testing.T) {
	e := invoiceAPI(t)
	const owner = "did:privy:alice"
	made := e.post(t, owner, e.aliceProfile, "deposit-preview", `{"chainId":84532,"token":"`+usdc+`","amount":"105000000"}`)
	if made.status != http.StatusCreated {
		t.Fatalf("create: %d %v", made.status, made.body)
	}
	id := made.body["invoiceId"].(string)
	expires, _ := time.Parse(time.RFC3339, made.body["expiresAt"].(string))
	at := expires.Unix() - 100
	e.exec(t, `UPDATE chain_cursors SET last_scanned_block=200,last_finalized_block=200,
		last_finalized_time=$1 WHERE chain_id=84532`, at)
	e.exec(t, `INSERT INTO chain_transfers (chain_id,chain_family,token_contract,invoice_id,tx_hash,log_index,
		block_hash,block_number,block_time,from_address,to_address,amount,status)
		SELECT i.chain_id,i.chain_family,i.token_contract,i.id,'0x'||lpad(to_hex(n),64,'0'),0,
		'0x'||lpad(to_hex(n),64,'0'),n,$2,$3,i.receive_address,1000000,'confirmed'
		FROM invoices i CROSS JOIN generate_series(1,105) n WHERE i.id=$1`, id, at, aliceWallet)
	balances := func(context.Context, uint64, string, string) (*big.Int, uint64, error) {
		return big.NewInt(105000000), 200, nil
	}
	notDeployed := func(context.Context, uint64, string, string) (uint64, error) { return 0, nil }
	for range 2 {
		if err := ledger.NewService(e.pool, balances, notDeployed).Process(t.Context(), id); err != nil {
			t.Fatal(err)
		}
	}
	e.exec(t, `INSERT INTO chain_transfers (chain_id,chain_family,token_contract,invoice_id,tx_hash,log_index,
		block_hash,block_number,block_time,from_address,to_address,amount,status)
		SELECT i.chain_id,i.chain_family,i.token_contract,i.id,'0x'||lpad(to_hex(n),64,'0'),0,
		'0x'||lpad(to_hex(n),64,'0'),n,CASE n WHEN 107 THEN i.closes_at+1 ELSE $2 END,$3,
		i.receive_address,(n-104)*1000000,CASE n WHEN 106 THEN 'detected' WHEN 107 THEN 'confirmed' ELSE 'reorged' END
		FROM invoices i CROSS JOIN generate_series(106,108) n WHERE i.id=$1`, id, at, aliceWallet)
	want := map[string]any{"count": float64(107), "onTimeAmount": "107000000", "lateAmount": "3000000", "pendingAmount": "2000000"}
	ownerPath := "/v1/profiles/" + e.aliceProfile + "/invoices/" + id
	for _, path := range []string{"/v1/invoices/" + e.link(t, id), ownerPath, ownerPath + "?view=summary"} {
		r := e.call(t, "GET", path, owner, "", "")
		if r.status != http.StatusOK || r.body["paymentStatus"] != "paid" || r.body["amount"] != "105000000" {
			t.Fatalf("invoice read %s: %d %v", path, r.status, r.body)
		}
		option := r.body["options"].([]any)[0].(map[string]any)
		for _, view := range []map[string]any{r.body, option} {
			if !reflect.DeepEqual(view["depositSummary"], want) {
				t.Fatalf("deposit summary: %v, want %v", view["depositSummary"], want)
			}
			if count := len(view["deposits"].([]any)); count == 0 || count > invoice.DepositPreviewLimit {
				t.Fatalf("deposit preview has %d rows", count)
			}
		}
	}
	receipt := e.pdf(t, id, "receipt.pdf", "")
	if receipt.status != http.StatusOK {
		t.Fatalf("receipt: %d %s", receipt.status, receipt.body)
	}
	text := pdfText(t, receipt.body)
	mustContain(t, text, "Amount paid\n105.00 USDC")
	mustContain(t, strings.Join(strings.Fields(text), " "), "Selected payment transactions are shown", "includes all credited transfers")
	if count := strings.Count(text, "View on Basescan"); count == 0 || count > invoice.DepositPreviewLimit {
		t.Fatalf("receipt preview has %d transactions", count)
	}
}

type pdfReply struct {
	status int
	header http.Header
	body   []byte
}

func (e invoiceEnv) pdf(t *testing.T, id, file, ifNoneMatch string) pdfReply {
	t.Helper()
	req, err := http.NewRequest(http.MethodGet, e.srv.URL+"/v1/invoices/"+e.link(t, id)+"/"+file, nil)
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

// pdfText returns the strings the deflated page streams draw, one per line: (UTF-16BE)Tj with \, ( and ) escaped,
// but Courier text (hashes, IDs) is one byte per character, told apart by being all printable ASCII.
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
			if !bytes.ContainsFunc(s, func(r rune) bool { return r < 0x20 || r > 0x7e }) {
				lines = append(lines, string(s))
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

// D-52.
func TestInvoicePDF(t *testing.T) {
	e := invoiceAPI(t)
	const alice = "did:privy:alice"
	plain := e.post(t, alice, e.aliceProfile, "key-1", basicBody).body["invoiceId"].(string)
	// A request comes from a personal profile, which has no billing details (D-52).
	e.exec(t, `INSERT INTO profile_wallets (profile_id, provider, provider_wallet_id, chain_family, address)
		VALUES ($1, 'privy', 'wallet-3', 'evm', $2)`, e.bobProfile, "0x"+strings.Repeat("b0", 20))
	request := e.post(t, "did:privy:bob", e.bobProfile, "key-0", `{"chainId": 84532, "token": "`+usdc+`",
		"amount": "5000000", "senderName": "Mara Ilić"}`).body["invoiceId"].(string)
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
	link := webURL + "/pay/" + e.link(t, id)
	mustContain(t, text, "Forwend\nInvoice\nINV-0002\nReference PO-4500012345\nTestnet\nTest mode: testnet tokens have no value\n"+
		"Waiting for payment\nAmount due\n5.00 USDC",
		"From\nAlice Design GmbH\nHauptstr. 1\n10115 Berlin\nDE\nTax ID DE123456789\nbilling@alice.example",
		"Billed to\nBob Ltd\nMain St 1\nBerlin\nDE\nTax ID DE999999999",
		"Issued\n"+created.UTC().Format("2 Jan 2006")+"\nSupply date\n31 Oct 2026\nDue date\n1 Nov 2026\nPayment window closes\n"+
			expires.UTC().Format("2 Jan 2006, 15:04")+" UTC",
		"Description\nAmount\nLogo design\n5.00 USDC\nTotal\n5.00 USDC\n"+
			"Agreed value 1,000.50 EUR on 2026-10-01",
		"Invoice INV-0002 · Test mode · Page 1 of 1",
		"Note\nThanks!\nPay within 14 days.",
		"Pay this invoice\nSend exactly 5.00 USDC on Base Sepolia (chain ID 84532).\nUSDC contract "+usdc+
			"\nScan the code or open the link. Send only USDC on Base Sepolia.\n"+webURL+"/pay/",
		"ID "+id)
	mustContain(t, strings.ReplaceAll(text, "\n", ""), link) // wrapped to fit
	if !qrDrawn(t, r.body) {
		t.Fatalf("the invoice has no QR code")
	}
	if strings.Contains(text, "bob@example.com") {
		t.Fatalf("the public PDF shows the client's email:\n%s", text)
	}
	if !bytes.Contains(r.body, []byte("/URI ("+link+")")) {
		t.Fatalf("the pay link is not clickable")
	}

	if again := e.pdf(t, id, "invoice.pdf", ""); !bytes.Equal(again.body, r.body) {
		t.Fatalf("a second render differs")
	}
	if c := e.pdf(t, id, "invoice.pdf", r.header.Get("ETag")); c.status != http.StatusNotModified || len(c.body) != 0 {
		t.Fatalf("If-None-Match: %d, %d bytes", c.status, len(c.body))
	}

	text = pdfText(t, e.pdf(t, plain, "invoice.pdf", "").body)
	mustContain(t, text, "INV-0001", "Description\nAmount\nPayment\n", "on Base Sepolia (chain ID 84532)")
	mustContain(t, strings.ReplaceAll(text, "\n", ""), webURL+"/pay/"+e.link(t, plain))

	mustContain(t, pdfText(t, e.pdf(t, request, "invoice.pdf", "").body),
		"From\n", "Mara Ilić", "Name not checked by Forwend")
	for _, block := range []string{"Billed to\n", "Reference", "Supply date", "Due date", "Agreed value", "Note\n"} {
		if strings.Contains(text, block) {
			t.Fatalf("an invoice without a client or details says %q:\n%s", block, text)
		}
	}
}

// Characters fpdf can't draw, such as the emoji, become "?".
func TestInvoicePDFFitsLongTexts(t *testing.T) {
	e := invoiceAPI(t)
	r := e.post(t, "did:privy:alice", e.aliceProfile, "key-1", `{"chainId": 84532, "token": "`+usdc+`", "amount": "`+
		uint256Max+`", "title": "`+strings.Repeat("é", 200)+`", "note": "`+strings.Repeat("n\\n", 1000)+`", "client": {"name": "Bob 🙂`+
		strings.Repeat("c", 190)+`", "address": "`+strings.Repeat("a\\n", 250)+`"}}`)
	if r.status != http.StatusCreated {
		t.Fatalf("create: %d %v", r.status, r.body)
	}
	pdf := e.pdf(t, r.body["invoiceId"].(string), "invoice.pdf", "")
	if pdf.status != http.StatusOK {
		t.Fatalf("got %d %s", pdf.status, pdf.body)
	}
	text := pdfText(t, pdf.body)
	mustContain(t, text, "ééé…", "Bob\n?ccc", "a\na\na\na\na\na\na\na…", "n\nn\nn…")
	// An amount too wide for its column wraps inside it and is never cut.
	full := "115,792,089,237,316,195,423,570,985,008,687,907,853,269,984,665,640,564,039,457,584,007,913,129.639935USDC"
	// The first is the figure under the status, before the From block; the second the totals' last row.
	mustContain(t, strings.NewReplacer("\n", "", " ", "").Replace(text), "Amountdue"+full+"From", "Total"+full+"Note")
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

// R-61: the receipt never mentions the settlement, so settling leaves it unchanged.
func TestReceiptPDF(t *testing.T) {
	e := invoiceAPI(t)
	ctx := context.Background()
	made := e.post(t, "did:privy:alice", e.aliceProfile, "key-1",
		`{"chainId": 84532, "token": "`+usdc+`", "amount": "2000000", "supplyDate": "2026-10-01", "reference": "PO-7",
		"agreedValue": {"currency": "JPY", "amount": "300", "date": "2026-10-01"}}`).body
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
	if _, err := e.pool.Exec(ctx, `UPDATE chain_cursors SET last_scanned_block = 100, last_finalized_block = 100,
		last_finalized_time = $1 WHERE chain_id = 84532`, paidAt.Unix()); err != nil {
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
		notDeployed := func(context.Context, uint64, string, string) (uint64, error) { return 0, nil }
		if err := ledger.NewService(e.pool, balances, notDeployed).Process(ctx, id); err != nil {
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
	link := webURL + "/pay/" + e.link(t, id)
	stamp := func(at time.Time) string { return at.UTC().Format("2 Jan 2006, 15:04") + " UTC" }
	text := pdfText(t, r.body)
	row := func(at time.Time) string { return at.UTC().Format("2 Jan 2006, 15:04") }
	mustContain(t, text, "Forwend\nReceipt\nINV-0001\nReference PO-7\nTestnet\nTest mode: testnet tokens have no value\n"+
		"Paid\nAmount paid\n2.00 USDC", "Supply date\n1 Oct 2026\nPaid\n"+stamp(paidAt),
		"Payment\n2.00 USDC\nTotal\n2.00 USDC\nAgreed value 300 JPY on 2026-10-01",
		// Each transfer applied whole: no Applied column and no totals; the panel and Total already say 2.00 USDC.
		"Payments received\nDate (UTC)\nNetwork\nAmount\n"+row(paidAt.Add(-time.Minute))+"\nBase Sepolia\n1.50 USDC\n"+
			first+"\nView on Basescan\n"+row(paidAt)+"\nBase Sepolia\n0.50 USDC\n"+second+"\nView on Basescan\n"+
			"Check this receipt\nA PDF can be edited.")
	if strings.Count(text, stamp(paidAt)) != 1 || strings.Contains(text, "Applied") || strings.Contains(text, "\nReceived\n") {
		t.Fatalf("the receipt repeats the paid date or applied amounts:\n%s", text)
	}
	mustContain(t, strings.ReplaceAll(text, "\n", ""), link)
	if strings.Contains(strings.ToLower(text), "settle") {
		t.Fatalf("the receipt mentions the settlement:\n%s", text)
	}
	if !bytes.Contains(r.body, []byte("/URI (https://sepolia.basescan.org/tx/"+first+")")) || !qrDrawn(t, r.body) {
		t.Fatalf("the receipt's explorer link or QR code is missing")
	}

	paid := paidAt.Format(time.RFC3339)
	times("paid", paid, nil)

	// As the signer confirms it: the ledger, the intent and the invoice in one transaction.
	settled := "0x" + strings.Repeat("0b", 32)
	tx, err := e.pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `WITH movement AS (INSERT INTO ledger_transactions (invoice_id,kind) VALUES ($1,'settlement') RETURNING id)
        INSERT INTO ledger_entries (transaction_id,account,amount) SELECT id,'receiver',-2000000 FROM movement
        UNION ALL SELECT id,'recipient_payable',2000000 FROM movement`, id); err != nil {
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
	e.exec(t, `INSERT INTO receiver_outflows (invoice_id,chain_id,receiver_address,token_contract,kind,destination,amount,
        tx_hash,log_index,block_hash,block_number,block_time,verified_block,transfer_log_index,ledger_transaction_id,reconciliation_error)
        SELECT i.id,i.chain_id,i.receive_address,i.token_contract,'settlement',i.recipient_address,i.amount,
        $2,1,$2,100,$3,100,0,t.id,'' FROM invoices i JOIN ledger_transactions t ON t.invoice_id = i.id AND t.kind = 'settlement'
        WHERE i.id = $1`, id, settled, settledAt.Unix())
	times("settled", paid, time.Unix(settledAt.Unix(), 0).UTC().Format(time.RFC3339))
	if after := e.pdf(t, id, "receipt.pdf", r.header.Get("ETag")); after.status != http.StatusNotModified {
		t.Fatalf("settled, with the paid receipt's ETag: %d", after.status)
	}
	// R-179: a paid invoice says so and asks for no more money.
	paidInvoice := e.pdf(t, id, "invoice.pdf", "").body
	if text := pdfText(t, paidInvoice); !strings.Contains(text, "Paid\nAmount paid") ||
		!strings.Contains(text, "Paid\n"+stamp(paidAt)) || strings.Contains(text, "Pay this invoice") ||
		strings.Contains(strings.ReplaceAll(text, "\n", ""), link) || qrDrawn(t, paidInvoice) {
		t.Fatalf("the paid invoice still asks for payment:\n%s", text)
	}

	// A deposit after the checkout closed is held for the payer (D-26): the receipt lists it, never as paid.
	late := "0x" + strings.Repeat("0c", 32)
	if _, err := e.pool.Exec(ctx, `INSERT INTO chain_transfers (chain_id, chain_family, token_contract, invoice_id,
		tx_hash, log_index, block_hash, block_number, block_time, from_address, to_address, amount, status)
		VALUES (84532, 'evm', $1, $2, $3, 0, $3, 110, $4, $5, $5, 700000, 'confirmed')`,
		usdc, id, late, expires.Unix()+60, receive); err != nil {
		t.Fatal(err)
	}
	if text := pdfText(t, e.pdf(t, id, "receipt.pdf", "").body); !strings.Contains(text, "0.70 USDC\nPending\n"+late) ||
		!strings.Contains(text, "Amount paid\n2.00 USDC") || !strings.Contains(text, "Applied to this invoice\n2.00 USDC") {
		t.Fatalf("the receipt must list the late deposit %s without counting it as paid:\n%s", late, text)
	}
}

// qrDrawn tells whether a page draws the many filled module runs a QR code is made of.
func qrDrawn(t *testing.T, pdf []byte) bool {
	t.Helper()
	for rest := pdf; ; {
		start := bytes.Index(rest, []byte("stream\n"))
		if start < 0 {
			return false
		}
		rest = rest[start+len("stream\n"):]
		end := bytes.Index(rest, []byte("\nendstream"))
		zr, err := zlib.NewReader(bytes.NewReader(rest[:end]))
		rest = rest[end+len("\nendstream"):]
		if err != nil {
			continue
		}
		content, _ := io.ReadAll(zr)
		if bytes.Count(content, []byte(" re f")) > 200 {
			return true
		}
	}
}

// R-88.
func TestInvoicePDFLines(t *testing.T) {
	e := invoiceAPI(t)
	made := e.post(t, "did:privy:alice", e.aliceProfile, "key-1", `{"chainId": 84532, "token": "`+usdc+`",
		"amount": "5000000", "title": "Website", "lines": [
		{"description": "Design", "quantity": "7.5", "unitPrice": "500000"},
		{"description": "Hosting", "quantity": "1", "unitPrice": "1250000"}]}`).body
	r := e.pdf(t, made["invoiceId"].(string), "invoice.pdf", "")
	mustContain(t, pdfText(t, r.body), "Website\nDescription\nQty\nUnit price\nAmount\nDesign\n7.5\n0.50 USDC\n3.75 USDC\n"+
		"Hosting\n1\n1.25 USDC\n1.25 USDC\nTotal\n5.00 USDC\n")

	// The longest description the API takes prints whole, even in its widest letters.
	long := strings.Repeat("WWWWWWWWWWWWW ", 15)[:200]
	made = e.post(t, "did:privy:alice", e.aliceProfile, "key-2", `{"chainId": 84532, "token": "`+usdc+`",
		"amount": "5000000", "lines": [{"description": "`+long+`", "quantity": "1", "unitPrice": "5000000"}]}`).body
	if text := pdfText(t, e.pdf(t, made["invoiceId"].(string), "invoice.pdf", "").body); strings.Contains(text, "…") ||
		!strings.Contains(strings.ReplaceAll(text, "\n", " "), long) {
		t.Fatalf("a 200-character description is cut:\n%s", text)
	}
}

// R-143, D-87: an invoice is in its chain's mode; a test-mode one says so on every read and PDF.
func TestInvoiceModeFollowsItsChain(t *testing.T) {
	e := invoiceAPI(t)
	id := e.post(t, "did:privy:alice", e.aliceProfile, "key-1", basicBody).body["invoiceId"].(string)
	owner := "/v1/profiles/" + e.aliceProfile + "/invoices/"
	for _, live := range []bool{false, true} {
		e.exec(t, "UPDATE chains SET livemode = $1 WHERE chain_id = 84532", live)
		read := e.get(t, id)
		listed, _ := e.call(t, "GET", strings.TrimSuffix(owner, "/"), "did:privy:alice", "", "").body["items"].([]any)
		marked := strings.Contains(pdfText(t, e.pdf(t, id, "invoice.pdf", "").body), "Test mode: testnet tokens have no value")
		if read.body["livemode"] != live || e.call(t, "GET", owner+id, "did:privy:alice", "", "").body["livemode"] != live ||
			len(listed) != 1 || listed[0].(map[string]any)["livemode"] != live || marked == live {
			t.Errorf("livemode %v: payer %v, list %v, PDF marked %v", live, read.body["livemode"], listed, marked)
		}
	}
}
