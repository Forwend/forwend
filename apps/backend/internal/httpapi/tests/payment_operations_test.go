package tests

import (
	"context"
	"encoding/csv"
	"encoding/json"
	"fmt"
	"math/big"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/forwend/forwend/apps/backend/internal/invoice"
	"github.com/forwend/forwend/apps/backend/internal/ledger"
)

func TestMerchantPaymentFiltersSeparateSourcesAndKeepUnpaidAttempts(t *testing.T) {
	e := invoiceAPI(t)
	const alice = "did:privy:alice"
	shop := e.merchant(t)
	first := storeIDs(t, e, shop)[0]
	base := "/v1/profiles/" + shop
	if r := e.call(t, "PUT", base+"/stores/"+storeB, alice, "", `{"name":"Other shop","defaultExpiresIn":3600}`); r.status != http.StatusCreated {
		t.Fatalf("second store: %d %v", r.status, r.body)
	}
	bill := e.post(t, alice, shop, "bill", `{"chainId":84532,"token":"`+usdc+`","amount":"2000000","storeId":"`+first+`"}`)
	if bill.status != http.StatusCreated {
		t.Fatalf("bill: %d %v", bill.status, bill.body)
	}
	checkout := e.call(t, "POST", base+"/checkout-sessions", alice, "order-1", `{"storeId":"`+first+`","amountUsd":"2","reference":"order-1"}`)
	if checkout.status != http.StatusCreated {
		t.Fatalf("checkout: %d %v", checkout.status, checkout.body)
	}
	linkID := "33000000-0000-4000-8000-000000000001"
	link := e.call(t, "PUT", base+"/links/"+linkID, alice, "", `{"storeId":"`+storeB+`","title":"Coffee","amountUsd":"2"}`)
	if link.status != http.StatusCreated {
		t.Fatalf("link: %d %v", link.status, link.body)
	}
	purchase := e.call(t, "POST", "/v1/links/"+link.body["slug"].(string)+"/pay", "", "buyer-1", `{}`)
	if purchase.status != http.StatusCreated {
		t.Fatalf("link purchase: %d %v", purchase.status, purchase.body)
	}
	linked := e.call(t, "GET", "/v1/invoices/"+purchase.body["payToken"].(string), "", "", "").body["invoiceId"].(string)
	for source, want := range map[string]string{"invoice": bill.body["invoiceId"].(string), "checkout": checkout.body["sessionId"].(string), "payment_link": linked} {
		got := e.call(t, "GET", base+"/payments?source="+source, alice, "", "")
		items, ok := got.body["items"].([]any)
		if got.status != http.StatusOK || !ok || len(items) != 1 || items[0].(map[string]any)["paymentId"] != want {
			t.Fatalf("source %s returned %d %v", source, got.status, got.body)
		}
		item := items[0].(map[string]any)
		if item["amounts"].(map[string]any)["reconciliationStatus"] != "verified" {
			t.Errorf("an unpaid option with no movement was classified as needing work: %v", item["amounts"])
		}
		if item["source"] != source || item["amounts"] == nil {
			t.Fatalf("missing source or net amounts: %v", item)
		}
	}
	if got := e.call(t, "GET", base+"/payments?source=request", alice, "", ""); got.status != http.StatusOK || len(got.body["items"].([]any)) != 0 {
		t.Fatalf("merchant request source: %d %v", got.status, got.body)
	}
	for _, query := range []string{"?source=unknown", "?paymentStatus=unknown", "?settlementStatus=unknown", "?refundStatus=unknown", "?status=unknown"} {
		if got := e.call(t, "GET", base+"/payments"+query, alice, "", ""); got.status != http.StatusUnprocessableEntity {
			t.Fatalf("bad filter %s: %d %v", query, got.status, got.body)
		}
	}
	if got := e.call(t, "GET", base+"/payments?storeId="+first+"&source=payment_link", alice, "", ""); got.status != http.StatusOK || len(got.body["items"].([]any)) != 0 {
		t.Fatalf("filters did not intersect: %d %v", got.status, got.body)
	}
	if got := e.call(t, "GET", base+"/payments?paymentStatus=open&settlementStatus=none&refundStatus=none", alice, "", ""); got.status != http.StatusOK || len(got.body["items"].([]any)) != 3 {
		t.Fatalf("unpaid attempts missing: %d %v", got.status, got.body)
	}
	linkedOnly := e.call(t, "GET", base+"/payments?linkId="+linkID, alice, "", "")
	if linkedOnly.status != http.StatusOK || len(linkedOnly.body["items"].([]any)) != 1 || linkedOnly.body["items"].([]any)[0].(map[string]any)["paymentId"] != linked {
		t.Errorf("link result filter: %d %v", linkedOnly.status, linkedOnly.body)
	}
	item := e.call(t, "GET", base+"/payments?source=checkout", alice, "", "").body["items"].([]any)[0].(map[string]any)
	if item["symbol"] != "USDC" || item["decimals"] != float64(6) {
		t.Errorf("canonical token metadata missing: %v", item)
	}

}

func TestConfirmingPaymentFilterIncludesUncreditedDeposits(t *testing.T) {
	e := invoiceAPI(t)
	const alice = "did:privy:alice"
	shop := e.merchant(t)
	store := storeIDs(t, e, shop)[0]
	base := "/v1/profiles/" + shop
	made := e.call(t, "POST", base+"/checkout-sessions", alice, "confirming-filter", `{"storeId":"`+store+`","amountUsd":"2"}`)
	if made.status != http.StatusCreated {
		t.Fatal(made.body)
	}
	id := made.body["sessionId"].(string)
	if _, err := e.pool.Exec(t.Context(), "UPDATE invoices SET payment_status='detected' WHERE id=$1", id); err != nil {
		t.Fatal(err)
	}
	got := e.call(t, "GET", base+"/payments?status=confirming", alice, "", "")
	if got.status != http.StatusOK {
		t.Fatalf("confirming filter: %d %v", got.status, got.body)
	}
	items := got.body["items"].([]any)
	if len(items) != 1 || items[0].(map[string]any)["paymentId"] != id {
		t.Fatalf("missing payment: %v", items)
	}
	open := e.call(t, "GET", base+"/payments?status=open", alice, "", "")
	if len(open.body["items"].([]any)) != 0 {
		t.Fatalf("confirming payment also awaiting payment: %v", open.body)
	}
	e.exec(t, `UPDATE invoices SET payment_status='partially_paid' WHERE id=$1`, id)
	e.exec(t, `INSERT INTO chain_transfers(chain_id,chain_family,token_contract,invoice_id,tx_hash,log_index,block_hash,
 block_number,block_time,from_address,to_address,amount,status)
 SELECT chain_id,chain_family,token_contract,id,'0x'||repeat('ab',32),0,'0x'||repeat('cd',32),100,closes_at-1,
 receive_address,receive_address,1,'detected' FROM invoices WHERE id=$1`, id)
	pending := e.call(t, "GET", base+"/payments?status=confirming", alice, "", "")
	if pending.status != http.StatusOK || len(pending.body["items"].([]any)) != 1 {
		t.Fatalf("pending partial payment missing: %v", pending.body)
	}
	session := e.call(t, "GET", base+"/checkout-sessions/"+id, alice, "", "")
	receipt := session.body["payment"].(map[string]any)["receipts"].([]any)
	if len(receipt) != 1 || receipt[0].(map[string]any)["received"] != "1" || receipt[0].(map[string]any)["pending"] != "1" {
		t.Fatalf("checkout pending receipt disagrees: %v", receipt)
	}

}

