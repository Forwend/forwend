package tests

import (
	"context"
	"encoding/json"
	"net/http"
	"reflect"
	"testing"
	"time"

	"github.com/ensp1re/forwend/apps/backend/internal/history"
	"github.com/ensp1re/forwend/apps/backend/internal/history/historytest"
	"github.com/ensp1re/forwend/apps/backend/internal/httpapi/invoiceapi"
	"github.com/ensp1re/forwend/apps/backend/internal/invoice"
	"github.com/ensp1re/forwend/apps/backend/internal/webhook"
	"github.com/jackc/pgx/v5"
)

const allEvents = `["invoice.detected", "invoice.partially_paid", "invoice.paid", "invoice.settled", "invoice.expired",
	"invoice.canceled", "invoice.held"]`

// R-147: an endpoint takes its own profile's events of its types, and a store's endpoint only that store's.
func TestInvoiceChangesBecomeWebhookEvents(t *testing.T) {
	e := invoiceAPI(t)
	ctx := context.Background()
	const alice = "did:privy:alice"
	shop := e.merchant(t)
	first := storeIDs(t, e, shop)[0]
	if r := e.call(t, "PUT", "/v1/profiles/"+shop+"/stores/"+storeB, alice, "", `{"name": "Pro shop", "defaultExpiresIn": 3600}`); r.status !=
		http.StatusCreated {
		t.Fatalf("PUT store: %d %v", r.status, r.body)
	}
	for id, body := range map[string]string{
		shop + "/webhooks/cccccccc-0000-4000-8000-000000000001": `{"description": "all", "events": ` + allEvents + `}`,
		shop + "/webhooks/cccccccc-0000-4000-8000-000000000002": `{"description": "first store", "storeId": "` + first +
			`", "events": ["invoice.canceled"]}`,
		shop + "/webhooks/cccccccc-0000-4000-8000-000000000003": `{"description": "held", "events": ["invoice.held"]}`,
		shop + "/webhooks/cccccccc-0000-4000-8000-000000000004": `{"description": "off", "enabled": false,
			"events": ` + allEvents + `}`,
		e.aliceProfile + "/webhooks/cccccccc-0000-4000-8000-000000000005": `{"description": "freelancer",
			"events": ` + allEvents + `}`,
	} {
		if r := e.call(t, "PUT", "/v1/profiles/"+id, alice, "", `{"url": "https://hooks.example/", `+body[1:]); r.status !=
			http.StatusCreated {
			t.Fatalf("PUT %s: %d %v", id, r.status, r.body)
		}
	}

	canceled := e.post(t, alice, shop, "key-1", basicBody).body["invoiceId"].(string)
	if r := e.call(t, "POST", "/v1/profiles/"+shop+"/invoices/"+canceled+"/cancel", alice, "", ""); r.status !=
		http.StatusOK {
		t.Fatalf("cancel: %d %v", r.status, r.body)
	}
	pro := `"chainId": 84532, "token": "` + usdc + `", "amount": "5000000", "storeId": "` + storeB + `"`
	replaced := e.post(t, alice, shop, "key-2", `{`+pro+`}`).body["invoiceId"].(string)
	r := e.post(t, alice, shop, "key-3", `{`+pro+`, "replaces": "`+replaced+`"}`)
	if r.status != http.StatusCreated {
		t.Fatalf("revise: %d %v", r.status, r.body)
	}
	revised := r.body["invoiceId"].(string)
	// As the ledger and the signer write them.
	if err := pgx.BeginFunc(ctx, e.pool, func(tx pgx.Tx) error {
		if err := history.Add(ctx, tx, revised, history.Held, history.System,
			history.Data{Amount: "5", Reason: "overpaid"}); err != nil {
			return err
		}
		return history.Add(ctx, tx, revised, history.Settled, history.System, history.Data{})
	}); err != nil {
		t.Fatal(err)
	}
	for id, want := range map[string][]string{
		canceled: {"1 invoice.canceled to all,first store"},
		replaced: {"1 invoice.canceled to all"},
		revised:  {"1 invoice.held overpaid to all,held", "2 invoice.settled to all"},
	} {
		if got := historytest.Webhooks(t, e.pool, id); !reflect.DeepEqual(got, want) {
			t.Errorf("webhook events of %s\n got %q\nwant %q", id, got, want)
		}
	}

	// The body: the event and the invoice as its owner reads it.
	invoices := invoice.NewService(e.pool)
	events := webhook.NewService(e.pool, webhookKey)
	body := func(invoiceID string, sequence int) map[string]any {
		t.Helper()
		var id string
		if err := e.pool.QueryRow(ctx, "SELECT id FROM webhook_events WHERE invoice_id = $1 AND sequence = $2",
			invoiceID, sequence).Scan(&id); err != nil {
			t.Fatal(err)
		}
		ev, err := events.Event(ctx, id)
		if err != nil {
			t.Fatal(err)
		}
		inv, err := invoices.GetOfProfile(ctx, shop, invoiceID)
		if err != nil {
			t.Fatal(err)
		}
		raw, err := invoiceapi.EventBody(ev, inv)
		if err != nil {
			t.Fatal(err)
		}
		var out map[string]any
		if err := json.Unmarshal(raw, &out); err != nil {
			t.Fatal(err)
		}
		if out["id"] != id {
			t.Errorf("event id %v, want %s", out["id"], id)
		}
		if at, err := time.Parse(time.RFC3339, out["timestamp"].(string)); err != nil || time.Since(at) > time.Minute {
			t.Errorf("event timestamp %v", out["timestamp"])
		}
		return out
	}
	got := body(canceled, 1)
	invoiceData := got["data"].(map[string]any)["invoice"].(map[string]any)
	if got["type"] != "invoice.canceled" || got["livemode"] != false || got["sequence"] != float64(1) ||
		got["data"].(map[string]any)["held"] != nil || invoiceData["invoiceId"] != canceled ||
		invoiceData["paymentStatus"] != "canceled" || invoiceData["history"] == nil ||
		!reflect.DeepEqual(invoiceData["metadata"], map[string]any{}) {
		t.Errorf("the canceled event: %v", got)
	}
	got = body(revised, 1)
	if got["type"] != "invoice.held" || got["sequence"] != float64(1) || !reflect.DeepEqual(got["data"].(map[string]any)["held"],
		map[string]any{"amount": "5", "reason": "overpaid", "optionId": nil}) {
		t.Errorf("the held event: %v", got)
	}
}
