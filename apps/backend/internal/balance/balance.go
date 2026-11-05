// Package balance shows a profile's money per chain and token (R-33): the wallet balance at the selected RPC's
// finalized block (D-15, D-45), pending and held money apart from it, and the daily wallet balance (R-38).
package balance

import (
	"context"
	"fmt"
	"log/slog"
	"math/big"
	"sync"
	"time"

	"github.com/forwend/forwend/apps/backend/internal/chain"
	"github.com/forwend/forwend/apps/backend/internal/ledger"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ReadTimeout bounds each chain read; reads run in parallel, so one request waits about this long at most, under
// the api's 30 s write timeout.
var ReadTimeout = 10 * time.Second

type Token struct {
	chain.Asset
	Livemode bool
	// Sendable: Send offers it: Forwend pays the gas, or the token is the gas coin the wallet pays with (D-119, R-216).
	Sendable bool
	// Wallet is the wallet's balance at Block, the selected RPC's finalized block; nil when it could not be read or the
	// profile has no wallet yet.
	Wallet *big.Int
	Block  uint64
	// Pending: unbooked deposits plus booked money owed to the creator, which is Settling + Confirming + Partial.
	// Held: booked money for payers, unless reopened (R-130); never the owner's (D-114).
	// They come from our records at another moment than Wallet, so after a settlement an amount can show in both or neither.
	Pending *big.Int
	// Settling: owed to the creator on paid payments, waiting for the transfer to the wallet.
	Settling *big.Int
	// Confirming: deposits not booked yet, and money owed to the creator on a payment paid in full that waits for the
	// finalized balance check.
	Confirming *big.Int
	// Partial: owed to the creator on partly paid payments; it is held for the payer if the checkout closes first (D-26).
	Partial *big.Int
	Held    *big.Int
}

// EstimatedUSD sums the wallet balances at 1 USD per token (all enabled tokens are USD stablecoins), with 2
// decimals; "" when a wallet balance is missing.
type Balances struct {
	Tokens       []Token
	EstimatedUSD string
}

type Service struct {
	pool *pgxpool.Pool
	read ledger.BalanceOf
}

// NewService reads wallet balances with read; give it each chain's RPC pool (D-15).
func NewService(pool *pgxpool.Pool, read ledger.BalanceOf) *Service {
	return &Service{pool: pool, read: read}
}

// The caller has checked the user's access to the profile.
func (s *Service) Of(ctx context.Context, profileID string) (Balances, error) {
	return s.of(ctx, profileID, true)
}

// of reads the wallet balances and, with records, pending and held from our records; without, those are 0.
func (s *Service) of(ctx context.Context, profileID string, records bool) (Balances, error) {
	var wallet string
	if err := s.pool.QueryRow(ctx, `SELECT coalesce((SELECT address FROM profile_wallets
		WHERE profile_id = $1 AND chain_family = 'evm'), '')`, profileID).Scan(&wallet); err != nil {
		return Balances{}, fmt.Errorf("read profile wallet: %w", err)
	}
	// One pass over the profile's ledger: credits are negative, so minus the sum is what is owed. A partly paid
	// option paid in full waits for the finalized balance check and never expires (ledger.status), so it is confirming.
	query, args := `
		WITH options AS (
		    SELECT i.chain_id, i.token_contract,
		        CASE WHEN i.payment_status = 'paid' THEN 'settling'
		            WHEN i.payment_status = 'partially_paid'
		                AND -coalesce(sum(e.amount) FILTER (WHERE e.account = 'recipient_payable'), 0) < i.amount THEN 'partial'
		            ELSE 'confirming' END AS part,
		        -coalesce(sum(e.amount) FILTER (WHERE e.account = 'recipient_payable'), 0) AS payable,
		        -coalesce(sum(e.amount) FILTER (WHERE e.account = 'payer_held'), 0) AS held
		    FROM invoices i JOIN ledger_transactions x ON x.invoice_id = i.id JOIN ledger_entries e ON e.transaction_id = x.id
		    WHERE i.profile_id = $1 AND e.account IN ('recipient_payable', 'payer_held')
		    GROUP BY i.id
		), booked AS (
		    SELECT chain_id, token_contract, sum(payable) FILTER (WHERE part = 'settling') AS settling,
		        sum(payable) FILTER (WHERE part = 'confirming') AS confirming,
		        sum(payable) FILTER (WHERE part = 'partial') AS partial, sum(held) AS held
		    FROM options GROUP BY chain_id, token_contract
		), unbooked AS (
		    -- Not reorged and not booked, written as the predicates of the detected and pending transfer indexes.
		    SELECT ct.chain_id, ct.token_contract, sum(ct.amount) AS amount
		    FROM chain_transfers ct JOIN invoices i ON i.id = ct.invoice_id
		    WHERE i.profile_id = $1 AND (ct.status = 'detected' AND NOT ct.booked OR ct.status = 'confirmed' AND NOT ct.booked)
		    GROUP BY ct.chain_id, ct.token_contract
		)
		SELECT t.chain_id, t.contract, t.symbol, t.decimals, c.livemode, c.gas_sponsored OR t.native_gas, coalesce(b.settling, 0)::text,
		    (coalesce(u.amount, 0) + coalesce(b.confirming, 0))::text, coalesce(b.partial, 0)::text,
		    coalesce(b.held, 0)::text
		FROM tokens t JOIN chains c ON c.chain_id = t.chain_id
		LEFT JOIN booked b ON b.chain_id = t.chain_id AND b.token_contract = t.contract
		LEFT JOIN unbooked u ON u.chain_id = t.chain_id AND u.token_contract = t.contract
		WHERE c.enabled AND t.enabled AND c.chain_family = 'evm'
		ORDER BY t.chain_id, t.contract`, []any{profileID}
	if !records {
		query, args = `SELECT t.chain_id, t.contract, t.symbol, t.decimals, c.livemode, c.gas_sponsored OR t.native_gas, '0', '0', '0', '0'
			FROM tokens t JOIN chains c ON c.chain_id = t.chain_id
			WHERE c.enabled AND t.enabled AND c.chain_family = 'evm'
			ORDER BY t.chain_id, t.contract`, nil
	}
	rows, err := s.pool.Query(ctx, query, args...)
	if err != nil {
		return Balances{}, fmt.Errorf("read profile balances: %w", err)
	}
	tokens, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (Token, error) {
		var t Token
		var settling, confirming, partial, held string
		err := row.Scan(&t.ChainID, &t.Token, &t.Symbol, &t.Decimals, &t.Livemode, &t.Sendable, &settling, &confirming, &partial, &held)
		t.Settling, _ = new(big.Int).SetString(settling, 10)
		t.Confirming, _ = new(big.Int).SetString(confirming, 10)
		t.Partial, _ = new(big.Int).SetString(partial, 10)
		t.Held, _ = new(big.Int).SetString(held, 10)
		t.Pending = new(big.Int).Add(t.Settling, t.Confirming)
		t.Pending.Add(t.Pending, t.Partial)
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