func TestPaymentAttentionShowsNetFundsAndDeliveryWithoutChangingPaymentTruth(t *testing.T) {
	e := invoiceAPI(t)
	const alice = "did:privy:alice"
	shop := e.merchant(t)
	first := storeIDs(t, e, shop)[0]
	base := "/v1/profiles/" + shop
	makePayment := func(key string) string {
		t.Helper()
		made := e.call(t, "POST", base+"/checkout-sessions", alice, key, `{"storeId":"`+first+`","amountUsd":"2"}`)
		if made.status != http.StatusCreated {
			t.Fatalf("create: %d %v", made.status, made.body)
		}
		return made.body["sessionId"].(string)
	}
	partial := makePayment("partial")
	e.deposit(t, partial, "1000000")
	endpoint := "33000000-0000-4000-8000-000000000002"
	if got := e.call(t, "PUT", base+"/webhooks/"+endpoint, alice, "", `{"url":"https://merchant.example/hooks","events":["invoice.paid"],"storeId":"`+first+`"}`); got.status != http.StatusCreated {
		t.Fatalf("webhook: %d %v", got.status, got.body)
	}
	paid := makePayment("held")
	e.deposit(t, paid, "2500000")
	e.exec(t, `UPDATE webhook_deliveries d SET status = 'failed', attempts = 1 FROM webhook_events e
   WHERE d.event_id = e.id AND e.invoice_id = $1`, paid)
	e.exec(t, `INSERT INTO webhook_attempts (endpoint_id,event_id,status_code,error,duration_ms)
   SELECT endpoint_id,event_id,503,'upstream unavailable',12 FROM webhook_deliveries WHERE endpoint_id = $1`, endpoint)
	e.exec(t, "UPDATE webhook_endpoints SET enabled = false WHERE id = $1", endpoint)
	events := e.call(t, "GET", base+"/events", alice, "", "")
	if events.status != http.StatusOK || len(events.body["items"].([]any)) == 0 {
		t.Errorf("checkout notification: %d %v", events.status, events.body)
	} else {
		for _, entry := range events.body["items"].([]any) {
			event := entry.(map[string]any)
			if event["number"] != nil || event["documentKind"] != "none" || event["invoiceId"] != paid {
				t.Errorf("checkout notification identity: %v", event)
			}
		}
	}
	detail := e.call(t, "GET", base+"/payments/"+paid, alice, "", "")
	if detail.status != http.StatusOK || detail.body["paymentStatus"] != "paid" || detail.body["settlementStatus"] != "pending" || detail.body["snapshotAt"] == nil {
		t.Fatalf("detail conflated delivery/payment: %d %v", detail.status, detail.body)
	}
	options, ok := detail.body["options"].([]any)
	if !ok || len(options) != 1 {
		t.Fatalf("option accounting missing: %v", detail.body)
	}
	settlement := options[0].(map[string]any)["settlement"].(map[string]any)
	if _, ok := settlement["blocksLeft"]; !ok {
		t.Fatal("payment detail omits settlement finality progress")
	}
	if settlement["blocksLeft"] != nil || settlement["secondsLeft"] != nil {
		t.Fatalf("unmined settlement invented progress: %v", settlement)
	}
	e.exec(t, `UPDATE settlement_intents SET receipt_tx_hash='0x'||repeat('ab',32), receipt_block=120,
 receipt_time=(SELECT last_finalized_time + 40 FROM chain_cursors WHERE chain_id=84532) WHERE invoice_id=$1`, paid)
	progress := func() map[string]any {
		t.Helper()
		got := e.call(t, "GET", base+"/payments/"+paid+"?view=summary", alice, "", "")
		if got.status != http.StatusOK {
			t.Fatal(got.body)
		}
		return got.body["options"].([]any)[0].(map[string]any)["settlement"].(map[string]any)
	}
	if got := progress(); got["blocksLeft"] != float64(20) || got["secondsLeft"] != float64(40) || got["blockNumber"] != float64(120) {
		t.Fatalf("settlement progress missing from summary: %v", got)
	}
	e.exec(t, "UPDATE chain_cursors SET last_scanned_block=greatest(last_scanned_block,120),last_finalized_block=110,last_finalized_time=last_finalized_time+20 WHERE chain_id=84532")
	if got := progress(); got["blocksLeft"] != float64(10) || got["secondsLeft"] != float64(20) {
		t.Fatalf("settlement progress did not refresh: %v", got)
	}
	e.exec(t, "UPDATE chain_cursors SET last_finalized_block=120,last_finalized_time=last_finalized_time+20 WHERE chain_id=84532")
	if got := progress(); got["blocksLeft"] != float64(0) || got["secondsLeft"] != float64(0) || got["status"] == "confirmed" {
		t.Fatalf("display progress changed settlement truth: %v", got)
	}
	e.exec(t, "UPDATE chain_cursors SET last_finalized_block=100,last_finalized_time=last_finalized_time-40 WHERE chain_id=84532")
	option := options[0].(map[string]any)
	amounts := option["amounts"].(map[string]any)
	if amounts["reconciliationStatus"] != "verified" {
		t.Errorf("complete source evidence classified incorrectly: %v", amounts)
	}
	if amounts["held"] != "500000" || amounts["payable"] != "2000000" || amounts["refunded"] != "0" {
		t.Fatalf("wrong net liabilities: %v", amounts)
	}
	movements := e.call(t, "GET", base+"/payments/"+paid+"/movements", alice, "", "")
	if movements.status != http.StatusOK {
		t.Fatalf("movement read: %d %v", movements.status, movements.body)
	}
	records := movements.body["items"].([]any)
	if len(records) != 1 || records[0].(map[string]any)["receiverDelta"] != "2500000" || records[0].(map[string]any)["heldDelta"] != "500000" {
		t.Fatalf("movement fields: %v", records)
	}
	export := e.call(t, "GET", base+"/payments.csv", alice, "", "")
	if export.status != http.StatusOK {
		t.Fatalf("movement CSV: %d %v", export.status, export.body)
	}
	reconciled := e.call(t, "GET", base+"/payments/"+paid+"/reconciliation", alice, "", "")
	if reconciled.status != http.StatusOK {
		t.Fatalf("reconciliation: %d %v", reconciled.status, reconciled.body)
	}
	asset := reconciled.body["assets"].([]any)[0].(map[string]any)
	if asset["closing"].(map[string]any)["receiver"] != "2500000" || asset["checkpointDifference"] != nil {
		t.Fatalf("reconciliation totals: %v", asset)
	}
	coverage := option["coverage"].(map[string]any)
	if coverage["historyComplete"] != true || coverage["balanceDifference"] != nil || len(option["deposits"].([]any)) != 1 {
		t.Fatalf("receiver evidence missing: %v", option)
	}
	deliveries := detail.body["deliveries"].([]any)
	if len(deliveries) != 1 || deliveries[0].(map[string]any)["lastStatusCode"] != float64(503) || deliveries[0].(map[string]any)["enabled"] != false {
		t.Fatalf("delivery evidence missing: %v", deliveries)
	}
	attention := e.call(t, "GET", base+"/payments/attention", alice, "", "")
	if attention.status != http.StatusOK {
		t.Fatalf("attention: %d %v", attention.status, attention.body)
	}
	found := map[string]map[string]bool{}
	for _, item := range attention.body["items"].([]any) {
		row := item.(map[string]any)
		id := row["paymentId"].(string)
		found[id] = map[string]bool{}
		for _, entry := range row["problems"].([]any) {
			found[id][entry.(map[string]any)["code"].(string)] = true
		}
	}
	if !found[partial]["partial_payment"] || !found[paid]["held_funds"] || !found[paid]["webhook_delivery"] {
		t.Fatalf("attention omitted actual problems: %v", found)
	}
	if found[paid]["refund_pending"] {
		t.Fatal("invented a refund claim")
	}
}

