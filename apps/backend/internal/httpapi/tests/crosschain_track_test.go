package tests

import (
	"context"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/forwend/forwend/apps/backend/internal/intents"
	"github.com/forwend/forwend/apps/backend/internal/intents/intentstest"
	"github.com/forwend/forwend/apps/backend/internal/invoice"
)

const originTx = "4d1b2c3a9f8e7d6c5b4a39281706f5e4d3c2b1a09f8e7d6c5b4a39281706f5e4"

// tracked is a live invoice with a cross-chain quote from Tron USDT, and the worker's service that reads its status.
func tracked(t *testing.T) (invoiceEnv, *intentstest.Fake, *invoice.Service, string, map[string]any) {
	t.Helper()
	e, fake := crossChainEnv(t)
	worker := invoice.NewService(e.pool)
	worker.SetCrossChain(fake.Client())
	pay, _ := liveInvoice(t, e, "key-1", 86400)
	r := e.call(t, "POST", crossPath+pay+"/crosschain/quotes", "", "", `{"originAsset": "`+tronUSDT+`", "refundTo": "`+refundTo+`"}`)
	if r.status != http.StatusCreated {
		t.Fatalf("quote: %d %v", r.status, r.body)
	}
	return e, fake, worker, pay, r.body
}

// checkAt runs the worker's round as if at, and returns the quote's next check (nil for none).
func checkAt(t *testing.T, e invoiceEnv, worker *invoice.Service, quote string, at time.Time) *time.Time {
	t.Helper()
	if err := worker.TrackCrossChain(context.Background(), at); err != nil {
		t.Fatal(err)
	}
	var next *time.Time
	if err := e.pool.QueryRow(context.Background(), "SELECT next_check_at FROM crosschain_quotes WHERE id = $1", quote).Scan(&next); err != nil {
		t.Fatal(err)
	}
	return next
}

func historyKinds(t *testing.T, e invoiceEnv, pay string) map[string]map[string]any {
	t.Helper()
	main := e.get(t, pay).body["invoiceId"].(string)
	r := e.call(t, "GET", "/v1/profiles/"+e.aliceProfile+"/invoices/"+main, "did:privy:alice", "", "")
	kinds := map[string]map[string]any{}
	for _, h := range r.body["history"].([]any) {
		event := h.(map[string]any)
		kinds[event["kind"].(string)] = event
	}
	return kinds
}

