package tests

import (
	"encoding/csv"
	"math/big"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/forwend/forwend/apps/backend/internal/ledger/ledgertest"
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
	ledgertest.Checkpoint(t, e.pool, partial, 100, time.Now().Unix()+1, "1000000")
	endpoint := "33000000-0000-4000-8000-000000000002"
	if got := e.call(t, "PUT", base+"/webhooks/"+endpoint, alice, "", `{"url":"https://merchant.example/hooks","events":["invoice.paid"],"storeId":"`+first+`"}`); got.status != http.StatusCreated {
		t.Fatalf("webhook: %d %v", got.status, got.body)
	}
	paid := makePayment("held")
	e.deposit(t, paid, "2500000")
	ledgertest.Checkpoint(t, e.pool, paid, 100, time.Now().Unix()+1, "2500000")
	e.exec(t, `UPDATE webhook_deliveries d SET status = 'failed', attempts = 1 FROM webhook_events e
   WHERE d.event_id = e.id AND e.invoice_id = $1`, paid)
	e.exec(t, `INSERT INTO webhook_attempts (endpoint_id,event_id,status_code,error,duration_ms)
   SELECT endpoint_id,event_id,503,'upstream unavailable',12 FROM webhook_deliveries WHERE endpoint_id = $1`, endpoint)
	e.exec(t, "UPDATE webhook_endpoints SET enabled = false WHERE id = $1", endpoint)
	detail := e.call(t, "GET", base+"/payments/"+paid, alice, "", "")
	if detail.status != http.StatusOK || detail.body["paymentStatus"] != "paid" || detail.body["settlementStatus"] != "pending" || detail.body["snapshotAt"] == nil {
		t.Fatalf("detail conflated delivery/payment: %d %v", detail.status, detail.body)
	}
	options, ok := detail.body["options"].([]any)
	if !ok || len(options) != 1 {
		t.Fatalf("option accounting missing: %v", detail.body)
	}
	option := options[0].(map[string]any)
	amounts := option["amounts"].(map[string]any)
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
	if asset["closing"].(map[string]any)["receiver"] != "2500000" || asset["checkpointDifference"] != "0" {
		t.Fatalf("reconciliation totals: %v", asset)
	}
	coverage := option["coverage"].(map[string]any)
	if coverage["historyComplete"] != true || coverage["balanceDifference"] != "0" || len(option["deposits"].([]any)) != 1 {
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
	ledgertest.Checkpoint(t, e.pool, id, 100, time.Now().Unix()+1, "2300000")
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
	if asset["opening"].(map[string]any)["receiver"] != "3000000" || asset["changes"].(map[string]any)["receiver"] != "-500000" || asset["closing"].(map[string]any)["receiver"] != total.String() || asset["checkpointDifference"] != "-200000" || asset["unbookedOutflows"] != float64(1) || asset["refunded"] != "500000" {
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
	ledgertest.Checkpoint(t, e.pool, id, 100, time.Now().Unix()+1, units)
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

func TestPaymentMovementEvidenceKeepsAllocationsAndUnknownCashSourcesDistinct(t *testing.T) {
	for _, scenario := range []string{"reopen", "unknown_refund"} {
		t.Run(scenario, func(t *testing.T) {
			e := invoiceAPI(t)
			const alice = "did:privy:alice"
			shop := e.merchant(t)
			made := e.post(t, alice, shop, scenario, `{"chainId":84532,"token":"`+usdc+`","amount":"2000000"}`)
			if made.status != http.StatusCreated {
				t.Fatalf("create: %d %v", made.status, made.body)
			}
			id := made.body["invoiceId"].(string)
			e.deposit(t, id, "1000000")
			ledgertest.Checkpoint(t, e.pool, id, 100, time.Now().Unix()+1, "1000000")
			base := "/v1/profiles/" + shop + "/payments/" + id
			if scenario == "reopen" {
				e.exec(t, `WITH journal AS (INSERT INTO ledger_transactions (invoice_id,kind) VALUES ($1,'expiry') RETURNING id)
      INSERT INTO ledger_entries (transaction_id,account,amount) SELECT id,'recipient_payable',1000000 FROM journal UNION ALL SELECT id,'payer_held',-1000000 FROM journal`, id)
				e.exec(t, `WITH journal AS (INSERT INTO ledger_transactions (invoice_id,kind,chain_transfer_id) SELECT $1,'reopen',id FROM chain_transfers WHERE invoice_id = $1 RETURNING id),
      checkpoint AS (INSERT INTO ledger_checkpoints (transaction_id,block_number,block_hash) SELECT id,110,'0x'||repeat('c',64) FROM journal)
      INSERT INTO ledger_entries (transaction_id,account,amount) SELECT id,'recipient_payable',-1000000 FROM journal UNION ALL SELECT id,'payer_held',1000000 FROM journal`, id)
				movements := e.call(t, "GET", base+"/movements", alice, "", "")
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
					if row["blockNumber"] != float64(110) || row["blockHash"] != "0x"+strings.Repeat("c", 64) || row["txHash"] != nil || row["logIndex"] != nil || row["transferLogIndex"] != nil || row["blockTime"] != nil || row["sourceAmount"] != nil || row["receiverDelta"] != "0" {
						t.Fatalf("allocation reused old transfer identity: %v", row)
					}
				}
				if !found {
					t.Fatal("reopen allocation missing")
				}
				return
			}
			e.exec(t, `WITH journal AS (INSERT INTO ledger_transactions (invoice_id,kind) VALUES ($1,'refund') RETURNING id)
      INSERT INTO ledger_entries (transaction_id,account,amount) SELECT id,'receiver',-100000 FROM journal UNION ALL SELECT id,'recipient_payable',100000 FROM journal`, id)
			detail := e.call(t, "GET", base, alice, "", "")
			option := detail.body["options"].([]any)[0].(map[string]any)
			if option["coverage"].(map[string]any)["balanceDifference"] != nil || option["amounts"].(map[string]any)["unreconciled"] != true {
				t.Fatalf("unknown cash position compared to checkpoint: %v", option)
			}
			summary := e.call(t, "GET", base+"/reconciliation", alice, "", "")
			asset := summary.body["assets"].([]any)[0].(map[string]any)
			if asset["checkpointBalance"] != nil || asset["checkpointDifference"] != nil || asset["unreconciledReceivers"] != float64(1) {
				t.Fatalf("unknown source omitted: %v", asset)
			}
			movements := e.call(t, "GET", base+"/movements", alice, "", "")
			refunds := 0
			for _, entry := range movements.body["items"].([]any) {
				row := entry.(map[string]any)
				if row["kind"] == "refund" {
					refunds++
				}
				if row["kind"] == "refund" && (row["sourceAmount"] != nil || row["to"] != nil || row["from"] != nil || row["txHash"] != nil || row["verified"] != false || row["receiverDelta"] != "-100000") {
					t.Fatalf("unknown refund source fabricated: %v", row)
				}
			}
			if refunds != 1 {
				t.Fatalf("unknown refund journal missing: %v", movements.body)
			}
		})
	}
}
