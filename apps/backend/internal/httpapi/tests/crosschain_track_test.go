package tests

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"net/http/httptest"
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

// listTagged counts the payments list's rows that carry quote.
func listTagged(t *testing.T, e invoiceEnv, quote string) int {
	t.Helper()
	list := e.call(t, "GET", "/v1/profiles/"+e.aliceProfile+"/payments", "did:privy:alice", "", "")
	tagged := 0
	for _, item := range list.body["items"].([]any) {
		if c, ok := item.(map[string]any)["crossChain"].(map[string]any); ok && c["quoteId"] == quote {
			tagged++
		}
	}
	return tagged
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
	// Postgres keeps microseconds: an exact next check compares equal only to a time at that precision.
	start := time.Now().Truncate(time.Microsecond)

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
	// Nothing is booked yet, so the list already tags it.
	if n := listTagged(t, e, id); n != 1 {
		t.Fatalf("payments list while converting: %d tagged, want 1", n)
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
	baseTransfer(t, e, base, baseTx, "100000000")
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
		!strings.Contains(csv.raw, "101.12 USDT on Tron through NEAR Intents,"+originTx) {
		t.Fatalf("csv: %d %s", csv.status, csv.raw)
	}

	// Paid: the receipt names what the payer paid with, and the payments list tags it (R-239).
	if got := e.get(t, pay).body["paymentStatus"]; got != "paid" {
		t.Fatalf("status %v, want paid", got)
	}
	mustContain(t, strings.Join(strings.Fields(pdfText(t, e.pdf(t, main, "receipt.pdf", "").body)), " "),
		"Paid with", "101.12 USDT on Tron through NEAR Intents")
	if n := listTagged(t, e, id); n != 1 {
		t.Fatalf("payments list: %d tagged, want 1", n)
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
	// After the price window every 5 minutes, still 30 minutes past the deadline; every 30 minutes from an hour past
	// it, while 1Click's address takes deposits (72 hours at the fake); then none.
	for _, at := range []time.Time{shown.Add(time.Second), deadline.Add(30 * time.Minute)} {
		if next := checkAt(t, e, worker, id, at); next == nil || next.Sub(at) != 5*time.Minute {
			t.Fatalf("at %s: next %v", at, next)
		}
	}
	at := deadline.Add(time.Hour + time.Second)
	if next := checkAt(t, e, worker, id, at); next == nil || next.Sub(at) != 30*time.Minute {
		t.Fatalf("an hour past the deadline: next %v", next)
	}
	if next := checkAt(t, e, worker, id, deadline.Add(73*time.Hour)); next != nil {
		t.Fatalf("past the address's deadline: next %v", next)
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

	// 1Click down: the quote is read again a minute later, and hourly past its end: only an answer ends it, as a
	// deposit made meanwhile would go unseen.
	e3, fake3, worker3, pay3, quote3 := tracked(t)
	id3 := quote3["quoteId"].(string)
	fake3.Down = true
	now := time.Now().Truncate(time.Microsecond)
	if next := checkAt(t, e3, worker3, id3, now); next == nil || next.Sub(now) != time.Minute {
		t.Fatalf("down: next %v", next)
	}
	deadline3, _ := time.Parse(time.RFC3339, quote3["deadline"].(string))
	at = deadline3.Add(73 * time.Hour)
	if next := checkAt(t, e3, worker3, id3, at); next == nil || next.Sub(at) != time.Hour {
		t.Fatalf("down past the end: next %v", next)
	}
	// A quote 1Click never answers about, with no deposit seen, is not read for ever.
	e4, fake4, worker4, _, quote4 := tracked(t)
	fake4.Down = true
	deadline4, _ := time.Parse(time.RFC3339, quote4["deadline"].(string))
	if next := checkAt(t, e4, worker4, quote4["quoteId"].(string), deadline4.Add(72*time.Hour+8*24*time.Hour)); next != nil {
		t.Fatalf("unread a week past the address deadline: next %v", next)
	}
	fake3.Down = false
	fake3.SetStatus(quote3["depositAddress"].(string), intents.Failed, map[string]any{"depositedAmount": "101120000",
		"originChainTxHashes": []any{}, "destinationChainTxHashes": []any{}, "refundedAmount": "0"})
	if next := checkAt(t, e3, worker3, id3, at.Add(time.Hour)); next != nil {
		t.Fatalf("failed after the outage: next %v", next)
	}
	if kinds := historyKinds(t, e3, pay3); kinds["crosschain.failed"] == nil || kinds["crosschain.deposit_seen"] == nil {
		t.Fatalf("history after the outage %v", kinds)
	}
}

// 1Click's address takes deposits until its own deadline, days past the one the quote asked for: a slow deposit that
// arrives hours later is still followed.
func TestWorkerFollowsADepositMadeAfterTheDeadline(t *testing.T) {
	e, fake, worker, pay, quote := tracked(t)
	id, address := quote["quoteId"].(string), quote["depositAddress"].(string)
	deadline, _ := time.Parse(time.RFC3339, quote["deadline"].(string))
	at := deadline.Add(3 * time.Hour)
	if next := checkAt(t, e, worker, id, at); next == nil || next.Sub(at) != 30*time.Minute {
		t.Fatalf("3 hours past the deadline: next %v", next)
	}
	fake.SetStatus(address, intents.Processing, map[string]any{"depositedAmount": "101120000",
		"originChainTxHashes": []any{}, "destinationChainTxHashes": []any{}})
	at = at.Add(30 * time.Minute)
	if next := checkAt(t, e, worker, id, at); next == nil || next.Sub(at) != 10*time.Second {
		t.Fatalf("converting: next %v", next)
	}
	if historyKinds(t, e, pay)["crosschain.deposit_seen"] == nil {
		t.Fatal("the late deposit has no history")
	}
}

// A status this code doesn't know may hold a payer's deposit: it alerts, and the quote is read on past its end.
func TestWorkerAlertsOnAStatusItDoesNotKnow(t *testing.T) {
	e, fake, worker, _, quote := tracked(t)
	id := quote["quoteId"].(string)
	deadline, _ := time.Parse(time.RFC3339, quote["deadline"].(string))
	fake.SetStatus(quote["depositAddress"].(string), "PENDING_REFUND", map[string]any{"depositedAmount": "101120000",
		"originChainTxHashes": []any{}, "destinationChainTxHashes": []any{}})
	var logs bytes.Buffer
	defer slog.SetDefault(slog.Default())
	slog.SetDefault(slog.New(slog.NewTextHandler(&logs, nil)))
	at := deadline.Add(73 * time.Hour)
	if next := checkAt(t, e, worker, id, at); next == nil || next.Sub(at) != time.Hour {
		t.Fatalf("unknown status past the end: next %v", next)
	}
	if !strings.Contains(logs.String(), "ALERT cross-chain status unknown") || !strings.Contains(logs.String(), id) {
		t.Fatalf("logs lack the alert:\n%s", logs.String())
	}
}

// 1Click holds a short deposit until the deadline, and the rest sent to its address may still convert it: until it
// ends, the invoice waits as for a deposit it converts.
func TestAShortDepositHoldsTheInvoice(t *testing.T) {
	e, fake, worker, pay, quote := tracked(t)
	fake.SetStatus(quote["depositAddress"].(string), intents.IncompleteDeposit, map[string]any{"depositedAmount": "99000000",
		"originChainTxHashes": []any{}, "destinationChainTxHashes": []any{}})
	checkAt(t, e, worker, quote["quoteId"].(string), time.Now())
	if r := e.call(t, "POST", crossPath+pay+"/crosschain/quotes", "", "", `{"originAsset": "`+tronUSDT+`", "refundTo": "`+refundTo+`"}`); r.status != http.StatusConflict ||
		errorCode(r) != "pick_locked" {
		t.Fatalf("a new quote beside a short deposit: %d %v", r.status, r.body)
	}
	main := e.get(t, pay).body["invoiceId"].(string)
	if r := e.call(t, "POST", "/v1/profiles/"+e.aliceProfile+"/invoices/"+main+"/cancel", "did:privy:alice", "", ""); r.status == http.StatusOK {
		t.Fatalf("canceled beside a short deposit: %v", r.body)
	}
}

// One round reads the deposits 1Click saw first, then the rest, many at once: a slow 1Click or many idle quotes
// can't delay a payer's conversion.
func TestOneRoundReadsDepositsFirstAndManyAtOnce(t *testing.T) {
	e, _ := crossChainEnv(t)
	pay, options := liveInvoice(t, e, "key-1", 86400)
	slow := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		time.Sleep(100 * time.Millisecond)
		status := intents.PendingDeposit
		if r.URL.Query().Get("depositAddress") == "converting" {
			status = intents.Processing
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"status": status, "swapDetails": map[string]any{}})
	}))
	t.Cleanup(slow.Close)
	worker := invoice.NewService(e.pool)
	worker.SetCrossChain(intents.NewClient(slow.URL, "", true))
	// 70 idle quotes due, and one converting that is due last.
	e.exec(t, `INSERT INTO crosschain_quotes (invoice_id, option_id, origin_asset, refund_to, deposit_address, amount_in,
		    min_amount_in, amount_out, time_estimate, shown_until, deadline, signed, status, next_check_at)
		SELECT $1, $2, 'x', 'x', a, 1, 1, 1, 0, now() + interval '15 minutes', now() + interval '1 hour', '{}', s, d
		FROM (SELECT 'idle-' || n, 'PENDING_DEPOSIT', now() - interval '1 hour' + n * interval '1 second'
		      FROM generate_series(1, 70) n
		      UNION ALL SELECT 'converting', 'PROCESSING', now()) q (a, s, d)`,
		e.get(t, pay).body["invoiceId"], options[intents.BaseChainID]["optionId"])
	start := time.Now()
	if err := worker.TrackCrossChain(context.Background(), start); err != nil {
		t.Fatal(err)
	}
	if took := time.Since(start); took > 3*time.Second {
		t.Fatalf("a round of 100 ms answers took %s", took)
	}
	var converting *time.Time
	var due int
	if err := e.pool.QueryRow(context.Background(), `SELECT (SELECT next_check_at FROM crosschain_quotes
		    WHERE deposit_address = 'converting'), (SELECT count(*) FROM crosschain_quotes WHERE next_check_at <= $1)`,
		start).Scan(&converting, &due); err != nil {
		t.Fatal(err)
	}
	if converting == nil || !converting.After(start) || due != 71-64 {
		t.Fatalf("converting next %v, still due %d", converting, due)
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
	// Returned money didn't pay the invoice, so the payments list doesn't tag it (R-239).
	list := e.call(t, "GET", "/v1/profiles/"+e.aliceProfile+"/payments", "did:privy:alice", "", "")
	for _, item := range list.body["items"].([]any) {
		if c := item.(map[string]any)["crossChain"]; c != nil {
			t.Fatalf("payments list tags a returned deposit: %v", c)
		}
	}
}