func TestPaymentMovementExportReconcilesReturnsAndKeepsObservationsOutOfBookedTotals(t *testing.T) {
	e := invoiceAPI(t)
	const alice = "did:privy:alice"
	shop := e.merchant(t)
	store := storeIDs(t, e, shop)[0]
	base := "/v1/profiles/" + shop
	made := e.call(t, "POST", base+"/checkout-sessions", alice, "reconcile", `{"storeId":"`+store+`","amountUsd":"3","reference":"=external-order","title":"Coffee"}`)
	if made.status != http.StatusCreated {
		t.Fatalf("checkout: %d %v", made.status, made.body)
	}
	id := made.body["sessionId"].(string)
	// These are observer and journal inputs. The binary integration test checks actual chain records.
	e.exec(t, `WITH source AS (
  INSERT INTO chain_transfers (chain_id,chain_family,token_contract,invoice_id,tx_hash,log_index,block_hash,block_number,block_time,from_address,to_address,amount,status,created_at)
  SELECT chain_id,chain_family,token_contract,id,id,0,id,90,extract(epoch FROM now())::bigint-86400,$2,receive_address,3000000,'confirmed',current_date-interval '1 day' FROM invoices WHERE id = $1 RETURNING id,invoice_id
 ), journal AS (
  INSERT INTO ledger_transactions (invoice_id,kind,chain_transfer_id,created_at) SELECT invoice_id,'deposit',id,current_date-interval '1 day' FROM source RETURNING id
 ) INSERT INTO ledger_entries (transaction_id,account,amount) SELECT id,'receiver',3000000 FROM journal UNION ALL SELECT id,'recipient_payable',-3000000 FROM journal`, id, aliceWallet)
	e.exec(t, `WITH journal AS (
 INSERT INTO ledger_transactions (invoice_id,kind) VALUES ($1,'refund') RETURNING id
 ) INSERT INTO ledger_entries (transaction_id,account,amount) SELECT id,'receiver',-500000 FROM journal UNION ALL SELECT id,'recipient_payable',500000 FROM journal`, id)
	e.exec(t, `INSERT INTO receiver_outflows (invoice_id,chain_id,receiver_address,token_contract,kind,destination,amount,tx_hash,log_index,transfer_log_index,block_hash,block_number,block_time,verified_block,ledger_transaction_id,reconciliation_error)
 SELECT i.id,i.chain_id,i.receive_address,i.token_contract,'refund',$2,500000,'0x'||repeat('a',64),1,0,i.id,91,extract(epoch FROM now())::bigint,100,j.id,'' FROM invoices i JOIN ledger_transactions j ON j.invoice_id = i.id AND j.kind = 'refund' WHERE i.id = $1`, id, aliceWallet)
	e.exec(t, `INSERT INTO receiver_outflows (invoice_id,chain_id,receiver_address,token_contract,kind,destination,amount,tx_hash,log_index,transfer_log_index,block_hash,block_number,block_time,verified_block,reconciliation_error)
 SELECT id,chain_id,receive_address,token_contract,'refund',$2,200000,'0x'||repeat('b',64),1,0,'0x'||repeat('b',64),92,extract(epoch FROM now())::bigint,100,'awaiting_booking' FROM invoices WHERE id = $1`, id, aliceWallet)
	exported := e.call(t, "GET", base+"/payments/"+id+"/movements.csv", alice, "", "")
	if exported.status != http.StatusOK {
		t.Fatalf("CSV: %d %v", exported.status, exported.body)
	}
	rows, err := csv.NewReader(strings.NewReader(exported.raw)).ReadAll()
	if err != nil || len(rows) != 4 {
		t.Fatalf("rows: %v %v", rows, err)
	}
	columns := map[string]int{}
	for i, name := range rows[0] {
		columns[name] = i
	}
	total := new(big.Int)
	observed := 0
	for _, row := range rows[1:] {
		field := func(name string) string { return row[columns[name]] }
		if field("Invoice number") != "" || field("Document kind") != "none" || field("Order reference") != "'=external-order" || field("Token contract") != usdc {
			t.Fatalf("identity fields: %v", row)
		}
		if field("Record state") == "observed" {
			observed++
			if field("Receiver delta (base units)") != "" || field("Receiver USD delta") != "" || field("Source amount (base units)") != "200000" {
				t.Fatalf("observation counted as cash: %v", row)
			}
			continue
		}
		delta, ok := new(big.Int).SetString(field("Receiver delta (base units)"), 10)
		if !ok {
			t.Fatalf("non-numeric signed delta: %v", row)
		}
		total.Add(total, delta)
		if field("Source verified") != "true" || field("Token transfer log index") != "0" || field("Event log index") == "" {
			t.Fatalf("missing source evidence: %v", row)
		}
	}
	if observed != 1 || total.String() != "2500000" {
		t.Fatalf("export total %s, observations %d", total, observed)
	}
	today := time.Now().UTC().Format(time.DateOnly)
	summary := e.call(t, "GET", base+"/payments/"+id+"/reconciliation?from="+today+"&to="+today, alice, "", "")
	if summary.status != http.StatusOK {
		t.Fatalf("summary: %d %v", summary.status, summary.body)
	}
	asset := summary.body["assets"].([]any)[0].(map[string]any)
	if asset["opening"].(map[string]any)["receiver"] != "3000000" || asset["changes"].(map[string]any)["receiver"] != "-500000" || asset["closing"].(map[string]any)["receiver"] != total.String() || asset["checkpointDifference"] != nil || asset["unbookedOutflows"] != float64(1) || asset["refunded"] != "500000" {
		t.Fatalf("summary did not reconcile: %v", asset)
	}
	yesterday := time.Now().UTC().AddDate(0, 0, -1).Format(time.DateOnly)
	historical := e.call(t, "GET", base+"/payments/"+id+"/reconciliation?to="+yesterday, alice, "", "")
	asset = historical.body["assets"].([]any)[0].(map[string]any)
	if asset["checkpointDifference"] != nil || asset["closing"].(map[string]any)["receiver"] != "3000000" {
		t.Fatalf("current chain balance compared to historical books: %v", asset)
	}
	seen := map[string]bool{}
	cursor := ""
	for range 4 {
		page := e.call(t, "GET", base+"/payments/"+id+"/movements?limit=1&cursor="+cursor, alice, "", "")
		if page.status != http.StatusOK {
			t.Fatalf("page: %d %v", page.status, page.body)
		}
		for _, item := range page.body["items"].([]any) {
			key := item.(map[string]any)["id"].(string)
			if seen[key] {
				t.Fatalf("duplicate cursor row %s", key)
			}
			seen[key] = true
		}
		if page.body["nextCursor"] == nil {
			break
		}
		cursor = page.body["nextCursor"].(string)
	}
	if len(seen) != 3 {
		t.Fatalf("cursor omitted movement: %v", seen)
	}
	for _, path := range []string{"/payments/movements?cursor=garbage", "/payments.csv?cursor=garbage", "/payments/reconciliation?cursor=garbage", "/payments/movements?from=bad"} {
		if got := e.call(t, "GET", base+path, alice, "", ""); got.status != http.StatusUnprocessableEntity {
			t.Fatalf("invalid query %s: %d %v", path, got.status, got.body)
		}
	}
}

