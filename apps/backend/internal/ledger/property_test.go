package ledger

import (
	"context"
	"fmt"
	"math/big"
	"math/rand/v2"
	"testing"

	"github.com/ensp1re/forwend/apps/backend/internal/database"
	"github.com/ensp1re/forwend/apps/backend/internal/database/databasetest"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Random deposit sequences: transfers that arrive on time or late, get confirmed or reorged, and expiry passing at
// any point. After every step the ledger holds exactly the booked money, split between creator and payers, never
// above the receive address balance; once everything is final it equals that balance.
func TestLedgerMatchesTheReceiverBalance(t *testing.T) {
	ctx := context.Background()
	url := databasetest.New(t)
	if err := database.Migrate(ctx, url); err != nil {
		t.Fatal(err)
	}
	pool, err := database.Open(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	const token, chainID = "0x00000000000000000000000000000000000000ee", 1
	_, err = pool.Exec(ctx, `
		WITH c AS (INSERT INTO chains (chain_id, chain_family, name, enabled) VALUES ($1, 'evm', 'sim', true)),
		     tk AS (INSERT INTO tokens (chain_id, chain_family, contract, symbol, decimals, enabled)
		            VALUES ($1, 'evm', $2, 'USDC', 6, true)),
		     cur AS (INSERT INTO chain_cursors (chain_id, last_scanned_block, last_finalized_block) VALUES ($1, 0, 0)),
		     u AS (INSERT INTO users (privy_user_id) VALUES ('did:privy:sim') RETURNING id)
		INSERT INTO profiles (user_id, kind) SELECT id, 'freelancer' FROM u`, chainID, token)
	if err != nil {
		t.Fatal(err)
	}
	onChain := map[string]*big.Int{} // the simulated receive address balances
	service := NewService(pool, func(_ context.Context, _ uint64, _, holder string) (*big.Int, error) {
		return new(big.Int).Set(onChain[holder]), nil
	})

	const expires = 1_000_000
	var txCounter int
	for seed := uint64(1); seed <= 40; seed++ {
		rng := rand.New(rand.NewPCG(seed, 0))
		id, receive := fmt.Sprintf("0x%064x", seed), fmt.Sprintf("0x%040x", 0x1000+seed)
		amount := int64(1 + rng.IntN(10_000_000))
		onChain[receive] = new(big.Int)
		if _, err := pool.Exec(ctx, "UPDATE chain_cursors SET last_finalized_time = 0 WHERE chain_id = $1", chainID); err != nil {
			t.Fatal(err)
		}
		_, err := pool.Exec(ctx, `
			INSERT INTO invoices (id, profile_id, chain_id, chain_family, token_contract, amount, expires_at, settle_deadline,
			    recipient_address, receive_method, factory_address, receive_address, idempotency_key, request_hash)
			SELECT $1, id, $2, 'evm', $3, $4, $5::bigint, $5::bigint + 86400, '0x1111111111111111111111111111111111111111', 'evm_create2',
			    '0x2222222222222222222222222222222222222222', $6, $1, decode(repeat('00', 32), 'hex') FROM profiles`,
			id, chainID, token, amount, int64(expires), receive)
		if err != nil {
			t.Fatal(err)
		}

		var detected []int64 // transfer ids not final yet
		for step := 0; step < 12; step++ {
			switch rng.IntN(5) {
			case 0, 1: // a transfer lands, on time or late, final or not
				txCounter++
				value := int64(1 + rng.IntN(int(amount)))
				status := []string{"detected", "confirmed"}[rng.IntN(2)]
				blockTime := int64(expires - 500 + rng.IntN(1000))
				var tid int64
				err := pool.QueryRow(ctx, `
					INSERT INTO chain_transfers (chain_id, chain_family, token_contract, invoice_id, tx_hash, log_index,
					    block_hash, block_number, block_time, from_address, to_address, amount, status)
					VALUES ($1, 'evm', $2, $3, $4, 0, $4, $5, $6, '0x00000000000000000000000000000000000000ff', $7, $8, $9)
					RETURNING id`, chainID, token, id, fmt.Sprintf("0x%064x", txCounter), txCounter, blockTime,
					receive, value, status).Scan(&tid)
				if err != nil {
					t.Fatal(err)
				}
				onChain[receive].Add(onChain[receive], big.NewInt(value))
				if status == "detected" {
					detected = append(detected, tid)
				}
			case 2: // a pending transfer becomes final, or is reorged away
				if len(detected) == 0 {
					continue
				}
				i := rng.IntN(len(detected))
				tid := detected[i]
				detected = append(detected[:i], detected[i+1:]...)
				if rng.IntN(3) == 0 {
					var value int64
					if err := pool.QueryRow(ctx, `UPDATE chain_transfers SET status = 'reorged' WHERE id = $1
						RETURNING amount::bigint`, tid).Scan(&value); err != nil {
						t.Fatal(err)
					}
					onChain[receive].Sub(onChain[receive], big.NewInt(value))
				} else if _, err := pool.Exec(ctx, "UPDATE chain_transfers SET status = 'confirmed' WHERE id = $1", tid); err != nil {
					t.Fatal(err)
				}
			case 3: // chain time moves, maybe past expiry
				if _, err := pool.Exec(ctx, "UPDATE chain_cursors SET last_finalized_time = $2 WHERE chain_id = $1",
					chainID, int64(expires-300+rng.IntN(600))); err != nil {
					t.Fatal(err)
				}
			}
			if err := service.Process(ctx, id); err != nil {
				t.Fatalf("seed %d step %d: %v", seed, step, err)
			}
			checkInvariants(t, pool, seed, id, amount, onChain[receive], false)
		}
		for _, tid := range detected { // everything becomes final
			if _, err := pool.Exec(ctx, "UPDATE chain_transfers SET status = 'confirmed' WHERE id = $1", tid); err != nil {
				t.Fatal(err)
			}
		}
		if err := service.Process(ctx, id); err != nil {
			t.Fatal(err)
		}
		checkInvariants(t, pool, seed, id, amount, onChain[receive], true)
	}
}

func checkInvariants(t *testing.T, pool *pgxpool.Pool, seed uint64, id string, amount int64, onChain *big.Int, allFinal bool) {
	t.Helper()
	var payment string
	var receiver, owed, held, confirmed, onTime, unbooked int64
	err := pool.QueryRow(context.Background(), `
		SELECT i.payment_status,
		       coalesce((SELECT sum(e.amount) FROM ledger_entries e JOIN ledger_transactions x ON x.id = e.transaction_id
		                 WHERE x.invoice_id = i.id AND e.account = 'receiver'), 0)::bigint,
		       -coalesce((SELECT sum(e.amount) FROM ledger_entries e JOIN ledger_transactions x ON x.id = e.transaction_id
		                  WHERE x.invoice_id = i.id AND e.account = 'recipient_payable'), 0)::bigint,
		       -coalesce((SELECT sum(e.amount) FROM ledger_entries e JOIN ledger_transactions x ON x.id = e.transaction_id
		                  WHERE x.invoice_id = i.id AND e.account = 'payer_held'), 0)::bigint,
		       coalesce((SELECT sum(amount) FROM chain_transfers WHERE invoice_id = i.id AND status = 'confirmed'), 0)::bigint,
		       coalesce((SELECT sum(amount) FROM chain_transfers WHERE invoice_id = i.id AND status = 'confirmed'
		                 AND block_time <= i.expires_at), 0)::bigint,
		       (SELECT count(*) FROM chain_transfers WHERE invoice_id = i.id AND status = 'confirmed' AND NOT booked)
		FROM invoices i WHERE i.id = $1`, id).Scan(&payment, &receiver, &owed, &held, &confirmed, &onTime, &unbooked)
	if err != nil {
		t.Fatal(err)
	}
	fail := func(rule string) {
		t.Helper()
		t.Fatalf("seed %d: %s: status %s, receiver %d, owed %d, held %d, confirmed %d, on chain %s, amount %d",
			seed, rule, payment, receiver, owed, held, confirmed, onChain, amount)
	}
	switch {
	case unbooked != 0 || receiver != confirmed:
		fail("every confirmed transfer is booked once")
	case owed+held != receiver:
		fail("the receiver balance is exactly what is owed")
	case owed < 0 || held < 0 || owed > amount:
		fail("never owe the creator more than the amount")
	case owed > onTime:
		fail("late deposits are never owed to the creator")
	case big.NewInt(receiver).Cmp(onChain) > 0:
		fail("the ledger never exceeds the receive address balance")
	case payment == Paid && owed != amount:
		fail("paid means the full amount is owed to the creator")
	case (payment == Expired || payment == ExpiredPartiallyPaid) && owed != 0:
		fail("an expired invoice owes the creator nothing")
	case allFinal && big.NewInt(receiver).Cmp(onChain) != 0:
		fail("once everything is final the ledger equals the receive address balance")
	}
}
