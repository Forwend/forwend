package tests

import (
	"encoding/json"
	"net/http"
	"testing"
	"time"

	"github.com/forwend/forwend/apps/backend/internal/httpapi/mid"
)

func (e invoiceEnv) send(t *testing.T, path, user string) (status int, code, retryAfter string) {
	t.Helper()
	req, err := http.NewRequest(http.MethodGet, e.srv.URL+path, nil)
	if err != nil {
		t.Fatal(err)
	}
	if user != "" {
		req.Header.Set("Authorization", "Bearer "+signES256(t, e.privyKey, claims(user)))
	}
	res, err := e.srv.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	var body struct{ Error struct{ Code string } }
	_ = json.NewDecoder(res.Body).Decode(&body)
	return res.StatusCode, body.Error.Code, res.Header.Get("Retry-After")
}

func TestUserRateLimit(t *testing.T) {
	e := invoiceAPI(t)
	const carol, dave = "did:privy:carol", "did:privy:dave"
	for i := range mid.UserBurst {
		if status, _, _ := e.send(t, "/v1/me", carol); status != http.StatusNotFound { // not signed up yet
			t.Fatalf("request %d: %d, want 404", i+1, status)
		}
	}
	status, code, retry := e.send(t, "/v1/me", carol)
	if status != http.StatusTooManyRequests || code != "rate_limited" || retry != "1" {
		t.Fatalf("past the burst: %d %q Retry-After %q, want 429 rate_limited and 1", status, code, retry)
	}
	if status, _, _ := e.send(t, "/v1/me", dave); status != http.StatusNotFound {
		t.Fatalf("another user: %d, want 404", status)
	}
	time.Sleep(time.Second)
	if status, _, _ := e.send(t, "/v1/me", carol); status != http.StatusNotFound {
		t.Fatalf("after Retry-After: %d, want 404", status)
	}
}
