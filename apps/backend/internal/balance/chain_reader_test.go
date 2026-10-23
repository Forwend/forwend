package balance

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

func TestOneHungChainDoesNotBlockTheOthers(t *testing.T) {
	anvil := chaintest.Start(t)
	token := anvil.DeployToken()
	h := hung(t)
	c := NewChainReader(map[uint64]chain.Spec{
		chaintest.ChainID: {ChainID: chaintest.ChainID, Public: []string{anvil.URL, strings.Replace(anvil.URL, "127.0.0.1", "localhost", 1)}},
		dead:              {ChainID: dead, Public: []string{h, strings.Replace(h, "127.0.0.1", "localhost", 1)}},
	}, nil, 1000)
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

// The rest outlasts the second read's deadline, so it fails at once instead of hanging again.
func TestTimedOutRPCRests(t *testing.T) {
	h := hung(t)
	c := NewChainReader(map[uint64]chain.Spec{
		dead: {ChainID: dead, Public: []string{h, strings.Replace(h, "127.0.0.1", "localhost", 1)}},
	}, nil, 1000)
	ctx := context.Background()
	short, cancel := context.WithTimeout(ctx, 300*time.Millisecond)
	defer cancel()
	if _, _, err := c.Read(short, dead, usdc, holder); err == nil {
		t.Fatal("no error from a hung chain")
	}
	again, cancel := context.WithTimeout(ctx, 300*time.Millisecond)
	defer cancel()
	start := time.Now()
	if _, _, err := c.Read(again, dead, usdc, holder); err == nil || time.Since(start) > 50*time.Millisecond {
		t.Fatalf("second read: %v after %v; want a fast error", err, time.Since(start))
	}
}

// D-15.
func TestChainWithOneHostIsRefused(t *testing.T) {
	anvil := chaintest.Start(t)
	token := anvil.DeployToken()
	c := NewChainReader(map[uint64]chain.Spec{
		chaintest.ChainID: {ChainID: chaintest.ChainID, Public: []string{anvil.URL, strings.Replace(anvil.URL, "127.0.0.1", "localhost", 1)}},
		dead:              {ChainID: dead, Public: []string{anvil.URL}},
	}, nil, 1000)
	ctx := context.Background()
	if _, _, err := c.Read(ctx, dead, usdc, holder); err == nil || !strings.Contains(err.Error(), "D-15") {
		t.Fatalf("one-host chain: %v, want the D-15 error", err)
	}
	if _, _, err := c.Read(ctx, chaintest.ChainID, token, holder); err != nil {
		t.Fatal(err)
	}
}
