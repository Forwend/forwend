//go:build e2e && loadtest

package e2e

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"math/rand/v2"
	"net/http"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/ensp1re/forwend/apps/backend/internal/auth/authtest"
	"github.com/ensp1re/forwend/apps/backend/internal/chaintest"
	"github.com/ensp1re/forwend/apps/backend/internal/database/databasetest"
	"github.com/golang-jwt/jwt/v5"
	"github.com/jackc/pgx/v5"
)

var (
	loadUsers    = flag.Int("users", 1000, "signed-in users, each with a personal profile, polling at once")
	loadDuration = flag.Duration("duration", 2*time.Minute, "how long the users poll")
	loadInterval = flag.Duration("interval", 15*time.Second, "time between one user's polls (the web's REFRESH_MS)")
	loadBlock    = flag.Duration("block", 12*time.Second, "Anvil mines a block this often; each moves the finalized block")
	loadAPI      = flag.String("api", "", "an api binary to test instead of this tree's (a build of another commit)")
)

// TestLoad: pnpm --filter @forwend/backend loadtest -users=1000 (docs/backend/architecture.md#load-test).
// RPC_RATE_PER_SECOND is high so the RPC count is the api's demand, not the pace limit.
func TestLoad(t *testing.T) {
	ctx := context.Background()
	anvil := chaintest.Start(t)
	tokens := []string{anvil.DeployToken(), anvil.DeployToken()}
	privy := authtest.NewPrivy(t)
	dbURL := databasetest.New(t)
	proxy := anvil.Proxy()
	chains := filepath.Join(t.TempDir(), "chains.json")
	if err := os.WriteFile(chains, fmt.Appendf(nil, `{"anvil": {"chainId": %d, "infura": null, "public": [%q, %q]}}`,
		chaintest.ChainID, proxy.URL, strings.Replace(proxy.URL, "127.0.0.1", "localhost", 1)), 0o600); err != nil {
		t.Fatal(err)
	}
	bin := *loadAPI
	if bin == "" {
		bin = filepath.Join(build(t), "api")
	}
	apiAddr := freeAddr(t)
	start(t, filepath.Dir(bin), filepath.Base(bin), []string{"DATABASE_URL=" + dbURL, "API_ADDR=" + apiAddr,
		"PRIVY_APP_ID=" + appID, "PRIVY_JWKS_URL=" + privy.JWKSURL, "PRIVY_APP_SECRET=unused",
		"CHAINS_FILE=" + chains, "INFURA_API_KEYS=", "RPC_RATE_PER_SECOND=100000", "PUBLIC_WEB_URL=http://localhost:3000"})
	api := "http://" + apiAddr
	waitFor(t, "api healthy", func() bool {
		res, err := http.Get(api + "/healthz")
		if err == nil {
			res.Body.Close()
		}
		return err == nil && res.StatusCode == http.StatusOK
	})
	profiles := seed(t, dbURL, tokens, *loadUsers) // after the api's own migrations, which may be another commit's

	runCtx, stop := context.WithTimeout(ctx, *loadDuration)
	defer stop()
	go func() {
		for tick := time.NewTicker(*loadBlock); ; {
			select {
			case <-runCtx.Done():
				tick.Stop()
				return
			case <-tick.C:
				if err := anvil.RPC.Call(nil, "anvil_mine", "0x1"); err != nil {
					t.Error(err)
				}
			}
		}
	}()

	client := &http.Client{Timeout: 60 * time.Second,
		Transport: &http.Transport{MaxIdleConnsPerHost: 5 * *loadUsers}}
	routes := []string{"/v1/me", "/balances", "/balance-history?days=30", "/transactions?limit=20", "/activity?limit=20"}
	var mu sync.Mutex
	took := map[string][]time.Duration{}
	failed := map[string]map[string]int{} // route -> status or error -> count
	var missing, read atomic.Int64        // wallet balances in /balances answers: unread (null) and read
	poll := func(user int, bearer string) {
		var wg sync.WaitGroup
		for _, route := range routes {
			wg.Go(func() {
				url := api + route
				if route != "/v1/me" {
					url = api + "/v1/profiles/" + profiles[user] + route
				}
				req, _ := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
				req.Header.Set("Authorization", "Bearer "+bearer)
				began := time.Now()
				res, err := client.Do(req)
				var body []byte
				if err == nil {
					body, err = io.ReadAll(res.Body)
					res.Body.Close()
				}
				elapsed := time.Since(began)
				outcome := ""
				switch {
				case err != nil:
					outcome = "transport error"
				case res.StatusCode != http.StatusOK:
					outcome = fmt.Sprint(res.StatusCode)
				case route == "/balances":
					var b struct{ Tokens []struct{ Wallet *string } }
					_ = json.Unmarshal(body, &b)
					for _, tk := range b.Tokens {
						if tk.Wallet == nil {
							missing.Add(1)
						} else {
							read.Add(1)
						}
					}
				}
				mu.Lock()
				defer mu.Unlock()
				took[route] = append(took[route], elapsed)
				if outcome != "" {
					if failed[route] == nil {
						failed[route] = map[string]int{}
					}
					failed[route][outcome]++
				}
			})
		}
		wg.Wait()
	}

	rpcBefore := proxy.Calls()
	began := time.Now()
	var users sync.WaitGroup
	for u := range *loadUsers {
		users.Go(func() {
			bearer := authtest.Sign(t, privy.Key("key-1"), "key-1", jwt.MapClaims{"sid": "load", "sub": fmt.Sprintf("did:privy:load-%d", u),
				"iss": "privy.io", "aud": appID, "iat": time.Now().Unix(), "exp": time.Now().Add(2 * time.Hour).Unix()})
			// Users arrive spread over one interval, then poll every interval, as dashboard tabs do.
			select {
			case <-runCtx.Done():
				return
			case <-time.After(rand.N(*loadInterval)):
			}
			for tick := time.NewTicker(*loadInterval); ; {
				poll(u, bearer)
				select {
				case <-runCtx.Done():
					tick.Stop()
					return
				case <-tick.C:
				}
			}
		})
	}
	users.Wait()
	elapsed := time.Since(began)
	rpc := proxy.Calls()[len(rpcBefore):]

	t.Logf("%d users polling every %v for %v; Anvil mines a block every %v", *loadUsers, *loadInterval,
		elapsed.Round(time.Second), *loadBlock)
	var all []time.Duration
	for _, route := range routes {
		d := took[route]
		all = append(all, d...)
		t.Logf("%-26s %s errors %v", route, percentiles(d), failed[route])
	}
	t.Logf("%-26s %s", "all", percentiles(all))
	t.Logf("wallet balances unread: %d of %d", missing.Load(), missing.Load()+read.Load())
	methods := map[string]int{}
	for _, c := range rpc {
		methods[c.Method]++
	}
	t.Logf("RPC: %.1f calls/s (%d in %v): %v", float64(len(rpc))/elapsed.Seconds(), len(rpc), elapsed.Round(time.Second),
		methods)
}

