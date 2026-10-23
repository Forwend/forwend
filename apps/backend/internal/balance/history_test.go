package balance

import (
	"context"
	"errors"
	"fmt"
	"math/big"
	"reflect"
	"testing"
	"time"

	"github.com/ensp1re/forwend/apps/backend/internal/chaintest"
	"github.com/ensp1re/forwend/apps/backend/internal/database"
	"github.com/ensp1re/forwend/apps/backend/internal/database/databasetest"
	"github.com/ensp1re/forwend/apps/backend/internal/ledger"
	"github.com/ensp1re/forwend/apps/backend/internal/watcher"
	"github.com/ethereum/go-ethereum/ethclient"
)

func strs(amounts []*big.Int) []string {
	var out []string
	for _, a := range amounts {
		out = append(out, a.String())
	}
	return out
}

func TestHistoryEndsAtTheCurrentBalance(t *testing.T) {
	ctx := context.Background()
	anvil := chaintest.Start(t)
	token := anvil.DeployToken()
	url := databasetest.New(t)
	if err := database.Migrate(ctx, url); err != nil {
		t.Fatal(err)
	}
	pool, err := database.Open(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	var profile string
	err = pool.QueryRow(ctx, `
		WITH c AS (INSERT INTO chains (chain_id, chain_family, name, enabled) VALUES ($1, 'evm', 'anvil', true)),
		     tk AS (INSERT INTO tokens (chain_id, chain_family, contract, symbol, decimals, enabled)
		            VALUES ($1, 'evm', $2, 'USDC', 6, true)),
		     u AS (INSERT INTO users (privy_user_id) VALUES ('did:privy:alice') RETURNING id),
		     p AS (INSERT INTO profiles (user_id, kind) SELECT id, 'personal' FROM u RETURNING id),
		     w AS (INSERT INTO profile_wallets (profile_id, provider, provider_wallet_id, chain_family, address)
		           SELECT id, 'privy', 'w1', 'evm', $3 FROM p)
		SELECT id::text FROM p`, chaintest.ChainID, token, chaintest.Sender).Scan(&profile)
	if err != nil {
		t.Fatal(err)
	}
	watch := watcher.NewChain(pool, chaintest.ChainID, anvil.RPC)
	if err := watch.Scan(ctx); err != nil { // the chain's first scan
		t.Fatal(err)
	}

	// The profile wallet is Anvil's sender. Days 1 and 2 transfers land near noon UTC; today's mint lands exactly at
	// 00:00 UTC, which starts today, so it counts for today and not for day 2.
	const day, outsider = 24 * 60 * 60, "0x00000000000000000000000000000000000000cc"
	now := anvil.Now()
	anvil.Wait((now/day+1)*day + day/2 - now)
	anvil.Mint(token, "100000000") // day 1: 100 in
	anvil.Wait(day)
	anvil.Transfer(token, outsider, "30000000") // day 2: 30 out
	if err := anvil.RPC.Call(nil, "evm_setNextBlockTimestamp", (anvil.Now()/day+1)*day); err != nil {
		t.Fatal(err)
	}
	anvil.Mint(token, "5000000")               // day 3, today, at 00:00 UTC: 5 in
	anvil.Mine(2)                              // final
	anvil.Transfer(token, outsider, "1000000") // not final: in neither the balance nor the history
	if err := watch.Scan(ctx); err != nil {
		t.Fatal(err)
	}

	s := NewService(pool, ledger.BalanceFrom(map[uint64]*ethclient.Client{chaintest.ChainID: ethclient.NewClient(anvil.RPC)}))
	today := time.Unix(anvil.Now(), 0).UTC()
	h, err := s.History(ctx, profile, 4, today)
	if err != nil {
		t.Fatal(err)
	}
	midnight := today.Truncate(24 * time.Hour)
	var at []time.Time
	for _, p := range h.Points {
		at = append(at, p.At)
	}
	if want := []time.Time{midnight.AddDate(0, 0, -2), midnight.AddDate(0, 0, -1), midnight, today}; !reflect.DeepEqual(at, want) {
		t.Fatalf("points at %v, want the end of each earlier day, then now: %v", at, want)
	}
	if len(h.Tokens) != 1 {
		t.Fatalf("tokens %+v", h.Tokens)
	}
	tk := h.Tokens[0]
	for name, c := range map[string]struct {
		got  []*big.Int
		want []string
		usd  func(Point) string
		usds []string
	}{
		"balances": {tk.Balances, []string{"0", "100000000", "70000000", "75000000"},
			func(p Point) string { return p.EstimatedUSD }, []string{"0.00", "100.00", "70.00", "75.00"}},
		"received": {tk.Received, []string{"0", "100000000", "0", "5000000"},
			func(p Point) string { return p.ReceivedUSD }, []string{"0.00", "100.00", "0.00", "5.00"}},
		"sent": {tk.Sent, []string{"0", "0", "30000000", "0"},
			func(p Point) string { return p.SentUSD }, []string{"0.00", "0.00", "30.00", "0.00"}},
	} {
		var usds []string
		for _, p := range h.Points {
			usds = append(usds, c.usd(p))
		}
		if got := strs(c.got); !reflect.DeepEqual(got, c.want) || !reflect.DeepEqual(usds, c.usds) {
			t.Fatalf("%s %v, USD %v; want %v, USD %v", name, got, usds, c.want, c.usds)
		}
	}
	current, err := s.Of(ctx, profile)
	if err != nil || current.Tokens[0].Wallet.Cmp(tk.Balances[3]) != 0 {
		t.Fatalf("current balance %v, %v; the history must end at it", current.Tokens[0].Wallet, err)
	}

	// A missing balance leaves the token's series and every USD total null, as in Balances.
	failing := NewService(pool, func(context.Context, uint64, string, string) (*big.Int, uint64, error) {
		return nil, 0, errors.New("rpc down")
	})
	h, err = failing.History(ctx, profile, 2, today)
	if err != nil || h.Tokens[0].Balances != nil || h.Tokens[0].Received != nil || h.Tokens[0].Sent != nil ||
		h.Points[1].EstimatedUSD != "" || h.Points[1].ReceivedUSD != "" || h.Points[1].SentUSD != "" {
		t.Fatalf("RPC down: %+v, %v", h, err)
	}
	for _, days := range []int{0, MaxDays + 1} {
		if _, err := s.History(ctx, profile, days, today); !errors.Is(err, ErrInvalid) {
			t.Fatalf("days %d: %v, want ErrInvalid", days, err)
		}
	}
	if h, err := s.History(ctx, profile, 1, today); err != nil || len(h.Points) != 1 || fmt.Sprint(h.Tokens[0].Balances) != "[75000000]" {
		t.Fatalf("one day: %+v, %v; want only today at the current balance", h, err)
	}
}
