package email

import (
	"context"
	"encoding/json"
	"errors"
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
	err := r.Send(context.Background(), Message{To: "a@example.com", Subject: "INV-0001 paid", Text: "body", HTML: "<p>body</p>",
		Key: "outbox-7", ReplyTo: "billing@alice.example", Unsubscribe: "https://app.example/api/v1/reminders/ab/stop"})
	if err != nil {
		t.Fatal(err)
	}
	if key != "outbox-7" || auth != "Bearer re_test" || got["from"] != "Forwend <notifications@mail.forwend.com>" ||
		got["subject"] != "INV-0001 paid" || got["text"] != "body" || got["html"] != "<p>body</p>" ||
		got["reply_to"] != "billing@alice.example" {
		t.Fatalf("key %q auth %q body %v", key, auth, got)
	}
	if h, _ := got["headers"].(map[string]any); h["List-Unsubscribe"] != "<https://app.example/api/v1/reminders/ab/stop>" ||
		h["List-Unsubscribe-Post"] != "List-Unsubscribe=One-Click" {
		t.Fatalf("headers %v", got["headers"])
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

// R-115: 400 and 422 are Resend refusing this one message (a bad address or field); the rest are about the key, the
// account, the quota or Resend itself, so retrying later may work.
func TestResendRefusesOnlyTheMessageOn400And422(t *testing.T) {
	for status, refused := range map[int]bool{400: true, 422: true, 401: false, 403: false, 409: false, 429: false,
		500: false, 503: false} {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(status)
		}))
		r := NewResend("re_test", "x@y.z")
		r.URL = srv.URL
		err := r.Send(context.Background(), Message{To: "a@example.com", Key: "k"})
		srv.Close()
		if err == nil || errors.Is(err, ErrRefused) != refused {
			t.Errorf("status %d: err %v, refused %v", status, err, refused)
		}
	}
}
