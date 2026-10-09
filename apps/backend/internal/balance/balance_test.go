package balance

import (
	"context"
	"errors"
	"math/big"
	"testing"
	"time"

	"github.com/ensp1re/forwend/apps/backend/internal/chaintest"
	"github.com/ensp1re/forwend/apps/backend/internal/database"
	"github.com/ensp1re/forwend/apps/backend/internal/database/databasetest"
	"github.com/ensp1re/forwend/apps/backend/internal/ledger"
	"github.com/ethereum/go-ethereum/ethclient"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	wallet  = "0x1111111111111111111111111111111111111111"
	receive = "0x3333333333333333333333333333333333333333"
	invoice = "0xab00000000000000000000000000000000000000000000000000000000000001"
)

// setup makes a profile with a wallet and one invoice in token on Anvil, with these transfers to its receive address:
// 1.0 detected (pending), 0.5 reorged (ignored), and 3.0 confirmed and booked as 2.0 owed to the creator (pending
// until settled) and 1.0 held for the payer.
func setup(t *testing.T, token string) (pool *pgxpool.Pool, profile, walletless string) {
	t.Helper()
	ctx := context.Background()
	url := databasetest.New(t)
	if err := database.Migrate(ctx, url); err != nil {
		t.Fatal(err)
	}
	pool, err := database.Open(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	err = pool.QueryRow(ctx, `
		WITH c AS (INSERT INTO chains (chain_id, chain_family, name, enabled) VALUES ($1, 'evm', 'anvil', true)),
		     t1 AS (INSERT INTO tokens (chain_id, chain_family, contract, symbol, decimals, enabled)
		            VALUES ($1, 'evm', $2, 'USDC', 6, true)),
		     t2 AS (INSERT INTO tokens (chain_id, chain_family, contract, symbol, decimals, enabled)
		            VALUES ($1, 'evm', '0x2222222222222222222222222222222222222222', 'OLD', 6, false)),
		     u AS (INSERT INTO users (privy_user_id) VALUES ('did:privy:alice') RETURNING id),
		     p AS (INSERT INTO profiles (user_id, kind) SELECT id, 'personal' FROM u RETURNING id),
		     p2 AS (INSERT INTO profiles (user_id, kind) SELECT id, 'merchant' FROM u RETURNING id),
		     w AS (INSERT INTO profile_wallets (profile_id, provider, provider_wallet_id, chain_family, address)
		           SELECT id, 'privy', 'w1', 'evm', $3 FROM p)
		SELECT (SELECT id::text FROM p), (SELECT id::text FROM p2)`, chaintest.ChainID, token, wallet).Scan(&profile, &walletless)
	if err != nil {
		t.Fatal(err)
	}
	err = pgx.BeginFunc(ctx, pool, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `
			INSERT INTO invoices (id, profile_id, chain_id, chain_family, token_contract, amount, expires_at, settle_deadline,
			    recipient_address, receive_method, factory_address, receive_address, idempotency_key, request_hash)
			VALUES ($1, $2, $3, 'evm', $4, 2000000, 1800000000, 1800086400, $5, 'evm_create2',
			    '0x4444444444444444444444444444444444444444', $6, 'key-1', decode(repeat('00', 32), 'hex'))`,
			invoice, profile, chaintest.ChainID, token, wallet, receive); err != nil {
			return err
		}
		var booked int64
		if err := tx.QueryRow(ctx, `
			WITH d AS (INSERT INTO chain_transfers (chain_id, chain_family, token_contract, invoice_id, tx_hash, log_index,
			               block_hash, block_number, block_time, from_address, to_address, amount, status)
			           VALUES ($1, 'evm', $2, $3, '0x'||repeat('a', 64), 0, '0x'||repeat('1', 64), 10, 1, $4, $5, 1000000, 'detected'),
			                  ($1, 'evm', $2, $3, '0x'||repeat('b', 64), 0, '0x'||repeat('2', 64), 9, 1, $4, $5, 500000, 'reorged'))
			INSERT INTO chain_transfers (chain_id, chain_family, token_contract, invoice_id, tx_hash, log_index, block_hash,
			    block_number, block_time, from_address, to_address, amount, status)
			VALUES ($1, 'evm', $2, $3, '0x'||repeat('c', 64), 0, '0x'||repeat('3', 64), 8, 1, $4, $5, 3000000, 'confirmed')
			RETURNING id`, chaintest.ChainID, token, invoice, chaintest.Sender, receive).Scan(&booked); err != nil {
			return err
		}
		var x int64
		if err := tx.QueryRow(ctx, `INSERT INTO ledger_transactions (invoice_id, kind, chain_transfer_id)
			VALUES ($1, 'deposit', $2) RETURNING id`, invoice, booked).Scan(&x); err != nil {
			return err
		}
		_, err := tx.Exec(ctx, `INSERT INTO ledger_entries (transaction_id, account, amount)
			VALUES ($1, 'receiver', 3000000), ($1, 'recipient_payable', -2000000), ($1, 'payer_held', -1000000)`, x)
		return err
	})
	if err != nil {
		t.Fatal(err)
	}
	return pool, profile, walletless
}

