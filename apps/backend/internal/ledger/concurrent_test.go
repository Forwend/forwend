package ledger

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/ensp1re/forwend/apps/backend/internal/chaintest"
	"github.com/ensp1re/forwend/apps/backend/internal/watcher"
	"github.com/ethereum/go-ethereum/rpc"
)

func TestConcurrentOptionsChooseAndBookOnlyOnce(t *testing.T) {
	e := newChainEnv(t)
	main, receive := e.invoice(t, 1, 5000000, e.anvil.Now()+3600)
	other, otherReceive := e.option(t, main, 2)
	proxy := e.anvil.Proxy()
	client, err := rpc.Dial(proxy.URL)
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()
	e.watch = watcher.NewChain(e.pool, chaintest.ChainID, client)
	e.anvil.Transfer(e.token, otherReceive, "5000000")
	proxy.Stale(func(c chaintest.Call) json.RawMessage {
		if c.Method == "eth_getLogs" {
			return json.RawMessage(`[]`)
		}
		return nil
	})
	if err := e.watch.ScanNew(context.Background()); err != nil {
		t.Fatal(err)
	}
	proxy.Stale(nil)
	e.anvil.Transfer(e.token, receive, "5000000")
	e.anvil.Mine(2)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := e.watch.ScanNew(ctx); err != nil {
		t.Fatal(err)
	}
	done := make(chan error, 2)
	go func() { done <- e.service.Process(ctx, main) }()
	go func() { done <- e.service.Process(ctx, other) }()
	for range 2 {
		if err := <-done; err != nil {
			t.Fatal(err)
		}
	}
	var chosen string
	var intents int
	if err := e.pool.QueryRow(ctx, `SELECT chosen_id, (SELECT count(*) FROM settlement_intents) FROM invoices WHERE id = $1`, main).Scan(&chosen, &intents); err != nil {
		t.Fatal(err)
	}
	if chosen != other || intents != 1 {
		t.Fatalf("chosen %s, intents %d; want %s and 1", chosen, intents, other)
	}
	want(t, "first payer", e.state(t, other), state{payment: Paid, refund: "none", receiver: 5000000, owed: 5000000})
	want(t, "later payer", e.state(t, main), state{payment: Detected, refund: "held", receiver: 5000000, held: 5000000})
}