func TestPaymentMovementExportPreservesLargeBaseUnitsAndRejectsMoreThanTenThousandRows(t *testing.T) {
	e := invoiceAPI(t)
	const alice = "did:privy:alice"
	shop := e.merchant(t)
	base := "/v1/profiles/" + shop
	const units = "10000000000000000007"
	e.exec(t, "UPDATE tokens SET decimals = 18 WHERE chain_id = 84532 AND contract = $1", usdc)
	made := e.post(t, alice, shop, "precision", `{"chainId":84532,"token":"`+usdc+`","amount":"`+units+`"}`)
	if made.status != http.StatusCreated {
		t.Fatalf("create: %d %v", made.status, made.body)
	}
	id := made.body["invoiceId"].(string)
	e.exec(t, `INSERT INTO chain_transfers (chain_id,chain_family,token_contract,invoice_id,tx_hash,log_index,block_hash,block_number,block_time,from_address,to_address,amount,status)
 SELECT chain_id,chain_family,token_contract,id,id,0,id,90,extract(epoch FROM now())::bigint,$2,receive_address,$3,'confirmed' FROM invoices WHERE id = $1`, id, aliceWallet, units)
	e.exec(t, `WITH journal AS (INSERT INTO ledger_transactions (invoice_id,kind,chain_transfer_id) SELECT invoice_id,'deposit',id FROM chain_transfers WHERE invoice_id = $1 RETURNING id)
 INSERT INTO ledger_entries (transaction_id,account,amount) SELECT id,'receiver',$2::numeric FROM journal UNION ALL SELECT id,'recipient_payable',-$2::numeric FROM journal`, id, units)
	rows := e.call(t, "GET", base+"/payments/"+id+"/movements", alice, "", "")
	if rows.status != http.StatusOK {
		t.Fatalf("movements: %d %v", rows.status, rows.body)
	}
	row := rows.body["items"].([]any)[0].(map[string]any)
	if row["receiverDelta"] != units || row["receiverUsdDelta"] != "10.000000000000000007" {
		t.Fatalf("precision lost: %v", row)
	}
	e.exec(t, `INSERT INTO chain_transfers (chain_id,chain_family,token_contract,invoice_id,tx_hash,log_index,block_hash,block_number,block_time,from_address,to_address,amount,status)
 SELECT i.chain_id,i.chain_family,i.token_contract,i.id,'0x'||lpad(to_hex(n),64,'0'),0,'0x'||lpad(to_hex(n),64,'0'),101,extract(epoch FROM now())::bigint,$2,i.receive_address,1,'detected'
 FROM invoices i CROSS JOIN generate_series(1,9999) n WHERE i.id = $1`, id, aliceWallet)
	export := e.call(t, "GET", base+"/payments/"+id+"/movements.csv", alice, "", "")
	if export.status != http.StatusOK {
		t.Fatalf("10000 rows: %d %v", export.status, export.body)
	}
	records, err := csv.NewReader(strings.NewReader(export.raw)).ReadAll()
	if err != nil || len(records) != 10001 {
		t.Fatalf("bounded row count %d, %v", len(records), err)
	}
	e.exec(t, `INSERT INTO chain_transfers (chain_id,chain_family,token_contract,invoice_id,tx_hash,log_index,block_hash,block_number,block_time,from_address,to_address,amount,status)
 SELECT chain_id,chain_family,token_contract,id,'0x'||repeat('d',64),0,'0x'||repeat('d',64),101,extract(epoch FROM now())::bigint,$2,receive_address,1,'detected' FROM invoices WHERE id = $1`, id, aliceWallet)
	if tooMany := e.call(t, "GET", base+"/payments/"+id+"/movements.csv", alice, "", ""); tooMany.status != http.StatusUnprocessableEntity || errorCode(tooMany) != "too_many_movements" {
		t.Fatalf("unbounded export: %d %v", tooMany.status, tooMany.body)
	}
	detail := e.call(t, "GET", base+"/payments/"+id, alice, "", "")
	option := detail.body["options"].([]any)[0].(map[string]any)
	if option["depositsTruncated"] != true || len(option["deposits"].([]any)) != 100 {
		t.Fatalf("unbounded detail: %v", option)
	}
}

