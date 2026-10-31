package balance

import (
	"context"
	"errors"
	"fmt"
	"math/big"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/ethereum/go-ethereum/ethclient"
	"github.com/forwend/forwend/apps/backend/internal/chaintest"
	"github.com/forwend/forwend/apps/backend/internal/database"
	"github.com/forwend/forwend/apps/backend/internal/database/databasetest"
	"github.com/forwend/forwend/apps/backend/internal/ledger"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	wallet  = "0x1111111111111111111111111111111111111111"
	receive = "0x3333333333333333333333333333333333333333"
	invoice = "0xab00000000000000000000000000000000000000000000000000000000000001"
)

// setup's invoice has 1.0 detected (pending), 0.5 reorged (ignored), and 3.0 confirmed and booked as 2.0 owed to
// the creator (pending) and 1.0 held for the payer.
func setup(t *testing.T, token string) (pool *pgxpool.Pool, profile, walletless string) {
	t.Helper()
	ctx := context.Background()
	url := databasetest.Migrated(t, database.Migrate)
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

// D-114: pending splits into exact parts by what each part waits for; held stays apart from all of them.
func TestPendingParts(t *testing.T) {
	const token = "0x036cbd53842c5426634e7929541ec2318f3dcf7e"
	pool, profile, _ := setup(t, token) // open, its whole amount booked (2.0, confirming), 1.0 detected, 1.0 held
	ctx := context.Background()
	// Each option's status, amount and one booked deposit: its part for the creator and its part held for the payer.
	for i, o := range []struct {
		status              string
		amount, owner, held int64
	}{
		{"paid", 3000000, 3000000, 500000},      // settling
		{"paid", 1000000, 1000000, 0},           // settling
		{"partially_paid", 5000000, 700000, 0},  // partial: it can still close and be held
		{"partially_paid", 2000000, 2000000, 0}, // paid in full after a part, waiting for the balance check: confirming
		{"expired_partially_paid", 5000000, 0, 1500000},
	} {
		id := fmt.Sprintf("0xab%062x", i+2)
		if err := pgx.BeginFunc(ctx, pool, func(tx pgx.Tx) error {
			if _, err := tx.Exec(ctx, `INSERT INTO invoices (id, profile_id, chain_id, chain_family, token_contract, amount,
			        expires_at, settle_deadline, recipient_address, receive_method, factory_address, receive_address,
			        idempotency_key, request_hash)
			    VALUES ($1, $2, $3, 'evm', $4, $5, 1800000000, 1800086400, $6, 'evm_create2',
			        '0x4444444444444444444444444444444444444444', $7, $1, decode(repeat('00', 32), 'hex'))`,
				id, profile, chaintest.ChainID, token, o.amount, wallet, fmt.Sprintf("0x33%038x", i+2)); err != nil {
				return err
			}
			_, err := tx.Exec(ctx, `
			    WITH d AS (INSERT INTO chain_transfers (chain_id, chain_family, token_contract, invoice_id, tx_hash, log_index,
			            block_hash, block_number, block_time, from_address, to_address, amount, status)
			        SELECT $1, 'evm', $2, $3, $3, 0, $3, 7, 1, $4, receive_address, $5::numeric + $6, 'confirmed'
			        FROM invoices WHERE id = $3 RETURNING id),
			    x AS (INSERT INTO ledger_transactions (invoice_id, kind, chain_transfer_id) SELECT $3, 'deposit', id FROM d
			        RETURNING id)
			    INSERT INTO ledger_entries (transaction_id, account, amount)
			    SELECT id, 'receiver', $5::numeric + $6 FROM x
			    UNION ALL SELECT id, 'recipient_payable', -$5::numeric FROM x WHERE $5 > 0
			    UNION ALL SELECT id, 'payer_held', -$6::numeric FROM x WHERE $6 > 0`,
				chaintest.ChainID, token, id, chaintest.Sender, o.owner, o.held)
			if err != nil {
				return err
			}
			_, err = tx.Exec(ctx, "UPDATE invoices SET payment_status = $2 WHERE id = $1", id, o.status)
			return err
		}); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := pool.Exec(ctx, `
		WITH c AS (INSERT INTO chains (chain_id, chain_family, name, enabled, livemode) VALUES (8453, 'evm', 'base', true, true))
		INSERT INTO tokens (chain_id, chain_family, contract, symbol, decimals, enabled)
		VALUES (8453, 'evm', $1, 'USDC', 6, true)`, token); err != nil {
		t.Fatal(err)
	}
	s := NewService(pool, func(context.Context, uint64, string, string) (*big.Int, uint64, error) {
		return big.NewInt(0), 1, nil
	})
	got, err := s.Of(ctx, profile)
	if err != nil {
		t.Fatal(err)
	}
	var lines []string
	for _, tk := range got.Tokens {
		lines = append(lines, fmt.Sprintf("%d live=%t pending=%s settling=%s confirming=%s partial=%s held=%s", tk.ChainID,
			tk.Livemode, tk.Pending, tk.Settling, tk.Confirming, tk.Partial, tk.Held))
	}
	want := []string{
		"8453 live=true pending=0 settling=0 confirming=0 partial=0 held=0",
		fmt.Sprintf("%d live=false pending=9700000 settling=4000000 confirming=5000000 partial=700000 held=3000000",
			chaintest.ChainID),
	}
	if !reflect.DeepEqual(lines, want) {
		t.Fatalf("got\n%s\nwant\n%s", strings.Join(lines, "\n"), strings.Join(want, "\n"))
	}
}

func TestHungChainLeavesTheOthers(t *testing.T) {
	anvil := chaintest.Start(t)
	token := anvil.DeployToken()
	anvil.Mine(2) // the token exists at the finalized block the read uses
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
