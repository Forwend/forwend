package tests

import (
	"bytes"
	"context"
	"net/http"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/forwend/forwend/apps/backend/internal/webhook"
)

// webhookKey stands in for WEBHOOK_SECRET_KEY.
var webhookKey = bytes.Repeat([]byte{7}, 32)

var whsec = regexp.MustCompile(`^whsec_[A-Za-z0-9+/]{43}=$`)

// R-146, D-42, D-63.
func TestWebhookEndpoints(t *testing.T) {
	e := invoiceAPI(t)
	const alice = "did:privy:alice"
	shop := e.merchant(t)
	first := storeIDs(t, e, shop)[0]
	hooks := "/v1/profiles/" + shop + "/webhooks/"
	const id = "cccccccc-0000-4000-8000-000000000001"

	made := e.call(t, "PUT", hooks+id, alice, "", `{"url": "https://shop.example.com/hooks", "description": " Orders ",
		"events": ["invoice.settled", "invoice.paid", "invoice.paid"]}`)
	if made.status != http.StatusCreated || made.body["url"] != "https://shop.example.com/hooks" ||
		made.body["description"] != "Orders" || made.body["storeId"] != nil || made.body["enabled"] != true ||
		made.body["livemode"] != false || strings.Join(toStrings(made.body["events"]), ",") != "invoice.paid,invoice.settled" {
		t.Fatalf("a new endpoint: %d %v", made.status, made.body)
	}
	// The same id again replaces every field.
	if r := e.call(t, "PUT", hooks+id, alice, "", `{"url": "https://shop.example.com/v2", "storeId": "`+first+`",
		"events": ["invoice.held"], "enabled": false}`); r.status != http.StatusOK || r.body["storeId"] != first ||
		r.body["enabled"] != false || r.body["url"] != "https://shop.example.com/v2" {
		t.Fatalf("the endpoint saved again: %d %v", r.status, r.body)
	}
	for _, url := range []string{"http://shop.example.com/hooks", "https://localhost/hooks", "https://10.0.0.7/hooks",
		"https://169.254.169.254/latest", "https://[::1]/hooks", "https://[fd00:ec2::254]/", "https://100.64.0.1/",
		"https://user:pw@shop.example.com/", "https://printer.local/", "shop.example.com/hooks",
		// A resolver reads these as 127.0.0.1 or 0.0.0.0, or they reach a private address through IPv6.
		"https://localhost./", "https://printer.local./", "https://2130706433/", "https://127.1/", "https://0x7f000001/",
		"https://0177.0.0.1/", "https://0/", "https://ｌｏｃａｌｈｏｓｔ/", "https://[64:ff9b::a00:1]/",
		"https://[::127.0.0.1]/", "https://[2002:7f00:1::]/", "https://[fec0::1]/", "HTTPS://shop.example.com/"} {
		if r := e.call(t, "PUT", hooks+"cccccccc-0000-4000-8000-000000000002", alice, "", `{"url": "`+url+`",
			"events": ["invoice.paid"]}`); errorCode(r) != "invalid_value" {
			t.Errorf("url %s: %d %v", url, r.status, r.body)
		}
	}
	for body, code := range map[string]string{
		`{"url": "https://a.example/", "events": []}`:                                            "invalid_value",
		`{"url": "https://a.example/", "events": ["invoice.confirmed"]}`:                         "invalid_value",
		`{"url": "https://a.example/", "events": ["invoice.paid"], "storeId": "` + storeA + `"}`: "invalid_value",
	} {
		if r := e.call(t, "PUT", hooks+"cccccccc-0000-4000-8000-000000000002", alice, "", body); errorCode(r) != code {
			t.Errorf("PUT %s: %d %v, want %s", body, r.status, r.body, code)
		}
	}
	// Saving an endpoint, and revealing or rotating its secret, need a fresh sign-in (D-63).
	for _, c := range []struct{ method, path, body string }{
		{"PUT", hooks + id, `{"url": "https://a.example/", "events": ["invoice.paid"]}`},
		{"GET", hooks + id + "/secret", ""},
		{"POST", hooks + id + "/secret/rotate", ""},
	} {
		if r := e.signedAt(t, c.method, c.path, alice, time.Now().Add(-10*time.Minute), c.body); errorCode(r) !=
			"reauth_required" {
			t.Errorf("%s %s with an old sign-in: %d %v", c.method, c.path, r.status, r.body)
		}
	}
	if r := e.call(t, "PUT", "/v1/profiles/"+e.aliceProfile+"/webhooks/"+id, alice, "",
		`{"url": "https://a.example/", "events": ["invoice.paid"]}`); errorCode(r) != "endpoint_not_found" {
		t.Errorf("the shop's endpoint id on another profile: %d %v", r.status, r.body)
	}
	if r := e.call(t, "PUT", "/v1/profiles/"+e.bobProfile+"/webhooks/"+id, "did:privy:bob", "",
		`{"url": "https://a.example/", "events": ["invoice.paid"]}`); errorCode(r) != "personal_profile" {
		t.Errorf("a personal profile's endpoint: %d %v", r.status, r.body)
	}
	if r := e.call(t, "PUT", "/v1/profiles/"+e.aliceProfile+"/webhooks/cccccccc-0000-4000-8000-000000000003", alice, "",
		`{"url": "https://a.example/", "events": ["invoice.paid"], "storeId": "`+first+`"}`); errorCode(r) != "invalid_value" {
		t.Errorf("a freelancer's endpoint with a store: %d %v", r.status, r.body)
	}

	// The secret is kept sealed, and the owner reveals it.
	shown := e.call(t, "GET", hooks+id+"/secret", alice, "", "")
	secrets, _ := shown.body["secrets"].([]any)
	if shown.status != http.StatusOK || len(secrets) != 1 || !whsec.MatchString(secrets[0].(map[string]any)["secret"].(string)) ||
		secrets[0].(map[string]any)["expiresAt"] != nil {
		t.Fatalf("the secret: %d %v", shown.status, shown.body)
	}
	secret := secrets[0].(map[string]any)["secret"].(string)
	var sealed []byte
	if err := e.pool.QueryRow(context.Background(), "SELECT sealed FROM webhook_secrets WHERE endpoint_id = $1", id).
		Scan(&sealed); err != nil || bytes.Contains(sealed, []byte(secret[6:])) {
		t.Fatalf("the stored secret: %v", err)
	}
	// Bound to its endpoint: copied to another one, it doesn't open.
	other := e.call(t, "PUT", hooks+"cccccccc-0000-4000-8000-000000000004", alice, "",
		`{"url": "https://a.example/", "events": ["invoice.paid"]}`)
	e.exec(t, "UPDATE webhook_secrets SET sealed = $1 WHERE endpoint_id = $2", sealed, other.body["endpointId"])
	if r := e.call(t, "GET", hooks+"cccccccc-0000-4000-8000-000000000004/secret", alice, "", ""); r.status !=
		http.StatusInternalServerError {
		t.Errorf("a secret moved to another endpoint: %d %v", r.status, r.body)
	}

	// Rotating keeps the old secret signing for 24 hours.
	rotated := e.call(t, "POST", hooks+id+"/secret/rotate", alice, "", "")
	list, _ := rotated.body["secrets"].([]any)
	if rotated.status != http.StatusCreated || len(list) != 2 || list[1].(map[string]any)["secret"] != secret ||
		list[0].(map[string]any)["secret"] == secret || list[0].(map[string]any)["expiresAt"] != nil {
		t.Fatalf("rotate: %d %v", rotated.status, rotated.body)
	}
	until, _ := time.Parse(time.RFC3339, list[1].(map[string]any)["expiresAt"].(string))
	if left := time.Until(until); left < 23*time.Hour || left > 25*time.Hour {
		t.Errorf("the old secret signs %s more, want 24 hours", left)
	}
	// Under another WEBHOOK_SECRET_KEY the secrets don't open, and a rotation saves nothing.
	if _, err := webhook.NewService(e.pool, bytes.Repeat([]byte{8}, 32)).Rotate(context.Background(), shop, alice, id); err == nil {
		t.Error("a rotation under another key worked")
	}
	var count int
	if err := e.pool.QueryRow(context.Background(), "SELECT count(*) FROM webhook_secrets WHERE endpoint_id = $1", id).
		Scan(&count); err != nil || count != 2 {
		t.Errorf("secrets after a rotation under another key: %d, %v; want 2", count, err)
	}
	e.exec(t, "UPDATE webhook_secrets SET expires_at = now() - interval '1 second' WHERE expires_at IS NOT NULL")
	if r := e.call(t, "GET", hooks+id+"/secret", alice, "", ""); len(r.body["secrets"].([]any)) != 1 {
		t.Errorf("after the overlap: %v", r.body)
	}

	listed := e.call(t, "GET", "/v1/profiles/"+shop+"/webhooks", alice, "", "")
	if endpoints, _ := listed.body["endpoints"].([]any); len(endpoints) != 2 || endpoints[1].(map[string]any)["endpointId"] != id {
		t.Fatalf("the endpoints, newest first: %v", listed.body)
	}
	if r := e.call(t, "DELETE", hooks+id, alice, "", ""); r.status != http.StatusNoContent {
		t.Fatalf("delete: %d %v", r.status, r.body)
	}
	for _, c := range []struct{ method, path string }{{"DELETE", hooks + id}, {"GET", hooks + id + "/secret"},
		{"POST", hooks + id + "/secret/rotate"}} {
		if r := e.call(t, c.method, c.path, alice, "", ""); errorCode(r) != "endpoint_not_found" {
			t.Errorf("%s %s after delete: %d %v", c.method, c.path, r.status, r.body)
		}
	}

}