// R-239: when the payer also pays directly on another option and that money is booked first, 1Click's USDC is held
// on Base: the payments list and the receipt don't say the payment went through NEAR Intents.
func TestADirectPaymentBookedFirstIsNotPaidThroughNEARIntents(t *testing.T) {
	e, fake, worker, pay, quote := tracked(t)
	id, address := quote["quoteId"].(string), quote["depositAddress"].(string)
	main := e.get(t, pay).body["invoiceId"].(string)
	var base, arbitrum string
	for _, o := range e.get(t, pay).body["options"].([]any) {
		option := o.(map[string]any)
		if option["chainId"] == float64(intents.BaseChainID) {
			base = option["optionId"].(string)
		} else {
			arbitrum = option["optionId"].(string)
		}
	}
	direct, baseTx := "0x"+strings.Repeat("ab", 32), "0x"+originTx
	chainTransfer(t, e, 42161, arbitrum, direct, "100000000")
	fake.SetStatus(address, intents.Success, map[string]any{"depositedAmount": "101120000", "amountOut": "100000000",
		"originChainTxHashes":      []any{map[string]any{"hash": originTx}},
		"destinationChainTxHashes": []any{map[string]any{"hash": baseTx}}})
	checkAt(t, e, worker, id, time.Now())
	baseTransfer(t, e, base, baseTx, "100000000")

	if got := e.get(t, pay).body["paymentStatus"]; got != "paid" {
		t.Fatalf("status %v, want paid", got)
	}
	list := e.call(t, "GET", "/v1/profiles/"+e.aliceProfile+"/payments", "did:privy:alice", "", "")
	for _, item := range list.body["items"].([]any) {
		if c := item.(map[string]any)["crossChain"]; c != nil {
			t.Fatalf("payments list tags a payment made on Arbitrum: %v", c)
		}
	}
	if text := pdfText(t, e.pdf(t, main, "receipt.pdf", "").body); strings.Contains(text, "NEAR Intents") {
		t.Fatalf("the receipt says the payment went through NEAR Intents:\n%s", text)
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
	// A destination hash that isn't a Base transaction stays out of the history's txHash.
	fake.SetStatus(quote["depositAddress"].(string), intents.Success, map[string]any{"depositedAmount": "101120000",
		"amountOut": "100000000", "originChainTxHashes": []any{},
		"destinationChainTxHashes": []any{map[string]any{"hash": originTx}}})
	checkAt(t, e, worker, quote["quoteId"].(string), time.Now().Add(time.Minute))
	if converted, ok := historyKinds(t, e, pay)["crosschain.converted"]; !ok || converted["txHash"] != nil {
		t.Fatalf("converted history %v", converted)
	}
}

// R-240: a profile turns payments from other chains off for new quotes; an open quote still finishes.
func TestProfileTurnsCrossChainOff(t *testing.T) {
	e, fake, worker, pay, quote := tracked(t)
	path := "/v1/profiles/" + e.aliceProfile + "/tokens"
	if r := e.call(t, "GET", path, "did:privy:alice", "", ""); r.status != http.StatusOK || r.body["crossChain"] != true {
		t.Fatalf("default: %d %v", r.status, r.body)
	}
	if got := e.get(t, pay).body["crossChainOn"]; got != true {
		t.Fatalf("invoice read crossChainOn %v", got)
	}
	if r := e.call(t, "PUT", path, "did:privy:alice", "", `{"off": [], "crossChain": false}`); r.status != http.StatusOK ||
		r.body["crossChain"] != false {
		t.Fatalf("turn off: %d %v", r.status, r.body)
	}
	// Each part saves alone and keeps the other as it is.
	tokens := e.call(t, "GET", path, "did:privy:alice", "", "").body["tokens"].([]any)
	other := tokens[len(tokens)-1].(map[string]any)
	off := fmt.Sprintf(`{"off": [{"chainId": %v, "token": %q}]}`, other["chainId"], other["token"])
	if r := e.call(t, "PUT", path, "did:privy:alice", "", off); r.body["crossChain"] != false {
		t.Fatalf("save without the switch: %v", r.body)
	}
	r := e.call(t, "PUT", path, "did:privy:alice", "", `{"crossChain": true}`)
	if last := r.body["tokens"].([]any)[len(tokens)-1].(map[string]any); r.body["crossChain"] != true || last["on"] != false {
		t.Fatalf("save the switch alone: %v", r.body)
	}
	if r := e.call(t, "PUT", path, "did:privy:alice", "", `{}`); r.status != http.StatusUnprocessableEntity {
		t.Fatalf("empty save: %d %v", r.status, r.body)
	}
	if r := e.call(t, "PUT", path, "did:privy:alice", "", `{"crossChain": false}`); r.body["crossChain"] != false {
		t.Fatalf("turn off again: %v", r.body)
	}
	if got := e.get(t, pay).body["crossChainOn"]; got != false {
		t.Fatalf("invoice read crossChainOn %v", got)
	}
	r = e.call(t, "POST", crossPath+pay+"/crosschain/quotes", "", "", `{"originAsset": "`+ethAsset+`", "refundTo": "0x6fd1c6b3f0b7a5b4e5d6a3c2b1a0f9e8d7c6b5a4"}`)
	if r.status != 422 || errorCode(r) != "crosschain_unavailable" ||
		!strings.Contains(r.body["error"].(map[string]any)["message"].(string), "turned it off") {
		t.Fatalf("quote while off: %d %v", r.status, r.body)
	}
	// The quote made before still finishes.
	fake.SetStatus(quote["depositAddress"].(string), intents.Processing, map[string]any{"depositedAmount": "101120000",
		"originChainTxHashes": []any{}, "destinationChainTxHashes": []any{}})
	checkAt(t, e, worker, quote["quoteId"].(string), time.Now())
	if got := e.get(t, pay).body["crossChain"].(map[string]any)["status"]; got != "PROCESSING" {
		t.Fatalf("open quote status %v", got)
	}
}

// An api started with CROSSCHAIN_OFF has no 1Click: the pay page isn't offered it, and new quotes are refused.
func TestAnAPIWithout1ClickOffersNoCrossChain(t *testing.T) {
	e := invoiceAPICrossChain(t, 0, webhookKey, nil, invoice.Pricing{}, nil)
	e.exec(t, `UPDATE chains SET enabled = true WHERE chain_id IN (8453, 42161)`)
	e.exec(t, `INSERT INTO chain_cursors (chain_id, last_scanned_block, last_finalized_block) VALUES (8453, 0, 0), (42161, 0, 0)`)
	e.exec(t, `UPDATE profiles SET livemode = true WHERE id = $1`, e.aliceProfile)
	pay, _ := liveInvoice(t, e, "key-1", 86400)
	if got := e.get(t, pay).body["crossChainOn"]; got != false {
		t.Fatalf("invoice read crossChainOn %v", got)
	}
	r := e.call(t, "POST", crossPath+pay+"/crosschain/quotes", "", "", `{"originAsset": "`+tronUSDT+`", "refundTo": "`+refundTo+`"}`)
	if r.status != 422 || errorCode(r) != "crosschain_unavailable" {
		t.Fatalf("quote: %d %v", r.status, r.body)
	}
}

// A deposit 1Click never finishes holds the invoice only until an hour past its deadline, when its alert fires: then
// the owner can cancel it.
func TestADeposit1ClickNeverFinishesStopsHoldingTheInvoice(t *testing.T) {
	e, fake, worker, pay, quote := tracked(t)
	id := quote["quoteId"].(string)
	fake.SetStatus(quote["depositAddress"].(string), intents.Processing, map[string]any{"depositedAmount": "101120000",
		"originChainTxHashes": []any{}, "destinationChainTxHashes": []any{}})
	checkAt(t, e, worker, id, time.Now())
	main := e.get(t, pay).body["invoiceId"].(string)
	cancel := func() reply {
		return e.call(t, "POST", "/v1/profiles/"+e.aliceProfile+"/invoices/"+main+"/cancel", "did:privy:alice", "", "")
	}
	e.exec(t, `UPDATE crosschain_quotes SET shown_until = now() - interval '70 minutes', deadline = now() - interval '50 minutes',
		deposit_seen_at = now() - interval '50 minutes' WHERE id = $1`, id)
	if r := cancel(); r.status == http.StatusOK {
		t.Fatalf("canceled under an hour past the deadline: %v", r.body)
	}
	e.exec(t, `UPDATE crosschain_quotes SET shown_until = now() - interval '90 minutes', deadline = now() - interval '61 minutes',
		deposit_seen_at = now() - interval '61 minutes' WHERE id = $1`, id)
	if r := cancel(); r.status != http.StatusOK {
		t.Fatalf("cancel an hour past the deadline: %d %v", r.status, r.body)
	}
}

// 1Click delivering another amount than its quote alerts. Once that delivery is booked on Base, the quote no longer
// holds the invoice: the rest can be paid from another chain too.
func TestADeliveryOfAnotherAmountAlertsAndLeavesTheRestPayable(t *testing.T) {
	e, fake, worker, pay, quote := tracked(t)
	id := quote["quoteId"].(string)
	baseTx := "0x" + originTx
	fake.SetStatus(quote["depositAddress"].(string), intents.Success, map[string]any{"depositedAmount": "101120000",
		"amountOut": "99000000", "originChainTxHashes": []any{},
		"destinationChainTxHashes": []any{map[string]any{"hash": baseTx}}})
	var logs bytes.Buffer
	defer slog.SetDefault(slog.Default())
	slog.SetDefault(slog.New(slog.NewTextHandler(&logs, nil)))
	checkAt(t, e, worker, id, time.Now())
	if !strings.Contains(logs.String(), "ALERT cross-chain swap delivered another amount than its quote") ||
		!strings.Contains(logs.String(), id) {
		t.Fatalf("logs lack the alert:\n%s", logs.String())
	}
	another := func() reply {
		return e.call(t, "POST", crossPath+pay+"/crosschain/quotes", "", "",
			`{"originAsset": "`+ethAsset+`", "refundTo": "0x6fd1c6b3f0b7a5b4e5d6a3c2b1a0f9e8d7c6b5a4"}`)
	}
	if r := another(); r.status != http.StatusConflict || errorCode(r) != "pick_locked" {
		t.Fatalf("a quote before the delivery is booked: %d %v", r.status, r.body)
	}
	var base string
	for _, o := range e.get(t, pay).body["options"].([]any) {
		if option := o.(map[string]any); option["chainId"] == float64(intents.BaseChainID) {
			base = option["optionId"].(string)
		}
	}
	baseTransfer(t, e, base, baseTx, "99000000")
	if r := another(); r.status != http.StatusCreated || r.body["amountOut"] != "1000000" {
		t.Fatalf("a quote for the rest: %d %v", r.status, r.body)
	}
}
