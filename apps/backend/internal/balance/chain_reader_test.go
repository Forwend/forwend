package balance

import (
	"context"
	"net"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/forwend/forwend/apps/backend/internal/chain"
	"github.com/forwend/forwend/apps/backend/internal/chaintest"
)

const (
	usdc   = "0x036cbd53842c5426634e7929541ec2318f3dcf7e"
	holder = "0x1111111111111111111111111111111111111111"
	dead   = 999
)

func hung(t *testing.T) string {
	t.Helper()
	url, _ := hungCounting(t)
	return url
}

// hungCounting is hung, and counts the connections it accepted.
func hungCounting(t *testing.T) (string, *atomic.Int32) {
	t.Helper()
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { l.Close() })
	var accepted atomic.Int32
	go func() {
		for {
			c, err := l.Accept()
			if err != nil {
				return
			}
			accepted.Add(1)
			t.Cleanup(func() { c.Close() })
		}
	}()
	return "http://" + l.Addr().String(), &accepted
}

func TestOneHungChainDoesNotBlockTheOthers(t *testing.T) {
	anvil := chaintest.Start(t)
	token := anvil.DeployToken()
	h := hung(t)
	c := NewChainReader(map[uint64]chain.Spec{
		chaintest.ChainID: {ChainID: chaintest.ChainID, AllowLoopback: true, Endpoints: []chain.Endpoint{{ID: "rpc-0", Provider: "provider-0", Role: chain.Primary, Tier: chain.Public, Priority: 0, URL: anvil.URL, BudgetGroup: "budget-0"}, {ID: "rpc-1", Provider: "provider-1", Role: chain.Confirmation, Tier: chain.Public, Priority: 1, URL: strings.Replace(anvil.URL, "127.0.0.1", "localhost", 1), BudgetGroup: "budget-1"}}},
		dead:              {ChainID: dead, AllowLoopback: true, Endpoints: []chain.Endpoint{{ID: "rpc-0", Provider: "provider-0", Role: chain.Primary, Tier: chain.Public, Priority: 0, URL: h, BudgetGroup: "budget-0"}, {ID: "rpc-1", Provider: "provider-1", Role: chain.Confirmation, Tier: chain.Public, Priority: 1, URL: strings.Replace(h, "127.0.0.1", "localhost", 1), BudgetGroup: "budget-1"}}},
	}, 1000)
	ctx := context.Background()
	if _, _, err := c.Read(ctx, chaintest.ChainID, token, holder); err != nil {
		t.Fatal(err)
	}

	stuck := make(chan error, 1)
	go func() {
		ctx, cancel := context.WithTimeout(ctx, 2*time.Second)
		defer cancel()
		_, _, err := c.Read(ctx, dead, usdc, holder)
		stuck <- err
	}()
	time.Sleep(200 * time.Millisecond) // the dead chain is being read
	start := time.Now()
	if _, _, err := c.Read(ctx, chaintest.ChainID, token, holder); err != nil || time.Since(start) > time.Second {
		t.Fatalf("healthy chain while another hangs: %v after %v", err, time.Since(start))
	}
	if err := <-stuck; err == nil {
		t.Fatal("the hung chain gave a balance")
	}

	// A request that ends early says nothing about the RPC: the next read is answered at once.
	cancelled, cancel := context.WithCancel(ctx)
	cancel()
	if _, _, err := c.Read(cancelled, chaintest.ChainID, token, holder); err == nil {
		t.Fatal("a cancelled read gave a balance")
	}
	start = time.Now()
	if _, _, err := c.Read(ctx, chaintest.ChainID, token, holder); err != nil || time.Since(start) > time.Second {
		t.Fatalf("read after a cancelled one: %v after %v", err, time.Since(start))
	}
}

// A read that starts while a hung read of the same chain runs gets its failure, instead of starting another hung
// request. A hung RPC rests after the pool's attempt timeout (chain tests), longer than these deadlines.
func TestReadDuringAHungReadSharesItsFailure(t *testing.T) {
	h, accepted := hungCounting(t)
	c := NewChainReader(map[uint64]chain.Spec{
		dead: {ChainID: dead, AllowLoopback: true, Endpoints: []chain.Endpoint{{ID: "rpc-0", Provider: "provider-0", Role: chain.Primary, Tier: chain.Public, Priority: 0, URL: h, BudgetGroup: "budget-0"}}},
	}, 1000)
	ctx := context.Background()
	first, cancel := context.WithTimeout(ctx, 500*time.Millisecond)
	defer cancel()
	failed := make(chan error, 1)
	go func() {
		_, _, err := c.Read(first, dead, usdc, holder)
		failed <- err
	}()
	for began := time.Now(); accepted.Load() == 0; time.Sleep(time.Millisecond) { // then the first read waits on the hung RPC
		if time.Since(began) > 5*time.Second {
			t.Fatal("the first read never reached the RPC")
		}
	}
	second, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	start := time.Now()
	if _, _, err := c.Read(second, dead, usdc, holder); err == nil || time.Since(start) > 5*time.Second {
		t.Fatalf("second read: %v after %v; want the first read's failure", err, time.Since(start))
	}
	if err := <-failed; err == nil {
		t.Fatal("no error from a hung chain")
	}
	if n := accepted.Load(); n != 1 {
		t.Fatalf("%d connections to the hung RPC; want the second read to wait for the first", n)
	}
}

// D-15.
func TestSingleRPCReadsBalancesAndRejectsWrongChain(t *testing.T) {
	anvil := chaintest.Start(t)
	token := anvil.DeployToken()
	c := NewChainReader(map[uint64]chain.Spec{
		chaintest.ChainID: {ChainID: chaintest.ChainID, AllowLoopback: true, Endpoints: []chain.Endpoint{{ID: "rpc-0", Provider: "provider-0", Role: chain.Primary, Tier: chain.Public, Priority: 0, URL: anvil.URL, BudgetGroup: "budget-0"}}},
		dead:              {ChainID: dead, AllowLoopback: true, Endpoints: []chain.Endpoint{{ID: "rpc-0", Provider: "provider-0", Role: chain.Primary, Tier: chain.Public, Priority: 0, URL: anvil.URL, BudgetGroup: "budget-0"}}},
	}, 1000)
	ctx := context.Background()
	if _, _, err := c.Read(ctx, dead, usdc, holder); err == nil || !strings.Contains(err.Error(), "RPC endpoints unavailable") {
		t.Fatalf("wrong-chain endpoint: %v, want unavailable", err)
	}
	if _, _, err := c.Read(ctx, chaintest.ChainID, token, holder); err != nil {
		t.Fatal(err)
	}
}
