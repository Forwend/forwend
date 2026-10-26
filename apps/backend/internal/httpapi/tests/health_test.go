package tests

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/forwend/forwend/apps/backend/internal/database"
	"github.com/forwend/forwend/apps/backend/internal/database/databasetest"
	"github.com/forwend/forwend/apps/backend/internal/httpapi"
)

func TestHealthz(t *testing.T) {
	pool, err := database.Open(context.Background(), databasetest.New(t))
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(httpapi.NewMux(pool, nil, nil, nil, "", 0, nil))
	defer server.Close()

	res, err := http.Get(server.URL + "/healthz")
	if err != nil {
		t.Fatal(err)
	}
	body, err := io.ReadAll(res.Body)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != http.StatusOK || string(body) != `{"status":"ok"}` {
		t.Fatalf("got %d %q", res.StatusCode, body)
	}
	if res.Header.Get("Cache-Control") != "no-store" || res.Header.Get("X-Content-Type-Options") != "nosniff" {
		t.Fatalf("headers %v, want no-store and nosniff", res.Header)
	}

	pool.Close()
	res, err = http.Get(server.URL + "/healthz")
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != http.StatusServiceUnavailable {
		t.Fatalf("closed database: got %d, want 503", res.StatusCode)
	}
}