func TestWorkerFollowsAQuoteFromDepositToConversion(t *testing.T) {
	e, fake, worker, pay, quote := tracked(t)
	id, address := quote["quoteId"].(string), quote["depositAddress"].(string)
	start := time.Now()

	// Waiting in its price window: every 30 s.
	if next := checkAt(t, e, worker, id, start); next == nil || next.Sub(start) != 30*time.Second {
		t.Fatalf("waiting: next %v", next)
	}
	// 1Click saw the deposit: every 10 s, a history row, and the pick, an edit and a cancel wait.
	fake.SetStatus(address, intents.KnownDepositTx, map[string]any{"depositedAmount": "101120000",
		"originChainTxHashes":      []any{map[string]any{"hash": originTx, "explorerUrl": "https://tronscan.org/#/transaction/" + originTx}},
		"destinationChainTxHashes": []any{}, "refundedAmount": "0"})
	at := start.Add(time.Minute)
	if next := checkAt(t, e, worker, id, at); next == nil || next.Sub(at) != 10*time.Second {
		t.Fatalf("converting: next %v", next)
	}
	// History's txHash is a Base transaction: Tron's own is in crossChain only, so every reader can read the row.
	seen := historyKinds(t, e, pay)["crosschain.deposit_seen"]
	if seen == nil || seen["asset"] != tronUSDT || seen["amount"] != "101120000" || seen["txHash"] != nil {
		t.Fatalf("deposit history %v", seen)
	}
	options := e.get(t, pay).body["options"].([]any)
	arbitrum := options[0].(map[string]any)["optionId"].(string)
	main := e.get(t, pay).body["invoiceId"].(string)
	if r := e.call(t, "PUT", "/v1/profiles/"+e.aliceProfile+"/invoices/"+main+"/details", "did:privy:alice", "",
		`{"reference": "PO-9", "note": "Changed"}`); r.status != http.StatusConflict || errorCode(r) != "invoice_not_editable" {
		t.Fatalf("edit while converting: %d %v", r.status, r.body)
	}
	if r := e.call(t, "PUT", crossPath+pay+"/pick", "", "", `{"optionId": "`+arbitrum+`"}`); r.status != http.StatusConflict ||
		errorCode(r) != "pick_locked" {
		t.Fatalf("pick while converting: %d %v", r.status, r.body)
	}
	if r := e.call(t, "POST", "/v1/profiles/"+e.aliceProfile+"/invoices/"+main+"/cancel", "did:privy:alice", "", ""); r.status == http.StatusOK {
		t.Fatalf("canceled while converting: %v", r.body)
	}
	if r := e.call(t, "POST", crossPath+pay+"/crosschain/quotes", "", "", `{"originAsset": "`+ethAsset+`", "refundTo": "0x6fd1c6b3f0b7a5b4e5d6a3c2b1a0f9e8d7c6b5a4"}`); r.status != http.StatusConflict {
		t.Fatalf("second quote while converting: %d %v", r.status, r.body)
	}

	// Converted: the Base transaction, then every 2 minutes for an hour for a refund of the unused slippage.
	baseTx := "0x" + originTx
	fake.SetStatus(address, intents.Success, map[string]any{"depositedAmount": "101120000", "amountOut": "100000000",
		"originChainTxHashes":      []any{map[string]any{"hash": originTx, "explorerUrl": "https://tronscan.org/#/transaction/" + originTx}},
		"destinationChainTxHashes": []any{map[string]any{"hash": baseTx, "explorerUrl": "javascript:alert(1)"}}, "refundedAmount": "0"})
	at = start.Add(2 * time.Minute)
	if next := checkAt(t, e, worker, id, at); next == nil || next.Sub(at) != 2*time.Minute {
		t.Fatalf("converted: next %v", next)
	}
	if converted := historyKinds(t, e, pay)["crosschain.converted"]; converted == nil || converted["txHash"] != baseTx ||
		converted["amount"] != "100000000" {
		t.Fatalf("converted history %v", converted)
	}
	fake.SetStatus(address, intents.Success, map[string]any{"depositedAmount": "101120000", "amountOut": "100000000",
		"originChainTxHashes":      []any{map[string]any{"hash": originTx, "explorerUrl": "https://tronscan.org/#/transaction/" + originTx}},
		"destinationChainTxHashes": []any{map[string]any{"hash": baseTx}}, "refundedAmount": "1000000",
		"refundReason": "SLIPPAGE_SURPLUS"})
	at = start.Add(10 * time.Minute)
	checkAt(t, e, worker, id, at)
	if refunded := historyKinds(t, e, pay)["crosschain.refunded"]; refunded == nil || refunded["amount"] != "1000000" ||
		refunded["asset"] != tronUSDT {
		t.Fatalf("refund history %v", refunded)
	}
	// The same status again writes nothing: each event is in the history once.
	checkAt(t, e, worker, id, start.Add(20*time.Minute))
	var rows map[string]int
	rows = map[string]int{}
	counted, err := e.pool.Query(context.Background(), `SELECT kind, count(*) FROM history_events
		WHERE invoice_id = $1 AND kind LIKE 'crosschain.%' GROUP BY kind`, main)
	if err != nil {
		t.Fatal(err)
	}
	for counted.Next() {
		var kind string
		var n int
		if err := counted.Scan(&kind, &n); err != nil {
			t.Fatal(err)
		}
		rows[kind] = n
	}
	counted.Close()
	if rows["crosschain.deposit_seen"] != 1 || rows["crosschain.converted"] != 1 || rows["crosschain.refunded"] != 1 {
		t.Fatalf("history rows %v, want each once", rows)
	}
	if next := checkAt(t, e, worker, id, start.Add(2*time.Hour+time.Minute)); next != nil {
		t.Fatalf("an hour after the conversion: next %v", next)
	}

	// The USDC arrives on Base in 1Click's transaction: the payment's movements name what the payer sent.
	options = e.get(t, pay).body["options"].([]any)
	var base string
	for _, o := range options {
		if option := o.(map[string]any); option["chainId"] == float64(intents.BaseChainID) {
			base = option["optionId"].(string)
		}
	}
	baseTransfer(t, e, main, base, baseTx, "100000000")
	movements := e.call(t, "GET", "/v1/profiles/"+e.aliceProfile+"/payments/"+main+"/movements", "did:privy:alice", "", "")
	var paidWith map[string]any
	for _, m := range movements.body["items"].([]any) {
		if p, ok := m.(map[string]any)["paidWith"].(map[string]any); ok {
			paidWith = p
		}
	}
	if paidWith == nil || paidWith["symbol"] != "USDT" || paidWith["blockchain"] != "tron" ||
		paidWith["amount"] != "101120000" || paidWith["txHash"] != originTx || paidWith["decimals"] != float64(6) {
		t.Fatalf("movements: %d %v", movements.status, movements.body)
	}
	csv := e.call(t, "GET", "/v1/profiles/"+e.aliceProfile+"/payments/"+main+"/movements.csv", "did:privy:alice", "", "")
	if !strings.Contains(csv.raw, "Paid with,Paid with transaction") ||
		!strings.Contains(csv.raw, "101.120000 USDT on tron through NEAR Intents,"+originTx) {
		t.Fatalf("csv: %d %s", csv.status, csv.raw)
	}

	// Every reader carries it: the pay page, the owner, the payment.
	for name, r := range map[string]reply{
		"public":  e.get(t, pay),
		"owner":   e.call(t, "GET", "/v1/profiles/"+e.aliceProfile+"/invoices/"+main, "did:privy:alice", "", ""),
		"payment": e.call(t, "GET", "/v1/profiles/"+e.aliceProfile+"/payments/"+main, "did:privy:alice", "", ""),
	} {
		c, _ := r.body["crossChain"].(map[string]any)
		if p, ok := r.body["payment"].(map[string]any); ok {
			c, _ = p["crossChain"].(map[string]any)
		}
		if c == nil || c["provider"] != "near_intents" || c["status"] != "SUCCESS" || c["symbol"] != "USDT" ||
			c["blockchain"] != "tron" || c["deposited"] != "101120000" || c["delivered"] != "100000000" ||
			c["refunded"] != "1000000" || c["refundReason"] != "SLIPPAGE_SURPLUS" || c["quoteId"] != id ||
			c["depositSeenAt"] == nil || c["convertedAt"] == nil {
			t.Fatalf("%s crossChain %v", name, c)
		}
		origin := c["originTxs"].([]any)[0].(map[string]any)
		destination := c["destinationTxs"].([]any)[0].(map[string]any)
		// An explorer link that isn't https never reaches a page.
		if origin["hash"] != originTx || origin["explorerUrl"] != "https://tronscan.org/#/transaction/"+originTx ||
			destination["hash"] != baseTx || destination["explorerUrl"] != "" {
			t.Fatalf("%s transactions %v %v", name, origin, destination)
		}
	}
}