func TestPaymentMovementAllocationKeepsNoTransferIdentity(t *testing.T) {
	e := invoiceAPI(t)
	const alice = "did:privy:alice"
	shop := e.merchant(t)
	made := e.post(t, alice, shop, "reopen", `{"chainId":84532,"token":"`+usdc+`","amount":"2000000"}`)
	if made.status != http.StatusCreated {
		t.Fatalf("create: %d %v", made.status, made.body)
	}
	id := made.body["invoiceId"].(string)
	e.deposit(t, id, "1000000")
	e.exec(t, `WITH journal AS (INSERT INTO ledger_transactions (invoice_id,kind) VALUES ($1,'expiry') RETURNING id)
      INSERT INTO ledger_entries (transaction_id,account,amount) SELECT id,'recipient_payable',1000000 FROM journal UNION ALL SELECT id,'payer_held',-1000000 FROM journal`, id)
	e.exec(t, `WITH journal AS (INSERT INTO ledger_transactions (invoice_id,kind,chain_transfer_id) SELECT $1,'reopen',id FROM chain_transfers WHERE invoice_id = $1 RETURNING id)
      INSERT INTO ledger_entries (transaction_id,account,amount) SELECT id,'recipient_payable',-1000000 FROM journal UNION ALL SELECT id,'payer_held',1000000 FROM journal`, id)
	movements := e.call(t, "GET", "/v1/profiles/"+shop+"/payments/"+id+"/movements", alice, "", "")
	if movements.status != http.StatusOK {
		t.Fatalf("movements: %d %v", movements.status, movements.body)
	}
	found := false
	for _, entry := range movements.body["items"].([]any) {
		row := entry.(map[string]any)
		if row["kind"] != "reopen" {
			continue
		}
		found = true
		if row["blockNumber"] != nil || row["blockHash"] != nil || row["txHash"] != nil || row["logIndex"] != nil || row["transferLogIndex"] != nil || row["blockTime"] != nil || row["sourceAmount"] != nil || row["receiverDelta"] != "0" {
			t.Fatalf("allocation reused old transfer identity: %v", row)
		}
	}
	if !found {
		t.Fatal("reopen allocation missing")
	}
}

func TestPaymentVerificationWaitsForExplainedSourcesAndAutomaticRescans(t *testing.T) {
	e := invoiceAPI(t)
	const alice = "did:privy:alice"
	shop := e.merchant(t)
	made := e.post(t, alice, shop, "pending-proof", `{"chainId":84532,"token":"`+usdc+`","amount":"2000000"}`)
	if made.status != http.StatusCreated {
		t.Fatalf("create: %d %v", made.status, made.body)
	}
	id := made.body["invoiceId"].(string)
	base := "/v1/profiles/" + shop
	e.exec(t, `INSERT INTO chain_transfers (chain_id,chain_family,token_contract,invoice_id,tx_hash,log_index,block_hash,block_number,block_time,from_address,to_address,amount,status)
 SELECT chain_id,chain_family,token_contract,id,id,0,id,90,extract(epoch FROM now())::bigint,$2,receive_address,1000000,'confirmed' FROM invoices WHERE id=$1`, id, aliceWallet)
	check := func(want string) {
		t.Helper()
		got := e.call(t, "GET", base+"/payments/"+id, alice, "", "")
		if got.status != http.StatusOK {
			t.Fatalf("detail: %d %v", got.status, got.body)
		}
		amounts := got.body["amounts"].(map[string]any)
		if amounts["reconciliationStatus"] != want || amounts["unreconciled"] != true {
			t.Fatalf("verification classification: %v, want %s with safety gate retained", amounts, want)
		}
		if want == "pending" {
			attention := e.call(t, "GET", base+"/payments/attention", alice, "", "")
			if attention.status != http.StatusOK {
				t.Fatalf("attention: %d %v", attention.status, attention.body)
			}
			for _, entry := range attention.body["items"].([]any) {
				for _, issue := range entry.(map[string]any)["problems"].([]any) {
					if issue.(map[string]any)["action"] != "wait" {
						t.Fatalf("automatic verification asks for manual review: %v", issue)
					}
				}
			}
		}
	}
	check("pending")
	e.exec(t, `INSERT INTO receiver_outflows (invoice_id,chain_id,receiver_address,token_contract,kind,destination,amount,tx_hash,log_index,transfer_log_index,block_hash,block_number,block_time,verified_block,reconciliation_error)
 SELECT id,chain_id,receive_address,token_contract,'refund',$2,500000,'0x'||repeat('a',64),1,0,'0x'||repeat('a',64),91,extract(epoch FROM now())::bigint,100,'awaiting_booking' FROM invoices WHERE id=$1`, id, aliceWallet)
	check("pending")
	e.exec(t, `INSERT INTO receiver_outflows (invoice_id,chain_id,receiver_address,token_contract,kind,destination,amount,tx_hash,log_index,block_hash,block_number,block_time,verified_block,reconciliation_error)
 SELECT id,chain_id,receive_address,'0x'||repeat('0',40),'recovery',$2,1,'0x'||repeat('c',64),2,'0x'||repeat('c',64),92,extract(epoch FROM now())::bigint,100,'different_asset' FROM invoices WHERE id=$1`, id, aliceWallet)
	check("pending")
	e.exec(t, "INSERT INTO invoice_balance_alerts (invoice_id, alerts, next_check_at) VALUES ($1, 1, now())", id)
	check("review")
	e.exec(t, "DELETE FROM invoice_balance_alerts WHERE invoice_id=$1", id)
	check("pending")
	e.exec(t, "UPDATE receiver_outflows SET reconciliation_error='unexplained_outflow' WHERE invoice_id=$1 AND kind='refund'", id)
	check("review")
}

