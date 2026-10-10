// Package balance shows a profile's money per chain and token (R-33): the wallet's balance read at the second RPC's
// finalized block (D-15, D-45), and apart from it what is on its way to the wallet and what is held for payers. It
// also rebuilds the wallet balance per day from the recorded wallet transfers (R-38).
package balance

import (
	"context"
	"fmt"
	"log/slog"
	"math/big"
	"sync"
	"time"

	"github.com/ensp1re/forwend/apps/backend/internal/chain"
	"github.com/ensp1re/forwend/apps/backend/internal/ledger"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ReadTimeout bounds each chain read; reads run in parallel, so one request waits about this long at most, under
// the api's 30 s write timeout.
var ReadTimeout = 10 * time.Second

// Token is the profile's money in one enabled token.
type Token struct {
	ChainID  uint64
	Token    string
	Symbol   string
	Decimals int
	// Wallet is the wallet's balance at Block, the second RPC's finalized block; nil when it could not be read or the
	// profile has no wallet yet.
	Wallet *big.Int
	Block  uint64
	// Pending is not in the wallet yet: deposits the ledger has not booked (a late or extra one later moves to Held),
	// plus booked money owed to the creator and not settled yet. Held is booked money held for payers, never the
	// creator's. Wallet comes from the chain and these from our records at a different moment, so right after a
	// settlement the amount can briefly show in both or in neither.
	Pending *big.Int
	Held    *big.Int
}

// Balances are the profile's tokens. EstimatedUSD is the sum of the wallet balances at 1 USD per token (all enabled
// tokens are USD stablecoins), with 2 decimals; "" when a wallet balance is missing.
type Balances struct {
	Tokens       []Token
	EstimatedUSD string
}

type Service struct {
	pool *pgxpool.Pool
	read ledger.BalanceOf
}

// NewService reads wallet balances with read; give it each chain's second RPC (D-15).
func NewService(pool *pgxpool.Pool, read ledger.BalanceOf) *Service {
	return &Service{pool: pool, read: read}
}

// Of returns the profile's balances in every enabled token on every enabled chain. The caller has checked that the
// user owns the profile.
func (s *Service) Of(ctx context.Context, profileID string) (Balances, error) {
	var wallet string
	if err := s.pool.QueryRow(ctx, `SELECT coalesce((SELECT address FROM profile_wallets
		WHERE profile_id = $1 AND chain_family = 'evm'), '')`, profileID).Scan(&wallet); err != nil {
		return Balances{}, fmt.Errorf("read profile wallet: %w", err)
	}
	// Ledger credits are negative: minus the sum is what is owed.
	rows, err := s.pool.Query(ctx, `
		SELECT t.chain_id, t.contract, t.symbol, t.decimals,
		    ((SELECT coalesce(sum(ct.amount), 0) FROM chain_transfers ct JOIN invoices i ON i.id = ct.invoice_id
		      WHERE i.profile_id = $1 AND ct.chain_id = t.chain_id AND ct.token_contract = t.contract
		        AND ct.status <> 'reorged' AND NOT ct.booked)
		     - (SELECT coalesce(sum(e.amount), 0) FROM ledger_entries e
		        JOIN ledger_transactions x ON x.id = e.transaction_id JOIN invoices i ON i.id = x.invoice_id
		        WHERE i.profile_id = $1 AND i.chain_id = t.chain_id AND i.token_contract = t.contract
		          AND e.account = 'recipient_payable'))::text,
		    (-(SELECT coalesce(sum(e.amount), 0) FROM ledger_entries e
		       JOIN ledger_transactions x ON x.id = e.transaction_id JOIN invoices i ON i.id = x.invoice_id
		       WHERE i.profile_id = $1 AND i.chain_id = t.chain_id AND i.token_contract = t.contract
		         AND e.account = 'payer_held'))::text
		FROM tokens t JOIN chains c ON c.chain_id = t.chain_id
		WHERE c.enabled AND t.enabled AND c.chain_family = 'evm'
		ORDER BY t.chain_id, t.contract`, profileID)
	if err != nil {
		return Balances{}, fmt.Errorf("read profile balances: %w", err)
	}
	tokens, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (Token, error) {
		var t Token
		var pending, held string
		err := row.Scan(&t.ChainID, &t.Token, &t.Symbol, &t.Decimals, &pending, &held)
		t.Pending, _ = new(big.Int).SetString(pending, 10)
		t.Held, _ = new(big.Int).SetString(held, 10)
		return t, err
	})
	if err != nil {
		return Balances{}, fmt.Errorf("read profile balances: %w", err)
	}

	if wallet != "" {
		var wg sync.WaitGroup
		for i := range tokens {
			wg.Add(1)
			go func(t *Token) {
				defer wg.Done()
				ctx, cancel := context.WithTimeout(ctx, ReadTimeout)
				defer cancel()
				balance, block, err := s.read(ctx, t.ChainID, t.Token, wallet)
				if err != nil {
					slog.Warn("read wallet balance", "chain", t.ChainID, "token", t.Token, "err", chain.Redact(err))
					return
				}
				t.Wallet, t.Block = balance, block
			}(&tokens[i])
		}
		wg.Wait()
	}
	usd, complete := new(big.Rat), wallet != ""
	for _, t := range tokens {
		if t.Wallet == nil {
			complete = false
			continue
		}
		usd.Add(usd, new(big.Rat).SetFrac(t.Wallet, new(big.Int).Exp(big.NewInt(10), big.NewInt(int64(t.Decimals)), nil)))
	}
	out := Balances{Tokens: tokens}
	if complete {
		out.EstimatedUSD = usdString(usd)
	}
	return out, nil
}

// usdString cuts a non-negative USD amount to cents; big.Rat.FloatString would round half up, showing money the
// wallet does not hold.
func usdString(amount *big.Rat) string {
	cents := new(big.Int).Quo(new(big.Int).Mul(amount.Num(), big.NewInt(100)), amount.Denom())
	whole, rest := new(big.Int).QuoRem(cents, big.NewInt(100), new(big.Int))
	return fmt.Sprintf("%s.%02d", whole, rest.Int64())
}
