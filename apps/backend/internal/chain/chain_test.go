package chain

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/ensp1re/forwend/apps/backend/internal/chaintest"
	"github.com/ethereum/go-ethereum/rpc"
)

// The first two working hosts are picked; a URL answering another chain is skipped; one host is not enough (D-15).
func TestDialPicksTwoHostsOnTheRightChain(t *testing.T) {
	ctx := context.Background()
	wrong := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"jsonrpc":"2.0","id":1,"result":"0x1"}`))
	}))
	defer wrong.Close()
	a, b := chaintest.Start(t), chaintest.Start(t)

	r, err := Dial(ctx, Spec{ChainID: chaintest.ChainID, Public: []string{wrong.URL, a.URL, a.URL, b.URL}}, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer r.Close()
	if r.Primary == nil || r.Second == nil || r.Primary == r.Second {
		t.Fatalf("want two different clients, got %+v", r)
	}

	if _, err := Dial(ctx, Spec{ChainID: chaintest.ChainID, Public: []string{a.URL, a.URL}}, nil); err == nil {
		t.Fatal("one host was accepted for both roles")
	}
	if _, err := Dial(ctx, Spec{ChainID: chaintest.ChainID, Public: []string{wrong.URL}}, nil); err == nil {
		t.Fatal("a wrong-chain RPC was accepted")
	}
}

// go-ethereum puts the RPC URL in network errors; an Infura key must never reach a log line.
func TestRedactHidesInfuraKeys(t *testing.T) {
	c, err := rpc.Dial("http://127.0.0.1:1/v3/SECRETKEY")
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	var id string
	callErr := fmt.Errorf("read chain 1 latest block: %w", c.Call(&id, "eth_chainId"))
	if !strings.Contains(callErr.Error(), "SECRETKEY") {
		t.Fatalf("expected go-ethereum to include the URL, got %v", callErr)
	}
	infura := errors.New(`Post "https://base-sepolia.infura.io/v3/abc123def": dial tcp: i/o timeout`)
	for _, e := range []error{callErr, infura} {
		if got := Redact(e); strings.Contains(got, "SECRETKEY") || strings.Contains(got, "abc123def") {
			t.Fatalf("key left in %q", got)
		}
	}
}
