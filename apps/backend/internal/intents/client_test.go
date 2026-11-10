package intents

import (
	"bytes"
	"context"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
)

// A rejected partner key alerts once, not at every call; once 1Click takes it again, a later rejection alerts again.
func TestARejectedKeyAlertsOnce(t *testing.T) {
	var status atomic.Int32
	status.Store(http.StatusUnauthorized)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(int(status.Load()))
		_, _ = w.Write([]byte(`{"status": "PENDING_DEPOSIT", "swapDetails": {}}`))
	}))
	t.Cleanup(server.Close)
	c := NewClient(server.URL, "key", true)
	var logs bytes.Buffer
	defer slog.SetDefault(slog.Default())
	slog.SetDefault(slog.New(slog.NewTextHandler(&logs, nil)))
	alerts := func() int { return strings.Count(logs.String(), "ALERT 1Click rejected the API key") }
	for range 3 {
		if _, err := c.Status(context.Background(), "0x1"); err == nil {
			t.Fatal("a rejected key read a status")
		}
	}
	if n := alerts(); n != 1 {
		t.Fatalf("%d alerts, want 1:\n%s", n, logs.String())
	}
	status.Store(http.StatusOK)
	if _, err := c.Status(context.Background(), "0x1"); err != nil {
		t.Fatal(err)
	}
	status.Store(http.StatusUnauthorized)
	_, _ = c.Status(context.Background(), "0x1")
	if n := alerts(); n != 2 {
		t.Fatalf("%d alerts after the key worked again, want 2:\n%s", n, logs.String())
	}
}