func TestPaymentSummaryOmitsUnusedOptionsWithoutCertifyingTheirHistory(t *testing.T) {
	e := invoiceAPI(t)
	const alice = "did:privy:alice"
	shop := e.merchant(t)
	made := e.post(t, alice, shop, "many-options", `{"chainId":84532,"token":"`+usdc+`","amount":"2000000"}`)
	if made.status != http.StatusCreated {
		t.Fatalf("create: %d %v", made.status, made.body)
	}
	id := made.body["invoiceId"].(string)
	e.exec(t, `INSERT INTO invoices (id,main_id,profile_id,chain_id,chain_family,token_contract,amount,
 expires_at,settle_deadline,recipient_address,receive_method,factory_address,receive_address,idempotency_key,request_hash)
 SELECT '0x'||repeat(md5(n::text),2),i.id,profile_id,chain_id,chain_family,token_contract,amount,
 expires_at,settle_deadline,recipient_address,receive_method,factory_address,'0x'||lpad(to_hex(n),40,'0'),idempotency_key,request_hash
 FROM invoices i CROSS JOIN generate_series(1,299) n WHERE i.id=$1`, id)
	path := "/v1/profiles/" + shop + "/payments/" + id
	start := time.Now()
	full := e.call(t, "GET", path, alice, "", "")
	fullElapsed := time.Since(start)
	start = time.Now()
	summary := e.call(t, "GET", path+"?view=summary", alice, "", "")
	if full.status != http.StatusOK || summary.status != http.StatusOK {
		t.Fatalf("full=%d summary=%d: %v", full.status, summary.status, summary.body)
	}
	bill := e.call(t, "GET", "/v1/profiles/"+shop+"/invoices/"+id+"?view=summary", alice, "", "")
	if bill.status != http.StatusOK || len(bill.body["options"].([]any)) != 1 || bill.body["optionCount"] != float64(300) {
		t.Fatalf("billing summary: %v", bill.body)
	}
	if len(full.body["options"].([]any)) != 300 || len(summary.body["options"].([]any)) != 1 {
		t.Fatal("summary still includes unused option diagnostics")
	}
	fullJSON, _ := json.Marshal(full.body)
	summaryJSON, _ := json.Marshal(summary.body)
	t.Logf("300 options: full bytes=%d elapsed=%s; summary bytes=%d elapsed=%s", len(fullJSON), fullElapsed, len(summaryJSON), time.Since(start))
	amounts := summary.body["amounts"].(map[string]any)
	if amounts["reconciliationStatus"] != "verified" || amounts["unreconciled"] != false {
		t.Fatalf("a payment with no movement has nothing to reconcile: %v", amounts)
	}
	attention := e.call(t, "GET", "/v1/profiles/"+shop+"/payments/attention", alice, "", "")
	if attention.status != http.StatusOK || len(attention.body["items"].([]any)) != 0 {
		t.Fatalf("unused history created merchant warnings: %v", attention.body)
	}
	var other string
	if err := e.pool.QueryRow(t.Context(), "SELECT id FROM invoices WHERE main_id=$1 ORDER BY id LIMIT 1", id).Scan(&other); err != nil {
		t.Fatal(err)
	}
	e.exec(t, `INSERT INTO chain_transfers (chain_id,chain_family,token_contract,invoice_id,tx_hash,log_index,block_hash,block_number,block_time,from_address,to_address,amount,status)
 SELECT chain_id,chain_family,token_contract,id,id,0,id,90,extract(epoch FROM now())::bigint,$2,receive_address,1000000,'confirmed' FROM invoices WHERE id=$1`, other, aliceWallet)
	summary = e.call(t, "GET", path+"?view=summary", alice, "", "")
	if summary.status != http.StatusOK || len(summary.body["options"].([]any)) != 2 {
		t.Fatalf("summary hid money on another option: %v", summary.body)
	}
	for _, response := range []map[string]any{
		summary.body,
		e.call(t, "GET", "/v1/profiles/"+shop+"/payments?status=confirming", alice, "", "").body["items"].([]any)[0].(map[string]any),
	} {
		receipts := response["receipts"].([]any)
		if len(receipts) != 1 {
			t.Fatalf("receipts: %v", receipts)
		}
		receipt := receipts[0].(map[string]any)
		if receipt["optionId"] != other || receipt["received"] != "1000000" || receipt["pending"] != "1000000" {
			t.Fatalf("observed money lost or attributed to unused option: %v", receipt)
		}
		if response["paymentStatus"] == "paid" || response["amounts"].(map[string]any)["payable"] != "0" || response["confirming"] != true {
			t.Fatalf("uncredited money treated as paid: %v", response)
		}
	}
	e.exec(t, "UPDATE chain_transfers SET status='reorged' WHERE invoice_id=$1", other)
	after := e.call(t, "GET", path+"?view=summary", alice, "", "")
	if len(after.body["receipts"].([]any)) != 0 {
		t.Fatalf("reorged receipt remains: %v", after.body["receipts"])
	}

}

func TestPaymentSearchKeepsPaginationAndProfileScope(t *testing.T) {
	e := invoiceAPI(t)
	const alice = "did:privy:alice"
	shop := e.merchant(t)
	store := storeIDs(t, e, shop)[0]
	base := "/v1/profiles/" + shop
	for n := range 3 {
		reference := "order-" + string(rune('a'+n))
		r := e.call(t, "POST", base+"/checkout-sessions", alice, reference,
			`{"storeId":"`+store+`","amountUsd":"2","reference":"`+reference+`","customer":{"name":"Mara","email":"mara@example.com"}}`)
		if r.status != http.StatusCreated {
			t.Fatal(r.body)
		}
	}
	for _, q := range []string{"order-", "MARA", "mara%40example", "2.00"} {
		var cursor string
		seen := map[string]bool{}
		for range 3 {
			path := base + "/payments?q=" + q + "&limit=1"
			if cursor != "" {
				path += "&cursor=" + cursor
			}
			r := e.call(t, "GET", path, alice, "", "")
			if r.status != http.StatusOK {
				t.Fatal(r.body)
			}
			items := r.body["items"].([]any)
			if len(items) != 1 {
				t.Fatalf("%s: %v", q, r.body)
			}
			id := items[0].(map[string]any)["paymentId"].(string)
			if seen[id] {
				t.Fatalf("repeated page: %s", id)
			}
			seen[id] = true
			cursor, _ = r.body["nextCursor"].(string)
		}
		if cursor != "" {
			t.Fatal("extra page")
		}
	}
	for _, path := range []string{base + "/payments?q=no-match", "/v1/profiles/" + e.aliceProfile + "/payments?q=Mara"} {
		r := e.call(t, "GET", path, alice, "", "")
		if r.status != http.StatusOK || len(r.body["items"].([]any)) != 0 {
			t.Fatal(r.body)
		}
	}
	for _, q := range []string{"", "%00", strings.Repeat("a", 101)} {
		if r := e.call(t, "GET", base+"/payments?q="+q, alice, "", ""); r.status != http.StatusUnprocessableEntity {
			t.Fatalf("invalid search: %d", r.status)
		}
	}
}