// R-146, R-149: without WEBHOOK_SECRET_KEY no secret can be kept, so the routes that make, show or send with one
// answer 503.
func TestWebhooksWithoutAKey(t *testing.T) {
	e := invoiceAPIWith(t, 0, nil)
	hooks := "/v1/profiles/" + e.aliceProfile + "/webhooks/cccccccc-0000-4000-8000-000000000001"
	for _, c := range []struct{ method, path, body string }{
		{"PUT", hooks, `{"url": "https://a.example/", "events": ["invoice.paid"]}`},
		{"GET", hooks + "/secret", ""},
		{"POST", hooks + "/secret/rotate", ""},
		{"POST", hooks + "/test", ""},
		{"POST", hooks + "/deliveries/evt_" + strings.Repeat("0", 32) + "/resend", ""},
		{"POST", hooks + "/deliveries/resend-failed", `{"since": "2026-01-01T00:00:00Z"}`},
	} {
		if r := e.call(t, c.method, c.path, "did:privy:alice", "", c.body); r.status != http.StatusServiceUnavailable ||
			errorCode(r) != "webhooks_not_configured" {
			t.Errorf("%s %s with no key: %d %v", c.method, c.path, r.status, r.body)
		}
	}
	if r := e.call(t, "GET", "/v1/profiles/"+e.aliceProfile+"/webhooks", "did:privy:alice", "", ""); r.status !=
		http.StatusOK {
		t.Errorf("the list with no key: %d %v", r.status, r.body)
	}
}