func TestBalancesOnAnvil(t *testing.T) {
	anvil := chaintest.Start(t)
	token := anvil.DeployToken()
	anvil.Mint(token, "1000000000")
	anvil.Transfer(token, wallet, "2500000")
	anvil.Mine(2)                      // the transfer's block becomes final
	anvil.Transfer(token, wallet, "1") // not final yet: not counted
	pool, profile, walletless := setup(t, token)
	s := NewService(pool, ledger.BalanceFrom(map[uint64]*ethclient.Client{chaintest.ChainID: ethclient.NewClient(anvil.RPC)}))
	ctx := context.Background()

	got, err := s.Of(ctx, profile)
	if err != nil {
		t.Fatal(err)
	}
	if len(got.Tokens) != 1 {
		t.Fatalf("%d tokens, want only the enabled one: %+v", len(got.Tokens), got.Tokens)
	}
	tk := got.Tokens[0]
	var final struct{ Number string }
	if err := anvil.RPC.Call(&final, "eth_getBlockByNumber", "finalized", false); err != nil {
		t.Fatal(err)
	}
	if tk.Token != token || tk.Symbol != "USDC" || tk.Decimals != 6 || tk.Wallet == nil || tk.Wallet.Int64() != 2500000 ||
		new(big.Int).SetUint64(tk.Block).Text(16) != final.Number[2:] {
		t.Fatalf("got %+v; want the wallet's 2500000 at the finalized block %s", tk, final.Number)
	}
	if tk.Pending.Int64() != 3000000 || tk.Held.Int64() != 1000000 {
		t.Fatalf("pending %v held %v; want 3000000 (1.0 detected + 2.0 owed) and 1000000", tk.Pending, tk.Held)
	}
	if got.EstimatedUSD != "2.50" {
		t.Fatalf("estimated USD %q, want 2.50", got.EstimatedUSD)
	}

	// A profile without a wallet yet, and an RPC that fails: no balance and no total, never a made-up 0.
	if got, err := s.Of(ctx, walletless); err != nil || got.Tokens[0].Wallet != nil || got.EstimatedUSD != "" {
		t.Fatalf("walletless: %+v, %v", got, err)
	}
	failing := NewService(pool, func(context.Context, uint64, string, string) (*big.Int, uint64, error) {
		return nil, 0, errors.New("rpc down")
	})
	if got, err := failing.Of(ctx, profile); err != nil || got.Tokens[0].Wallet != nil || got.EstimatedUSD != "" ||
		got.Tokens[0].Pending.Int64() != 3000000 {
		t.Fatalf("RPC down: %+v, %v; want pending and held but no wallet balance or total", got, err)
	}
}

// A chain that hangs leaves only its own balance missing: the others are read in their own time.
func TestHungChainLeavesTheOthers(t *testing.T) {
	anvil := chaintest.Start(t)
	token := anvil.DeployToken()
	pool, profile, _ := setup(t, token)
	if _, err := pool.Exec(context.Background(), `
		WITH c AS (INSERT INTO chains (chain_id, chain_family, name, enabled) VALUES (1, 'evm', 'hung', true))
		INSERT INTO tokens (chain_id, chain_family, contract, symbol, decimals, enabled)
		VALUES (1, 'evm', '0x0000000000000000000000000000000000000001', 'USDC', 6, true)`); err != nil {
		t.Fatal(err)
	}
	defer func(old time.Duration) { ReadTimeout = old }(ReadTimeout)
	ReadTimeout = 300 * time.Millisecond
	anvilRead := ledger.BalanceFrom(map[uint64]*ethclient.Client{chaintest.ChainID: ethclient.NewClient(anvil.RPC)})
	s := NewService(pool, func(ctx context.Context, chainID uint64, token, holder string) (*big.Int, uint64, error) {
		if chainID == 1 { // listed first
			<-ctx.Done()
			return nil, 0, ctx.Err()
		}
		return anvilRead(ctx, chainID, token, holder)
	})
	start := time.Now()
	got, err := s.Of(context.Background(), profile)
	if err != nil || len(got.Tokens) != 2 || got.Tokens[0].Wallet != nil || got.Tokens[1].Wallet == nil ||
		got.EstimatedUSD != "" {
		t.Fatalf("got %+v, %v; want the hung chain's balance missing, Anvil's read, and no total", got, err)
	}
	if d := time.Since(start); d > 2*ReadTimeout {
		t.Fatalf("took %v, want about one ReadTimeout (%v)", d, ReadTimeout)
	}
}
