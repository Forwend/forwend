package ledger

import (
	"context"
	"fmt"
	"math/big"
	"math/rand/v2"
	"testing"

	"github.com/forwend/forwend/apps/backend/internal/database"
	"github.com/forwend/forwend/apps/backend/internal/database/databasetest"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Random deposit sequences with expiry passing at any point; checkInvariants runs after every step.
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
		     cur AS (INSERT INTO chain_cursors (chain_id, last_scanned_block, last_finalized_block) VALUES ($1, 100, 100)),
		     u AS (INSERT INTO users (privy_user_id) VALUES ('did:privy:sim') RETURNING id)
		INSERT INTO profiles (user_id, kind) SELECT id, 'freelancer' FROM u`, chainID, token)
	if err != nil {
		t.Fatal(err)
	}
	onChain := map[string]*big.Int{} // the simulated receive address balances
	lagging := false                 // the second RPC answers 0 from before the finalized block
	service := NewService(pool, func(_ context.Context, _ uint64, _, holder string) (*big.Int, uint64, error) {
		if lagging {
			return new(big.Int), 99, nil
		}
		return new(big.Int).Set(onChain[holder]), 1000, nil
	}, func(context.Context, uint64, string, string) (uint64, error) { return 0, nil })

	const expires = 1_000_000
	var txCounter int
	for seed := uint64(1); seed <= 300; seed++ {
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
		type missed struct{ value, blockTime int64 }
		var unseen []missed // on chain, but the watcher hasn't recorded them yet
		var finalized int64 // chain time only moves forward
		insert := func(value, blockTime int64, status string) int64 {
			txCounter++
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
			if status == "detected" {
				detected = append(detected, tid)
			}
			return tid
		}
		for step := 0; step < 12; step++ {
			switch rng.IntN(5) {
			case 0, 1: // a transfer lands in a new block, on time or late, final or not, or missed by the watcher
				value := int64(1 + rng.IntN(int(amount)))
				blockTime := max(int64(expires-500+rng.IntN(1000)), finalized+1)
				onChain[receive].Add(onChain[receive], big.NewInt(value))
				if rng.IntN(4) == 0 {
					unseen = append(unseen, missed{value, blockTime})
				} else {
					insert(value, blockTime, []string{"detected", "confirmed"}[rng.IntN(2)])
				}
			case 2: // the watcher finds a missed transfer, or a pending one becomes final or is reorged away
				if len(unseen) > 0 && rng.IntN(2) == 0 {
					insert(unseen[0].value, unseen[0].blockTime, "detected")
					unseen = unseen[1:]
					continue
				}
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
			case 3: // chain time moves forward, maybe past expiry
				finalized = max(finalized, int64(expires-300+rng.IntN(600)))
				if _, err := pool.Exec(ctx, "UPDATE chain_cursors SET last_finalized_time = $2 WHERE chain_id = $1",
					chainID, finalized); err != nil {
					t.Fatal(err)
				}
			}
			lagging = rng.IntN(4) == 0
			if err := service.Process(ctx, id); err != nil {
				t.Fatalf("seed %d step %d: %v", seed, step, err)
			}
			checkInvariants(t, pool, seed, id, amount, onChain[receive], false)
		}
		lagging = false
		for _, m := range unseen {
			insert(m.value, m.blockTime, "detected")
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
	// Bookable: confirmed, and booked already or with no earlier transfer still detected (chain order, D-27).
	err := pool.QueryRow(context.Background(), `
		WITH bookable AS (SELECT * FROM chain_transfers t WHERE status = 'confirmed' AND (booked OR NOT EXISTS (
		    SELECT 1 FROM chain_transfers d WHERE d.invoice_id = t.invoice_id AND d.status = 'detected'
		    AND (d.block_number, d.log_index) < (t.block_number, t.log_index))))
		SELECT i.payment_status,
		       coalesce((SELECT sum(e.amount) FROM ledger_entries e JOIN ledger_transactions x ON x.id = e.transaction_id
		                 WHERE x.invoice_id = i.id AND e.account = 'receiver'), 0)::bigint,
		       -coalesce((SELECT sum(e.amount) FROM ledger_entries e JOIN ledger_transactions x ON x.id = e.transaction_id
		                  WHERE x.invoice_id = i.id AND e.account = 'recipient_payable'), 0)::bigint,
		       -coalesce((SELECT sum(e.amount) FROM ledger_entries e JOIN ledger_transactions x ON x.id = e.transaction_id
		                  WHERE x.invoice_id = i.id AND e.account = 'payer_held'), 0)::bigint,
		       coalesce((SELECT sum(amount) FROM bookable WHERE invoice_id = i.id), 0)::bigint,
		       coalesce((SELECT sum(amount) FROM bookable WHERE invoice_id = i.id AND block_time <= i.expires_at), 0)::bigint,
		       (SELECT count(*) FROM bookable WHERE invoice_id = i.id AND NOT booked)
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
	case (payment == Expired || payment == ExpiredPartiallyPaid) && onTime >= amount:
		fail("an invoice paid in full on time never expires")
	case allFinal && big.NewInt(receiver).Cmp(onChain) != 0:
		fail("once everything is final the ledger equals the receive address balance")
	}
}
