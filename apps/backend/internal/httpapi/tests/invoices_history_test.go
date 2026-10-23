package tests

import (
	"net/http"
	"reflect"
	"strings"
	"testing"
)

// R-124.
func TestOwnerReadsTheInvoiceHistory(t *testing.T) {
	e := invoiceAPI(t)
	id := e.post(t, "did:privy:alice", e.aliceProfile, "key-1", basicBody).body["invoiceId"].(string)
	hash := "0x" + strings.Repeat("ab", 32)
	e.exec(t, `INSERT INTO history_events (invoice_id, kind, actor, data) VALUES ($1, 'invoice.held', 'system', $2)`,
		id, `{"option": "`+id+`", "amount": "5", "txHash": "`+hash+`"}`)
	r := e.call(t, "POST", "/v1/profiles/"+e.aliceProfile+"/invoices/"+id+"/cancel", "did:privy:alice", "", "")
	if r.status != http.StatusOK {
		t.Fatalf("cancel: %d %v", r.status, r.body)
	}
	r = e.call(t, "GET", "/v1/profiles/"+e.aliceProfile+"/invoices/"+id, "did:privy:alice", "", "")
	var got []any
	for _, row := range r.body["history"].([]any) {
		h := row.(map[string]any)
		if h["at"] == nil || h["id"] == nil {
			t.Fatalf("row %v has no time or id", h)
		}
		delete(h, "at")
		delete(h, "id")
		got = append(got, h)
	}
	none := func(kind, actor string) map[string]any {
		return map[string]any{"kind": kind, "actor": actor, "optionId": nil, "amount": nil, "txHash": nil}
	}
	want := []any{none("invoice.canceled", "owner"),
		map[string]any{"kind": "invoice.held", "actor": "system", "optionId": id, "amount": "5", "txHash": hash},
		none("invoice.created", "owner")}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("history %v, want newest first %v", got, want)
	}
	if _, ok := e.get(t, id).body["history"]; ok {
		t.Fatal("the public read lists the history")
	}
}
