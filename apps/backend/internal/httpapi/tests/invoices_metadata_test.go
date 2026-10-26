package tests

import (
	"fmt"
	"net/http"
	"reflect"
	"strings"
	"testing"
)

// R-151, D-101: the creator's metadata, kept at create and returned only by the owner's reads.
func TestInvoiceMetadata(t *testing.T) {
	e := invoiceAPI(t)
	const alice = "did:privy:alice"
	withMetadata := func(metadata string) string {
		return `{"chainId": 84532, "token": "` + usdc + `", "amount": "5000000", "metadata": ` + metadata + `}`
	}
	made := e.post(t, alice, e.aliceProfile, "key-1", withMetadata(`{"order_id": "A-1001", "customer": "Zoë Ilić"}`))
	want := map[string]any{"order_id": "A-1001", "customer": "Zoë Ilić"}
	if made.status != http.StatusCreated || !reflect.DeepEqual(made.body["metadata"], want) {
		t.Fatalf("create: %d %v", made.status, made.body["metadata"])
	}
	id := made.body["invoiceId"].(string)
	owned := "/v1/profiles/" + e.aliceProfile + "/invoices"
	if r := e.call(t, "GET", owned+"/"+id, alice, "", ""); !reflect.DeepEqual(r.body["metadata"], want) {
		t.Errorf("the owner's read: %v", r.body["metadata"])
	}
	items, _ := e.call(t, "GET", owned, alice, "", "").body["items"].([]any)
	if len(items) != 1 || !reflect.DeepEqual(items[0].(map[string]any)["metadata"], want) {
		t.Errorf("the owner's list: %v", items)
	}
	// The pay page's answer and the PDFs show none of it.
	if r := e.get(t, id); r.status != http.StatusOK || r.body["metadata"] != nil {
		t.Errorf("the public read: %d, metadata %v", r.status, r.body["metadata"])
	}
	// The receipt is drawn from the same invoice once paid; neither takes the metadata.
	if pdf := e.pdf(t, id, "invoice.pdf", ""); pdf.status != http.StatusOK ||
		strings.Contains(pdfText(t, pdf.body), "A-1001") || strings.Contains(pdfText(t, pdf.body), "order_id") {
		t.Errorf("invoice.pdf: %d, shows the metadata", pdf.status)
	}

	// The same key and metadata, in another order, is the same invoice; other metadata is another request.
	if r := e.post(t, alice, e.aliceProfile, "key-1", withMetadata(`{"customer": "Zoë Ilić", "order_id": "A-1001"}`)); r.status !=
		http.StatusOK || r.body["invoiceId"] != id {
		t.Errorf("the same request again: %d %v", r.status, r.body["invoiceId"])
	}
	for _, other := range []string{basicBody, withMetadata(`{"order_id": "A-1002"}`)} {
		if r := e.post(t, alice, e.aliceProfile, "key-1", other); errorCode(r) != "idempotency_conflict" {
			t.Errorf("key-1 with %s: %d %v", other, r.status, r.body)
		}
	}
	plain := e.post(t, alice, e.aliceProfile, "key-2", basicBody)
	if plain.status != http.StatusCreated || !reflect.DeepEqual(plain.body["metadata"], map[string]any{}) {
		t.Errorf("no metadata: %d %v", plain.status, plain.body["metadata"])
	}

	many := make([]string, 21)
	for i := range many {
		many[i] = fmt.Sprintf(`"k%d": "v"`, i)
	}
	for i, bad := range []string{
		"{" + strings.Join(many, ", ") + "}",
		`{"has space": "v"}`, `{"": "v"}`, `{"` + strings.Repeat("k", 41) + `": "v"}`,
		// Characters, not bytes: 501 is one too many, however few bytes each takes.
		`{"long": "` + strings.Repeat("😀", 501) + `"}`, `{"long": "` + strings.Repeat("a", 501) + `"}`,
		`{"note": "two\nlines"}`, `{"count": 1}`, `{"nested": {"a": "b"}}`, `["a"]`, `"a"`,
	} {
		if r := e.post(t, alice, e.aliceProfile, fmt.Sprintf("bad-%d", i), withMetadata(bad)); errorCode(r) !=
			"invalid_value" {
			t.Errorf("metadata %.60s: %d %v", bad, r.status, r.body)
		}
	}
	for key, ok := range map[string]string{"key-20": "{" + strings.Join(many[:20], ", ") + "}",
		"key-500": `{"long": "` + strings.Repeat("😀", 500) + `"}`} {
		if r := e.post(t, alice, e.aliceProfile, key, withMetadata(ok)); r.status != http.StatusCreated {
			t.Errorf("%s: %d %v", key, r.status, r.body)
		}
	}
}
