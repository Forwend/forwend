package chain

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestProviderErrorCannotReflectCredentials(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var request struct {
			ID     json.RawMessage
			Method string
		}
		_ = json.NewDecoder(r.Body).Decode(&request)
		if request.Method == "eth_chainId" {
			fmt.Fprintf(w, `{"jsonrpc":"2.0","id":%s,"result":"0x7a69"}`, request.ID)
			return
		}
		w.WriteHeader(http.StatusServiceUnavailable)
		fmt.Fprint(w, "private credential reflected: SECRET-DO-NOT-LOG")
	}))
	defer server.Close()
	r := newRPCs(t, server.URL, localhost(server.URL))
	ctx, cancel := context.WithTimeout(t.Context(), 100*time.Millisecond)
	defer cancel()
	_, err := tryNumber(ctx, r.Primary)
	if err == nil || strings.Contains(err.Error(), "SECRET-DO-NOT-LOG") {
		t.Fatalf("provider error exposed its body: %v", err)
	}
}