func TestWorkerStopsAQuoteNobodyPaidAndRecordsAFailure(t *testing.T) {
	e, _, worker, _, quote := tracked(t)
	id := quote["quoteId"].(string)
	shown, _ := time.Parse(time.RFC3339, quote["shownUntil"].(string))
	deadline, _ := time.Parse(time.RFC3339, quote["deadline"].(string))
	// After the price window every 2 minutes, still 30 minutes past the deadline, then none from an hour past it.
	for _, at := range []time.Time{shown.Add(time.Second), deadline.Add(30 * time.Minute)} {
		if next := checkAt(t, e, worker, id, at); next == nil || next.Sub(at) != 2*time.Minute {
			t.Fatalf("at %s: next %v", at, next)
		}
	}
	if next := checkAt(t, e, worker, id, deadline.Add(time.Hour+time.Second)); next != nil {
		t.Fatalf("an hour past the deadline: next %v", next)
	}

	// Another invoice whose swap fails: one history row, and the worker stops.
	e2, fake2, worker2, pay2, quote2 := tracked(t)
	fake2.SetStatus(quote2["depositAddress"].(string), intents.Failed, map[string]any{"depositedAmount": "101120000",
		"originChainTxHashes": []any{}, "destinationChainTxHashes": []any{}, "refundedAmount": "0"})
	if next := checkAt(t, e2, worker2, quote2["quoteId"].(string), time.Now()); next != nil {
		t.Fatalf("failed: next %v", next)
	}
	kinds := historyKinds(t, e2, pay2)
	if kinds["crosschain.failed"] == nil || kinds["crosschain.deposit_seen"] == nil {
		t.Fatalf("failed history %v", kinds)
	}
	if got := e2.get(t, pay2).body["crossChain"].(map[string]any)["status"]; got != "FAILED" {
		t.Fatalf("status %v", got)
	}

	// 1Click down: the quote is read again a minute later, until it would have ended anyway.
	e3, fake3, worker3, _, quote3 := tracked(t)
	fake3.Down = true
	now := time.Now()
	if next := checkAt(t, e3, worker3, quote3["quoteId"].(string), now); next == nil || next.Sub(now) != time.Minute {
		t.Fatalf("down: next %v", next)
	}
	deadline3, _ := time.Parse(time.RFC3339, quote3["deadline"].(string))
	if next := checkAt(t, e3, worker3, quote3["quoteId"].(string), deadline3.Add(time.Hour+time.Second)); next != nil {
		t.Fatalf("down past the end: next %v", next)
	}
}

