package main

import (
	"context"
	"net"
	"strings"
	"testing"
	"time"

	"github.com/ensp1re/forwend/apps/backend/internal/chain"
	"github.com/ensp1re/forwend/apps/backend/internal/chaintest"
)

const (
	usdc   = "0x036cbd53842c5426634e7929541ec2318f3dcf7e"
	holder = "0x1111111111111111111111111111111111111111"
	dead   = 999
)

// hung accepts connections and never answers, like an RPC that hangs.
func hung(t *testing.T) string {
	t.Helper()
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { l.Close() })
	go func() {
		for {
			c, err := l.Accept()
			if err != nil {
				return
			}
			t.Cleanup(func() { c.Close() })
		}
	}()
	return "http://" + l.Addr().String()
}

// A chain whose RPCs hang never slows or blanks another chain's balance, and is not dialed again on every request.
func TestOneHungChainDoesNotBlockTheOthers(t *testing.T) {
	anvil := chaintest.Start(t)
	token := anvil.DeployToken()
	h := hung(t)
	c := &chainBalances{keys: nil, chains: map[uint64]*chainRPCs{}, specs: map[uint64]chain.Spec{
		chaintest.ChainID: {ChainID: chaintest.ChainID, Public: []string{anvil.URL, strings.Replace(anvil.URL, "127.0.0.1", "localhost", 1)}},
		dead:              {ChainID: dead, Public: []string{h, strings.Replace(h, "127.0.0.1", "localhost", 1)}},
	}}
	ctx := context.Background()
	if _, _, err := c.read(ctx, chaintest.ChainID, token, holder); err != nil {
		t.Fatal(err)
	}

	stuck := make(chan error, 1)
	go func() {
		ctx, cancel := context.WithTimeout(ctx, 2*time.Second)
		defer cancel()
		_, _, err := c.read(ctx, dead, usdc, holder)
		stuck <- err
	}()
	time.Sleep(200 * time.Millisecond) // the dead chain is being picked
	start := time.Now()
	if _, _, err := c.read(ctx, chaintest.ChainID, token, holder); err != nil || time.Since(start) > time.Second {
		t.Fatalf("healthy chain while another hangs: %v after %v", err, time.Since(start))
	}
	if err := <-stuck; err == nil {
		t.Fatal("the hung chain gave a balance")
	}

	// A request that ends early keeps the shared clients.
	cancelled, cancel := context.WithCancel(ctx)
	cancel()
	if _, _, err := c.read(cancelled, chaintest.ChainID, token, holder); err == nil {
		t.Fatal("a cancelled read gave a balance")
	}
	if c.chains[chaintest.ChainID].rpcs == nil {
		t.Fatal("a cancelled request dropped the healthy chain's clients")
	}
}

// After a pick that failed or ran out of time, the chain answers at once with an error until RetryPick has passed.
func TestFailedPickIsRemembered(t *testing.T) {
	h := hung(t)
	c := &chainBalances{chains: map[uint64]*chainRPCs{}, specs: map[uint64]chain.Spec{
		dead: {ChainID: dead, Public: []string{h, strings.Replace(h, "127.0.0.1", "localhost", 1)}},
	}}
	ctx := context.Background()
	short, cancel := context.WithTimeout(ctx, 300*time.Millisecond)
	defer cancel()
	if _, _, err := c.read(short, dead, usdc, holder); err == nil {
		t.Fatal("no error from a hung chain")
	}
	start := time.Now()
	if _, _, err := c.read(ctx, dead, usdc, holder); err == nil || time.Since(start) > 50*time.Millisecond {
		t.Fatalf("second read: %v after %v; want a fast error", err, time.Since(start))
	}
}