// D-114: one state and one wallet vocabulary for list, detail and both filters.
func TestPaymentStateAndWalletAgreeAcrossReadsAndFilters(t *testing.T) {
	e := invoiceAPIWith(t, 200, webhookKey)
	const alice = "did:privy:alice"
	shop := e.merchant(t)
	store := storeIDs(t, e, shop)[0]
	base := "/v1/profiles/" + shop
	checkout := func(key string) string {
		t.Helper()
		made := e.call(t, "POST", base+"/checkout-sessions", alice, key, `{"storeId":"`+store+`","amountUsd":"2"}`)
		if made.status != http.StatusCreated {
			t.Fatalf("checkout %s: %d %v", key, made.status, made.body)
		}
		return made.body["sessionId"].(string)
	}
	paid := func(key, amount string) string {
		t.Helper()
		id := checkout(key)
		e.deposit(t, id, amount)
		return id
	}
	want := map[string][2]string{} // state, wallet
	want[checkout("waiting")] = [2]string{"waiting", "none"}
	detected := checkout("detected")
	e.exec(t, `INSERT INTO chain_transfers(chain_id,chain_family,token_contract,invoice_id,tx_hash,log_index,block_hash,
 block_number,block_time,from_address,to_address,amount,status)
 SELECT chain_id,chain_family,token_contract,id,'0x'||repeat('ab',32),0,'0x'||repeat('cd',32),100,closes_at-1,
 receive_address,receive_address,1,'detected' FROM invoices WHERE id=$1`, detected)
	want[detected] = [2]string{"confirming", "none"}
	partial := paid("partial", "1000000")
	want[partial] = [2]string{"partially_paid", "none"}

	// The rest arrives and is credited, but the finalized balance shows only the first half: not paid yet.
	awaiting := paid("awaiting", "1000000")
	e.exec(t, `INSERT INTO chain_transfers (chain_id, chain_family, token_contract, invoice_id, tx_hash, log_index,
  block_hash, block_number, block_time, from_address, to_address, amount, status)
  SELECT chain_id, chain_family, token_contract, id, '0x'||repeat('ef',32), 0, '0x'||repeat('ef',32), 91,
  extract(epoch FROM now())::bigint, $2, receive_address, 1000000, 'confirmed' FROM invoices WHERE id = $1`, awaiting, aliceWallet)
	short := func(context.Context, uint64, string, string) (*big.Int, uint64, error) {
		return big.NewInt(1000000), 100, nil
	}
	notDeployed := func(context.Context, uint64, string, string) (uint64, error) { return 0, nil }
	if err := ledger.NewService(e.pool, short, notDeployed).Process(t.Context(), awaiting); err != nil {
		t.Fatal(err)
	}
	// Verified history leaves only the balance check, a normal wait.
	want[awaiting] = [2]string{"confirming", "none"}

	want[paid("paid", "2000000")] = [2]string{"paid", "pending"}
	overpaid := paid("overpaid", "2500000")
	want[overpaid] = [2]string{"overpaid", "pending"}
	delayed := paid("delayed", "2000000")
	e.exec(t, `UPDATE settlement_intents SET wait = 'cap', next_attempt_at = now() + interval '1 hour' WHERE invoice_id = $1`, delayed)
	want[delayed] = [2]string{"paid", "delayed"}
	refused := paid("refused", "2000000")
	e.exec(t, `UPDATE settlement_intents SET status = 'refused' WHERE invoice_id = $1`, refused)
	want[refused] = [2]string{"paid", "refused"}
	settled := paid("settled", "2000000")
	e.exec(t, `UPDATE invoices SET settlement_status = 'settled' WHERE id = $1`, settled)
	want[settled] = [2]string{"paid", "in_wallet"}

	expiredByAction := checkout("expired-by-action")
	if r := e.call(t, "POST", base+"/checkout-sessions/"+expiredByAction+"/expire", alice, "", ""); r.status != http.StatusOK ||
		r.body["status"] != "expired" || r.body["payment"].(map[string]any)["state"] != "expired" {
		t.Fatalf("expire: %d %v", r.status, r.body)
	}
	want[expiredByAction] = [2]string{"expired", "none"}
	closed := checkout("closed")
	e.closeCheckout(t, closed)
	want[closed] = [2]string{"expired", "none"}
	bill := e.post(t, alice, shop, "bill", `{"chainId":84532,"token":"`+usdc+`","amount":"2000000","storeId":"`+store+`"}`)
	if bill.status != http.StatusCreated {
		t.Fatalf("bill: %d %v", bill.status, bill.body)
	}
	canceled := bill.body["invoiceId"].(string)
	if r := e.call(t, "POST", base+"/invoices/"+canceled+"/cancel", alice, "", ""); r.status != http.StatusOK {
		t.Fatalf("cancel: %d %v", r.status, r.body)
	}
	want[canceled] = [2]string{"canceled", "none"}

	list := e.call(t, "GET", base+"/payments?limit=100", alice, "", "")
	if list.status != http.StatusOK || len(list.body["items"].([]any)) != len(want) {
		t.Fatalf("list: %d %v", list.status, list.body)
	}
	byID := map[string]map[string]any{}
	for _, item := range list.body["items"].([]any) {
		row := item.(map[string]any)
		byID[row["paymentId"].(string)] = row
	}
	for id, w := range want {
		detail := e.call(t, "GET", base+"/payments/"+id, alice, "", "")
		for name, read := range map[string]map[string]any{"list": byID[id], "detail": detail.body} {
			if read["state"] != w[0] || read["wallet"] != w[1] {
				t.Errorf("%s of %s reads %v/%v, want %v", name, id, read["state"], read["wallet"], w)
			}
		}
	}
	for column, filter := range []string{"state", "wallet"} {
		values := invoice.PaymentStates
		if filter == "wallet" {
			values = invoice.WalletStates
		}
		for _, value := range values {
			r := e.call(t, "GET", base+"/payments?limit=100&"+filter+"="+value, alice, "", "")
			if r.status != http.StatusOK {
				t.Fatalf("%s=%s: %d %v", filter, value, r.status, r.body)
			}
			for id, w := range want {
				if containsPayment(r, id) != (w[column] == value) {
					t.Errorf("%s=%s gets %s wrong, which reads %v", filter, value, id, w)
				}
			}
		}
	}
	for _, bad := range []string{"state=open", "state=settled", "wallet=settled", "wallet=held"} {
		if r := e.call(t, "GET", base+"/payments?"+bad, alice, "", ""); r.status != http.StatusUnprocessableEntity {
			t.Fatalf("%s: %d", bad, r.status)
		}
	}

	if read := byID[awaiting]; read["paymentStatus"] != "partially_paid" || read["confirming"] != true ||
		read["amounts"].(map[string]any)["payable"] != "2000000" {
		t.Fatalf("credited payment awaiting the balance check: %v", read)
	}
	if r := e.call(t, "GET", base+"/payments?status=confirming", alice, "", ""); !containsPayment(r, awaiting) {
		t.Fatalf("status=confirming misses the payment awaiting its balance check: %v", r.body)
	}
	for _, problem := range e.call(t, "GET", base+"/payments/"+awaiting, alice, "", "").body["problems"].([]any) {
		if problem.(map[string]any)["code"] == "partial_payment" {
			t.Fatalf("nothing is left to pay, yet: %v", problem)
		}
	}
	if r := e.call(t, "GET", base+"/payments/attention", alice, "", ""); containsPayment(r, awaiting) || !containsPayment(r, partial) {
		t.Fatalf("attention should list only the partial payment with money still owed: %v", r.body)
	}
	if byID[expiredByAction]["paymentStatus"] != "canceled" {
		t.Fatalf("the raw status of an expired checkout changed: %v", byID[expiredByAction])
	}
	if receipts := byID[overpaid]["receipts"].([]any); len(receipts) != 1 || receipts[0].(map[string]any)["held"] != "500000" {
		t.Fatalf("held money missing from receipts: %v", receipts)
	}
}