// seed returns the profile ids in user order: index i is did:privy:load-i's.
func seed(t *testing.T, dbURL string, tokens []string, n int) []string {
	t.Helper()
	ctx := context.Background()
	conn, err := pgx.Connect(ctx, dbURL)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close(ctx)
	err = pgx.BeginFunc(ctx, conn, func(tx pgx.Tx) error {
		for _, q := range []string{
			`INSERT INTO chains (chain_id, chain_family, name, enabled) VALUES (@chain, 'evm', 'anvil', true)`,
			`INSERT INTO tokens (chain_id, chain_family, contract, symbol, decimals, enabled)
			 VALUES (@chain, 'evm', @a, 'USDC', 6, true), (@chain, 'evm', @b, 'USDT', 6, true)`,
			`INSERT INTO users (privy_user_id) SELECT 'did:privy:load-' || g FROM generate_series(0, @n - 1) g`,
			`INSERT INTO profiles (user_id, kind) SELECT id, 'personal' FROM users`,
			`INSERT INTO profile_wallets (profile_id, provider, provider_wallet_id, chain_family, address)
			 SELECT p.id, 'privy', u.privy_user_id, 'evm', '0xaa' || lpad(to_hex(split_part(u.privy_user_id, '-', 2)::int), 38, '0')
			 FROM profiles p JOIN users u ON u.id = p.user_id`,
			`INSERT INTO invoices (id, profile_id, chain_id, chain_family, token_contract, amount, expires_at, settle_deadline,
			     recipient_address, receive_method, factory_address, receive_address, idempotency_key, request_hash)
			 SELECT '0x' || lpad(to_hex(w.n * 8 + k), 64, '0'), w.profile_id, @chain, 'evm', CASE WHEN k % 2 = 0 THEN @a ELSE @b END,
			     1000000, 1800000000, 1800086400, w.address, 'evm_create2', '0x' || repeat('44', 20),
			     '0xbb' || lpad(to_hex(w.n * 8 + k), 38, '0'), 'load-' || k, decode(repeat('00', 32), 'hex')
			 FROM (SELECT w.profile_id, w.address, split_part(u.privy_user_id, '-', 2)::bigint AS n
			       FROM profile_wallets w JOIN profiles p ON p.id = w.profile_id JOIN users u ON u.id = p.user_id) w,
			     generate_series(1, 5) k`,
			`INSERT INTO chain_transfers (chain_id, chain_family, token_contract, invoice_id, tx_hash, log_index, block_hash,
			     block_number, block_time, from_address, to_address, amount, status)
			 SELECT chain_id, 'evm', token_contract, id, id, 0, id, 1, 1, '0x' || repeat('cc', 20), receive_address, amount,
			     'confirmed'
			 FROM invoices`,
			`INSERT INTO ledger_transactions (invoice_id, kind, chain_transfer_id)
			 SELECT invoice_id, 'deposit', id FROM chain_transfers`,
			`INSERT INTO ledger_entries (transaction_id, account, amount)
			 SELECT x.id, a.account, a.sign * t.amount
			 FROM ledger_transactions x JOIN chain_transfers t ON t.id = x.chain_transfer_id,
			     (VALUES ('receiver', 1), ('recipient_payable', -1)) a (account, sign)`,
			`INSERT INTO wallet_transfers (chain_id, chain_family, token_contract, wallet_address, direction, counterparty,
			     tx_hash, log_index, block_hash, block_number, block_time, amount, status)
			 SELECT @chain, 'evm', CASE WHEN k % 2 = 0 THEN @a ELSE @b END, address, CASE WHEN k < 7 THEN 'in' ELSE 'out' END,
			     '0x' || repeat('dd', 20), '0x' || md5(address || k) || md5(k || address), 0,
			     '0x' || md5(address || k) || md5(k || address), 1, extract(epoch FROM now())::bigint - k * 259200,
			     1000000, 'confirmed'
			 FROM profile_wallets, generate_series(1, 10) k`,
		} {
			args := pgx.NamedArgs{"chain": chaintest.ChainID, "a": tokens[0], "b": tokens[1], "n": n}
			if _, err := tx.Exec(ctx, q, args); err != nil {
				return fmt.Errorf("%s: %w", q, err)
			}
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := conn.Exec(ctx, "ANALYZE"); err != nil { // planner statistics for the new rows, as autovacuum would
		t.Fatal(err)
	}
	rows, err := conn.Query(ctx, `SELECT p.id::text FROM profiles p JOIN users u ON u.id = p.user_id
		ORDER BY split_part(u.privy_user_id, '-', 2)::int`)
	if err != nil {
		t.Fatal(err)
	}
	ids, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil || len(ids) != n {
		t.Fatalf("seeded %d profiles (%v), want %d", len(ids), err, n)
	}
	return ids
}

func percentiles(d []time.Duration) string {
	if len(d) == 0 {
		return "no requests"
	}
	slices.Sort(d)
	at := func(p float64) time.Duration { return d[int(p*float64(len(d)-1))].Round(100 * time.Microsecond) }
	return fmt.Sprintf("n %6d  p50 %8v  p95 %8v  p99 %8v", len(d), at(0.50), at(0.95), at(0.99))
}
