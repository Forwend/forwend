// Package balance shows a profile's money per chain and token: wallet balances, pending and held money.
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

// Token is one token's wallet balance and the money our records still owe or hold.
type Token struct {
	chain.Asset
	Livemode   bool
	Sendable   bool
	Wallet     *big.Int // nil when unread
	Block      uint64
	Pending    *big.Int // Settling + Confirming + Partial
	Settling   *big.Int
	Confirming *big.Int
	Partial    *big.Int
	Held       *big.Int
}

type Balances struct {
	Tokens       []Token
	EstimatedUSD string // 1 USD per token; "" if a balance is missing
}

type Service struct {
	pool        *pgxpool.Pool
	read        ledger.BalanceOf
	readTimeout time.Duration
}

func NewService(pool *pgxpool.Pool, read ledger.BalanceOf) *Service {
	return &Service{pool: pool, read: read, readTimeout: 10 * time.Second}
}

// Of expects the caller to have checked the user's access to the profile.
func (s *Service) Of(ctx context.Context, profileID string) (Balances, error) {
	return s.of(ctx, profileID, true)
}

// tokenColumns and profileTokens list the enabled tokens of a profile's mode; Sendable is tokenColumns' last.
const (
	tokenColumns  = `t.chain_id, t.contract, t.symbol, t.decimals, c.livemode, t.native_gas OR t.fee_asset IS NOT NULL`
	profileTokens = `c.enabled AND t.enabled AND c.chain_family = 'evm'
		AND c.livemode = (SELECT livemode FROM profiles WHERE id = $1) ORDER BY t.chain_id, t.contract`
)

// of lists only the profile's mode, so USD never adds testnet money; without records pending and held are 0.
func (s *Service) of(ctx context.Context, profileID string, records bool) (Balances, error) {
	var wallet string
	if err := s.pool.QueryRow(ctx, `SELECT coalesce((SELECT address FROM profile_wallets
		WHERE profile_id = $1 AND chain_family = 'evm'), '')`, profileID).Scan(&wallet); err != nil {
		return Balances{}, fmt.Errorf("read profile wallet: %w", err)
	}
	// Credits are negative, so minus the sum is what is owed. An option paid in full waits for the
	// finalized balance check, so it is confirming; settlement pays its fees out of what is owed.
	query, args := `
		WITH options AS (
		    SELECT i.chain_id, i.token_contract,
		        CASE WHEN i.payment_status = 'paid' THEN 'settling'
		            WHEN i.payment_status = 'partially_paid'
		                AND -coalesce(sum(e.amount) FILTER (WHERE e.account = 'recipient_payable'), 0) < i.amount THEN 'partial'
		            ELSE 'confirming' END AS part,
		        greatest(-coalesce(sum(e.amount) FILTER (WHERE e.account = 'recipient_payable'), 0)
		            - (i.network_fee + i.platform_fee), 0) AS payable,
		        -coalesce(sum(e.amount) FILTER (WHERE e.account = 'payer_held'), 0) AS held
		    FROM invoices i JOIN ledger_transactions x ON x.invoice_id = i.id JOIN ledger_entries e ON e.transaction_id = x.id
		    WHERE i.profile_id = $1 AND (`+ledger.MayHoldMoneySQL+`) AND e.account IN ('recipient_payable', 'payer_held')
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
		SELECT `+tokenColumns+`, coalesce(b.settling, 0)::text,
		    (coalesce(u.amount, 0) + coalesce(b.confirming, 0))::text, coalesce(b.partial, 0)::text,
		    coalesce(b.held, 0)::text
		FROM tokens t JOIN chains c ON c.chain_id = t.chain_id
		LEFT JOIN booked b ON b.chain_id = t.chain_id AND b.token_contract = t.contract
		LEFT JOIN unbooked u ON u.chain_id = t.chain_id AND u.token_contract = t.contract
		WHERE `+profileTokens, []any{profileID}
	if !records {
		query = `SELECT ` + tokenColumns + `, '0', '0', '0', '0' FROM tokens t JOIN chains c ON c.chain_id = t.chain_id
			WHERE ` + profileTokens
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
				ctx, cancel := context.WithTimeout(ctx, s.readTimeout)
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

// usdString cuts to cents: FloatString would round half up and show money the wallet does not hold.
func usdString(amount *big.Rat) string {
	cents := new(big.Int).Quo(new(big.Int).Mul(amount.Num(), big.NewInt(100)), amount.Denom())
	whole, rest := new(big.Int).QuoRem(cents, big.NewInt(100), new(big.Int))
	return fmt.Sprintf("%s.%02d", whole, rest.Int64())
}
