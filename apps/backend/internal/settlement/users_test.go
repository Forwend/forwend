package settlement

import (
	"context"
	"testing"
	"time"

	"github.com/ethereum/go-ethereum/ethclient"
	"github.com/forwend/forwend/apps/backend/internal/chaintest"
	"github.com/forwend/forwend/apps/backend/internal/ledger"
	"github.com/forwend/forwend/apps/backend/internal/watcher"
)

func TestConcurrentSignersRespectTheUserCap(t *testing.T) {
	e := setup(t)
	e.sponsoredHistory(t, SponsoredPerDay-1, "0x0000000000000000000000000000000000000001")
	e.pay(t, 71)
	const otherChain = chaintest.ChainID + 1
	a := chaintest.StartChain(t, otherChain)
	a.DeployFactory()
	token := a.DeployToken()
	a.Mint(token, "1000000000")
	if _, err := e.pool.Exec(t.Context(), `
		INSERT INTO chains (chain_id, chain_family, name, enabled) VALUES ($1, 'evm', 'second-anvil', true);
	`, otherChain); err != nil {
		t.Fatal(err)
	}
	if _, err := e.pool.Exec(t.Context(), `INSERT INTO tokens (chain_id, chain_family, contract, symbol, decimals, enabled)
		VALUES ($1, 'evm', $2, 'USDC', 6, true)`, otherChain, token); err != nil {
		t.Fatal(err)
	}
	client, err := ethclient.Dial(a.URL)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(client.Close)
	clients := map[uint64]*ethclient.Client{otherChain: client}
	other := env{chainID: otherChain, anvil: a, pool: e.pool, client: client, token: token,
		watch:  watcher.NewChain(e.pool, otherChain, a.RPC),
		ledger: ledger.NewService(e.pool, ledger.BalanceFrom(clients), ledger.DeployedFrom(clients))}
	if err := other.watch.Scan(t.Context()); err != nil {
		t.Fatal(err)
	}
	other.pay(t, 72)
	first, second := e.signer(t), other.signer(t)
	second.users = first.users
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	done := make(chan error, 2)
	go func() { done <- first.Run(ctx) }()
	go func() { done <- second.Run(ctx) }()
	for range 2 {
		if err := <-done; err != nil {
			t.Fatal(err)
		}
	}
	var signed, waiting int
	if err := e.pool.QueryRow(ctx, `SELECT count(*) FILTER (WHERE signed_at > now() - interval '1 day'),
		count(*) FILTER (WHERE wait = 'cap') FROM settlement_intents`).Scan(&signed, &waiting); err != nil {
		t.Fatal(err)
	}
	if signed != SponsoredPerDay || waiting != 1 {
		t.Fatalf("signed %d, capped %d; want %d and 1", signed, waiting, SponsoredPerDay)
	}
}

func TestSentIntentDoesNotWaitForAnotherChainsUserTurn(t *testing.T) {
	e := setup(t)
	id, _ := e.paidInvoice(t)
	saving := e.signer(t)
	saving.stopAfter = "save"
	if err := saving.Run(context.Background()); err != errStopped {
		t.Fatalf("save: %v", err)
	}
	var user string
	if err := e.pool.QueryRow(context.Background(), "SELECT id::text FROM users").Scan(&user); err != nil {
		t.Fatal(err)
	}
	release, err := saving.users.take(context.Background(), user)
	if err != nil {
		t.Fatal(err)
	}
	defer release()
	s := e.signer(t)
	s.users = saving.users
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := s.Run(ctx); err != nil {
		t.Fatalf("sent intent waited for another chain's user turn: %v", err)
	}
	if status, _, _ := e.intent(t, id); status != "sent" && status != "confirmed" {
		t.Fatalf("sent intent became %s", status)
	}
}
