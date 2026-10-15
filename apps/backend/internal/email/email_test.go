package email

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestResendSendsOneKeyedMessage(t *testing.T) {
	var got map[string]any
	var key, auth string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		key, auth = r.Header.Get("Idempotency-Key"), r.Header.Get("Authorization")
		_ = json.NewDecoder(r.Body).Decode(&got)
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()
	r := NewResend("re_test", "Forwend <notifications@mail.forwend.com>")
	r.URL = srv.URL
	err := r.Send(context.Background(), Message{To: "a@example.com", Subject: "INV-0001 paid", Text: "body", Key: "outbox-7"})
	if err != nil {
		t.Fatal(err)
	}
	if key != "outbox-7" || auth != "Bearer re_test" || got["from"] != "Forwend <notifications@mail.forwend.com>" ||
		got["subject"] != "INV-0001 paid" || got["text"] != "body" {
		t.Fatalf("key %q auth %q body %v", key, auth, got)
	}
	if to, _ := got["to"].([]any); len(to) != 1 || to[0] != "a@example.com" {
		t.Fatalf("to %v", got["to"])
	}
}

func TestResendErrorNamesOnlyTheStatus(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, `{"message":"a@example.com is not allowed"}`, http.StatusForbidden)
	}))
	defer srv.Close()
	r := NewResend("re_test", "x@y.z")
	r.URL = srv.URL
	err := r.Send(context.Background(), Message{To: "a@example.com", Key: "k"})
	if err == nil || strings.Contains(err.Error(), "a@example.com") || !strings.Contains(err.Error(), "403") {
		t.Fatalf("err %v: want the status without the address", err)
	}
}
