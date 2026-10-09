package httpapi_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/ensp1re/forwend/apps/backend/internal/database"
	"github.com/ensp1re/forwend/apps/backend/internal/database/databasetest"
	"github.com/ensp1re/forwend/apps/backend/internal/httpapi"
)

func TestHealthz(t *testing.T) {
	pool, err := database.Open(context.Background(), databasetest.New(t))
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(httpapi.NewMux(pool))
	defer server.Close()

	res, err := http.Get(server.URL + "/healthz")
	if err != nil {
		t.Fatal(err)
	}
	body := make([]byte, 64)
	n, _ := res.Body.Read(body)
	res.Body.Close()
	if res.StatusCode != http.StatusOK || string(body[:n]) != `{"status":"ok"}` {
		t.Fatalf("got %d %q", res.StatusCode, body[:n])
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