func containsPayment(r reply, id string) bool {
	items, _ := r.body["items"].([]any)
	for _, item := range items {
		if item.(map[string]any)["paymentId"] == id {
			return true
		}
	}
	return false
}

// Money held on an option the payer did not choose makes a paid payment overpaid, though the chosen option holds none.
func TestPaymentHeldOnAnotherOptionAndLookupByNumberHashAddressOrReference(t *testing.T) {
	e := invoiceAPI(t)
	const alice = "did:privy:alice"
	shop := e.merchant(t)
	store := storeIDs(t, e, shop)[0]
	base := "/v1/profiles/" + shop
	due := time.Now().UTC().AddDate(0, 0, 10).Format(time.DateOnly)
	bill := e.post(t, alice, shop, "two-options", `{"chainId":84532,"token":"`+usdc+`","amount":"2000000","storeId":"`+store+
		`","reference":"PO-77","dueDate":"`+due+`","lines":[{"description":"Logo","quantity":"2","unitPrice":"1000000"}]}`)
	if bill.status != http.StatusCreated {
		t.Fatalf("bill: %d %v", bill.status, bill.body)
	}
	id := bill.body["invoiceId"].(string)
	e.exec(t, `INSERT INTO invoices (id,main_id,profile_id,chain_id,chain_family,token_contract,amount,
 expires_at,settle_deadline,recipient_address,receive_method,factory_address,receive_address,idempotency_key,request_hash)
 SELECT '0x'||repeat('77',32),i.id,profile_id,chain_id,chain_family,token_contract,amount,
 expires_at,settle_deadline,recipient_address,receive_method,factory_address,'0x'||repeat('7a',20),idempotency_key,request_hash
 FROM invoices i WHERE i.id=$1`, id)
	other, otherAddress, hash := "0x"+strings.Repeat("77", 32), "0x"+strings.Repeat("7A", 20), "0x"+strings.Repeat("e1", 32)
	e.deposit(t, id, "2000000")
	e.exec(t, `INSERT INTO chain_transfers (chain_id, chain_family, token_contract, invoice_id, tx_hash, log_index,
  block_hash, block_number, block_time, from_address, to_address, amount, status)
  SELECT chain_id, chain_family, token_contract, id, $2, 0, $2, 92, extract(epoch FROM now())::bigint, $3, receive_address,
  700000, 'confirmed' FROM invoices WHERE id = $1`, other, hash, aliceWallet)
	balances := func(context.Context, uint64, string, string) (*big.Int, uint64, error) {
		return big.NewInt(700000), 100, nil
	}
	notDeployed := func(context.Context, uint64, string, string) (uint64, error) { return 0, nil }
	if err := ledger.NewService(e.pool, balances, notDeployed).Process(t.Context(), other); err != nil {
		t.Fatal(err)
	}

	detail := e.call(t, "GET", base+"/payments/"+id+"?view=summary", alice, "", "")
	if detail.status != http.StatusOK || detail.body["paymentStatus"] != "paid" || detail.body["refundStatus"] != "none" ||
		detail.body["state"] != "overpaid" {
		t.Fatalf("held money on the other option: %d %v", detail.status, detail.body)
	}
	held := map[string]string{}
	for _, receipt := range detail.body["receipts"].([]any) {
		r := receipt.(map[string]any)
		held[r["optionId"].(string)] = r["held"].(string)
	}
	if held[id] != "0" || held[other] != "700000" {
		t.Fatalf("held per option: %v", held)
	}
	items := detail.body["items"].([]any)
	if detail.body["dueDate"] != due || detail.body["number"] == nil || len(items) != 1 ||
		items[0].(map[string]any)["unitPrice"] != "1000000" || items[0].(map[string]any)["amount"] != "2000000" {
		t.Fatalf("detail document fields: %v", detail.body)
	}

	number := fmt.Sprintf("INV-%04d", int(detail.body["number"].(float64)))
	for _, query := range []string{"q=" + number, "q=" + hash, "q=" + otherAddress, "reference=PO-77"} {
		if r := e.call(t, "GET", base+"/payments?"+query, alice, "", ""); r.status != http.StatusOK ||
			len(r.body["items"].([]any)) != 1 || !containsPayment(r, id) {
			t.Fatalf("%s: %d %v", query, r.status, r.body)
		}
	}
	for _, path := range []string{base + "/payments?reference=PO-7", base + "/payments?q=0x" + strings.Repeat("e2", 32),
		"/v1/profiles/" + e.aliceProfile + "/payments?q=" + hash} {
		if r := e.call(t, "GET", path, alice, "", ""); r.status != http.StatusOK || len(r.body["items"].([]any)) != 0 {
			t.Fatalf("%s: %d %v", path, r.status, r.body)
		}
	}
}
