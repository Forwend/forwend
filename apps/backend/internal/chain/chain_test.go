package chain

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/ensp1re/forwend/apps/backend/internal/chaintest"
	"github.com/ethereum/go-ethereum/common/hexutil"
	"github.com/ethereum/go-ethereum/rpc"
)

// Every Infura key comes first, all on one host, then the public RPCs; without keys only the public RPCs are used, and
// a chain needs two hosts (D-15). Endpoint names, used in logs, never hold a key.
func TestNewRPCsUsesEveryKeyThenThePublicRPCs(t *testing.T) {
	base := Spec{ChainID: 84532, Infura: "base-sepolia", Public: []string{"https://sepolia.base.org"}}
	r, err := NewRPCs(base, []string{"key1", "key2"}, 10)
	if err != nil {
		t.Fatal(err)
	}
	defer r.Close()
	var got []string
	for _, e := range r.pool.endpoints {
		got = append(got, e.host)
		if strings.Contains(e.name, "key") {
			t.Fatalf("endpoint name %q holds a key", e.name)
		}
	}
	if want := []string{"base-sepolia.infura.io", "base-sepolia.infura.io", "sepolia.base.org"}; !slices.Equal(got, want) {
		t.Fatalf("hosts %v, want %v", got, want)
	}
	// Public RPCs only: Base Sepolia lists one public host, too few for D-15; Arc Testnet lists four.
	if _, err := NewRPCs(base, nil, 10); err == nil {
		t.Fatal("one public host was accepted for both roles")
	}
	arc, err := NewRPCs(Spec{ChainID: 5042002, Infura: "arc-testnet", Public: []string{"https://rpc.testnet.arc.io",
		"https://rpc.drpc.testnet.arc.io", "https://rpc.blockdaemon.testnet.arc.io"}}, nil, 10)
	if err != nil || len(arc.pool.endpoints) != 3 {
		t.Fatalf("public-only Arc: %v", err)
	}
	arc.Close()
}

// An RPC answering another chain is never used: its one eth_chainId answer is all it gets.
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
	if _, err := NewRPCs(Spec{ChainID: chaintest.ChainID, Public: []string{a.URL, a.URL}}, nil, 10); err == nil {
		t.Fatal("one host was accepted for both roles")
	}
}

func newRPCs(t *testing.T, urls ...string) RPCs {
	t.Helper()
	r, err := NewRPCs(Spec{ChainID: chaintest.ChainID, Public: urls}, nil, 1000)
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

// Without Infura keys every chain still has two hosts, so D-15's second balance read has an independent provider.
func TestEveryChainListsTwoPublicHosts(t *testing.T) {
	specs, err := Specs("../../../../packages/contracts/chains.json")
	if err != nil {
		t.Fatal(err)
	}
	for id, s := range specs {
		hosts := map[string]bool{}
		for _, u := range s.Public {
			parsed, err := url.Parse(u)
			if err != nil {
				t.Fatal(err)
			}
			hosts[parsed.Host] = true
		}
		if len(hosts) < 2 {
			t.Errorf("chain %d lists %d public hosts, want at least 2", id, len(hosts))
		}
	}
}

func TestChainListRefusesPlainHTTP(t *testing.T) {
	for list, ok := range map[string]bool{
		`{"a": {"chainId": 1, "public": ["https://rpc.example", "http://127.0.0.1:8545", "http://localhost:8545"]}}`: true,
		`{"a": {"chainId": 1, "public": ["https://rpc.example", "http://rpc.example"]}}`:                             false,
	} {
		path := filepath.Join(t.TempDir(), "chains.json")
		if err := os.WriteFile(path, []byte(list), 0o600); err != nil {
			t.Fatal(err)
		}
		if _, err := Specs(path); (err == nil) != ok {
			t.Errorf("%s: err %v", list, err)
		}
	}
}