// R-146, D-93: only the owner and Admins manage webhooks.
func TestWebhooksNeedTheWebhooksPermission(t *testing.T) {
	e := invoiceAPI(t)
	shop := e.merchant(t)
	e.exec(t, `WITH u AS (INSERT INTO users (privy_user_id) VALUES ('did:privy:dave'), ('did:privy:erin') RETURNING id,
		    privy_user_id)
		INSERT INTO profile_members (profile_id, user_id, role)
		SELECT $1, id, CASE privy_user_id WHEN 'did:privy:dave' THEN 'admin' ELSE 'developer' END FROM u`, shop)
	hooks := "/v1/profiles/" + shop + "/webhooks"
	if r := e.call(t, "GET", hooks, "did:privy:dave", "", ""); r.status != http.StatusOK {
		t.Errorf("an Admin lists endpoints: %d %v", r.status, r.body)
	}
	if r := e.call(t, "GET", hooks, "did:privy:erin", "", ""); errorCode(r) != "forbidden" {
		t.Errorf("a Developer lists endpoints: %d %v", r.status, r.body)
	}
	// R-149: a Developer has invoices.read, which none of these routes may take instead.
	hook := hooks + "/cccccccc-0000-4000-8000-000000000001"
	for _, c := range []struct{ method, path, body string }{
		{"GET", hook + "/deliveries", ""},
		{"POST", hook + "/deliveries/evt_" + strings.Repeat("0", 32) + "/resend", ""},
		{"POST", hook + "/deliveries/resend-failed", `{"since": "2026-01-01T00:00:00Z"}`},
		{"POST", hook + "/test", ""},
	} {
		if r := e.call(t, c.method, c.path, "did:privy:erin", "", c.body); errorCode(r) != "forbidden" {
			t.Errorf("a Developer %s %s: %d %v", c.method, c.path, r.status, r.body)
		}
	}
}