// A seen deposit is read until it ends, past its deadline too; a refund 1Click names no amount for still has its row.
func TestWorkerReadsASeenDepositUntilItEnds(t *testing.T) {
	e, fake, worker, pay, quote := tracked(t)
	id, address := quote["quoteId"].(string), quote["depositAddress"].(string)
	deadline, _ := time.Parse(time.RFC3339, quote["deadline"].(string))
	short := map[string]any{"depositedAmount": "50000000", "originChainTxHashes": []any{}, "destinationChainTxHashes": []any{}}
	fake.SetStatus(address, intents.IncompleteDeposit, short)
	at := deadline.Add(2 * time.Hour)
	if next := checkAt(t, e, worker, id, at); next == nil || next.Sub(at) != 2*time.Minute {
		t.Fatalf("incomplete past the deadline: next %v", next)
	}
	fake.SetStatus(address, intents.Refunded, short)
	if next := checkAt(t, e, worker, id, at.Add(3*time.Minute)); next != nil {
		t.Fatalf("refunded: next %v", next)
	}
	if refunded, ok := historyKinds(t, e, pay)["crosschain.refunded"]; !ok || refunded["amount"] != nil || refunded["asset"] != tronUSDT {
		t.Fatalf("refund history %v", refunded)
	}
}

// The pick the payer last made moves to the Base option once 1Click saw their deposit (R-233).
func TestSeenDepositPicksTheBaseOption(t *testing.T) {
	e, fake, worker, pay, quote := tracked(t)
	var arbitrum, base string
	for _, o := range e.get(t, pay).body["options"].([]any) {
		option := o.(map[string]any)
		if option["chainId"] == float64(intents.BaseChainID) {
			base = option["optionId"].(string)
		} else {
			arbitrum = option["optionId"].(string)
		}
	}
	if r := e.call(t, "PUT", crossPath+pay+"/pick", "", "", `{"optionId": "`+arbitrum+`"}`); r.status != http.StatusNoContent {
		t.Fatalf("pick: %d %v", r.status, r.body)
	}
	fake.SetStatus(quote["depositAddress"].(string), intents.Processing, map[string]any{"depositedAmount": "101120000",
		"originChainTxHashes": []any{}, "destinationChainTxHashes": []any{}})
	checkAt(t, e, worker, quote["quoteId"].(string), time.Now())
	if got := e.get(t, pay).body["pickedOptionId"]; got != base {
		t.Fatalf("picked %v, want the Base option %s", got, base)
	}
}
