package chain

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/ethereum/go-ethereum/common/hexutil"
	"github.com/ethereum/go-ethereum/rpc"
	"github.com/forwend/forwend/apps/backend/internal/chaintest"
)

func TestWrongChainRPCIsNeverUsed(t *testing.T) {
	var asked atomic.Int64
	wrong := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		asked.Add(1)
		_, _ = w.Write([]byte(`{"jsonrpc":"2.0","id":1,"result":"0x1"}`))
	}))
	defer wrong.Close()
	a := chaintest.Start(t)
	r := newRPCs(t, wrong.URL, a.URL, localhost(a.URL))
	want := number(t, context.Background(), a.RPC)
	for _, c := range []*rpc.Client{r.Primary, r.Second, r.Primary} {
		if got := number(t, context.Background(), c); got != want {
			t.Fatalf("block %d, want %d", got, want)
		}
	}
	if asked.Load() != 1 {
		t.Fatalf("the wrong-chain RPC was asked %d times, want once", asked.Load())
	}
	if _, err := NewRPCs(testSpec(chaintest.ChainID, a.URL, a.URL), 10); err == nil {
		t.Fatal("one host was accepted for both roles")
	}
}

func newRPCs(t *testing.T, urls ...string) RPCs {
	t.Helper()
	r, err := NewRPCs(testSpec(chaintest.ChainID, urls...), 1000)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(r.Close)
	return r
}

// localhost is the same Anvil under another host name.
func localhost(u string) string { return strings.Replace(u, "127.0.0.1", "localhost", 1) }

func number(t *testing.T, ctx context.Context, c *rpc.Client) uint64 {
	t.Helper()
	n, err := tryNumber(ctx, c)
	if err != nil {
		t.Fatal(err)
	}
	return n
}

func tryNumber(ctx context.Context, c *rpc.Client) (uint64, error) {
	var n hexutil.Uint64
	err := c.CallContext(ctx, &n, "eth_blockNumber")
	return uint64(n), err
}

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

func testSpec(id uint64, urls ...string) Spec {
	spec := Spec{ChainID: id, AllowLoopback: true}
	hosts := map[string]Role{}
	for i, u := range urls {
		host := hostOf(u)
		r, ok := hosts[host]
		if !ok {
			r = Primary
			if len(hosts)%2 == 1 {
				r = Confirmation
			}
			hosts[host] = r
		}
		spec.Endpoints = append(spec.Endpoints, Endpoint{ID: fmt.Sprintf("rpc-%d", i), Provider: fmt.Sprintf("provider-%d", len(hosts)), Role: r, Tier: Public, Priority: i, URL: u, BudgetGroup: fmt.Sprintf("budget-%d", i)})
	}
	return spec
}
