package balance

import (
	"context"
	"errors"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/ensp1re/forwend/apps/backend/internal/chain"
	"github.com/ensp1re/forwend/apps/backend/internal/chaintest"
)

const sink = "0x2222222222222222222222222222222222222222"

func TestReadsAreSharedUntilTheFinalizedBlockMoves(t *testing.T) {
	anvil := chaintest.Start(t)
	token := anvil.DeployToken()
	anvil.Mint(token, "1000000000")
	anvil.Transfer(token, holder, "2500000")
	anvil.Mine(2) // final
	proxy := anvil.Proxy()
	c := NewChainReader(map[uint64]chain.Spec{
		chaintest.ChainID: {ChainID: chaintest.ChainID, Public: []string{proxy.URL, strings.Replace(proxy.URL, "127.0.0.1", "localhost", 1)}},
	}, nil, 1000)
	defer c.Close()
	reads := func() (headers, balances int) {
		for _, call := range proxy.Calls() {
			switch call.Method {
			case "eth_getBlockByNumber":
				headers++
			case "eth_call":
				balances++
			}
		}
		return headers, balances
	}
	ctx := context.Background()
	read := func(holder string) (string, uint64) {
		t.Helper()
		balance, block, err := c.Read(ctx, chaintest.ChainID, token, holder)
		if err != nil {
			t.Fatal(err)
		}
		return balance.String(), block
	}

	type answer struct {
		balance string
		block   uint64
	}
	answers := make(chan answer, 20)
	var wg sync.WaitGroup
	for range 20 {
		wg.Go(func() {
			balance, block := read(holder)
			answers <- answer{balance, block}
		})
	}
	wg.Wait()
	close(answers)
	first := <-answers
	for a := range answers {
		if a != first {
			t.Fatalf("answers differ: %+v and %+v", first, a)
		}
	}
	if first.balance != "2500000" {
		t.Fatalf("balance %s, want 2500000", first.balance)
	}
	if h, b := reads(); h != 1 || b != 1 {
		t.Fatalf("20 requests made %d finalized block reads and %d balanceOf calls, want 1 and 1", h, b)
	}
	read(sink)
	if h, b := reads(); h != 1 || b != 2 {
		t.Fatalf("another wallet: %d block reads and %d balanceOf calls in all, want the block shared (1) and 2", h, b)
	}

	anvil.Transfer(token, holder, "1")
	anvil.Mine(2) // the finalized block moves past the transfer
	time.Sleep(finalizedTTL)
	balance, block := read(holder)
	if block <= first.block || balance != "2500001" {
		t.Fatalf("after the finalized block moved: %s at %d, want 2500001 after block %d", balance, block, first.block)
	}
	if h, b := reads(); h != 2 || b != 3 {
		t.Fatalf("after the finalized block moved: %d block reads and %d balanceOf calls in all, want 2 and 3", h, b)
	}
}

func TestFailedReadIsNotKept(t *testing.T) {
	m, ctx, calls := newMemoryCache(), context.Background(), 0
	read := func(context.Context) (string, error) {
		if calls++; calls == 1 {
			return "", errors.New("rpc down")
		}
		return "42", nil
	}
	if _, err := m.get(ctx, "k", time.Minute, read); err == nil {
		t.Fatal("the failed read gave a value")
	}
	if v, err := m.get(ctx, "k", time.Minute, read); err != nil || v != "42" || calls != 2 {
		t.Fatalf("after a failure: %q, %v after %d reads; want 42 from a second read", v, err, calls)
	}
	if v, err := m.get(ctx, "k", time.Minute, read); err != nil || v != "42" || calls != 2 {
		t.Fatalf("kept value: %q, %v after %d reads; want 42 without a third read", v, err, calls)
	}
}

func TestReadOutlivesTheRequestThatStartedIt(t *testing.T) {
	m := newMemoryCache()
	release, reads := make(chan struct{}), atomic.Int32{}
	read := func(ctx context.Context) (string, error) {
		reads.Add(1)
		select {
		case <-release:
			return "7", nil
		case <-ctx.Done():
			return "", ctx.Err()
		}
	}
	leaving, leave := context.WithCancel(context.Background())
	left := make(chan error, 1)
	go func() { _, err := m.get(leaving, "k", time.Minute, read); left <- err }()
	for reads.Load() == 0 {
		time.Sleep(time.Millisecond)
	}
	waiting := make(chan string, 1)
	go func() { v, _ := m.get(context.Background(), "k", time.Minute, read); waiting <- v }()
	leave()
	if err := <-left; !errors.Is(err, context.Canceled) {
		t.Fatalf("the request that left: %v, want context.Canceled", err)
	}
	close(release)
	if v := <-waiting; v != "7" || reads.Load() != 1 {
		t.Fatalf("the request still waiting got %q after %d reads, want 7 from the one read", v, reads.Load())
	}
}
