package balance

import (
	"context"
	"errors"
	"fmt"
	"math/big"
	"time"

	"github.com/forwend/forwend/apps/backend/internal/chain"
	"github.com/jackc/pgx/v5"
)

const (
	DefaultDays = 30
	MaxDays     = 365
)

var ErrInvalid = errors.New("invalid balance history request")

// At is the day's end (00:00 UTC of the next day), or now for today; a day's bucket runs from the previous At,
// included, to At, excluded. USD fields count 1 USD per token, 2 decimals; "" when a wallet balance is missing.
type Point struct {
	At                                 time.Time
	EstimatedUSD, ReceivedUSD, SentUSD string
}

// One value per point: the balance at At and the final transfers in its bucket; all nil when the balance is missing.
type TokenHistory struct {
	chain.Asset
	Livemode                 bool
	Balances, Received, Sent []*big.Int
}

type History struct {
	Points []Point
	Tokens []TokenHistory
}

// History covers the last days UTC days, oldest first (R-38): each earlier balance undoes the wallet transfers the
// current one includes. The caller has checked the user's access to the profile.
func (s *Service) History(ctx context.Context, profileID string, days int, now time.Time) (History, error) {
	if days < 1 || days > MaxDays {
		return History{}, fmt.Errorf("%w: days must be 1 to %d", ErrInvalid, MaxDays)
	}
	current, err := s.of(ctx, profileID, false) // only the wallet balances
	if err != nil {
		return History{}, err
	}
	start := now.UTC().Truncate(24*time.Hour).AddDate(0, 0, 1-days)
	h := History{Points: make([]Point, days)}
	for i := range h.Points {
		h.Points[i].At = start.AddDate(0, 0, i+1)
	}
	h.Points[days-1].At = now.UTC()

	// Summed in the database: dust sent to the wallet must not make this read every row (R-118). Only transfers at or
	// below the block a balance was read at count, as the balance includes those.
	var chains, blocks []int64
	var tokens []string
	for _, t := range current.Tokens {
		chains, tokens, blocks = append(chains, int64(t.ChainID)), append(tokens, t.Token), append(blocks, int64(t.Block))
	}
	type key struct {
		chainID uint64
		token   string
		day     int
	}
	moved := map[key][2]*big.Int{} // received, sent
	rows, err := s.pool.Query(ctx, `
		SELECT t.chain_id, t.token_contract, least((t.block_time - $2) / 86400, $3 - 1)::int,
		       coalesce(sum(t.amount) FILTER (WHERE t.direction = 'in'), 0)::text,
		       coalesce(sum(t.amount) FILTER (WHERE t.direction = 'out'), 0)::text
		FROM wallet_transfers t
		JOIN profile_wallets w ON w.chain_family = t.chain_family AND w.address = t.wallet_address
		JOIN unnest($4::bigint[], $5::text[], $6::bigint[]) r (chain_id, token, block)
		    ON r.chain_id = t.chain_id AND r.token = t.token_contract
		WHERE w.profile_id = $1 AND t.status <> 'reorged' AND t.block_time >= $2 AND t.block_number <= r.block
		GROUP BY 1, 2, 3`, profileID, start.Unix(), days, chains, tokens, blocks)
	if err != nil {
		return History{}, fmt.Errorf("read wallet transfers: %w", err)
	}
	var k key
	var in, out string
	if _, err := pgx.ForEachRow(rows, []any{&k.chainID, &k.token, &k.day, &in, &out}, func() error {
		received, _ := new(big.Int).SetString(in, 10)
		sent, _ := new(big.Int).SetString(out, 10)
		moved[k] = [2]*big.Int{received, sent}
		return nil
	}); err != nil {
		return History{}, fmt.Errorf("read wallet transfers: %w", err)
	}

	for _, t := range current.Tokens {
		th := TokenHistory{Asset: t.Asset, Livemode: t.Livemode}
		if t.Wallet != nil {
			th.Balances, th.Received, th.Sent = make([]*big.Int, days), make([]*big.Int, days), make([]*big.Int, days)
			balance := new(big.Int).Set(t.Wallet)
			for i := days - 1; i >= 0; i-- {
				// ponytail: money that moves without a Transfer log of the token (an Arc native-coin send, fees paid
				// in the token) is not undone, so an earlier balance can come out below 0; it shows as 0.
				th.Balances[i] = new(big.Int).Set(balance)
				if balance.Sign() < 0 {
					th.Balances[i].SetInt64(0)
				}
				th.Received[i], th.Sent[i] = new(big.Int), new(big.Int)
				if m, ok := moved[key{t.ChainID, t.Token, i}]; ok {
					th.Received[i], th.Sent[i] = m[0], m[1]
					balance.Sub(balance, m[0])
					balance.Add(balance, m[1])
				}
			}
		}
		h.Tokens = append(h.Tokens, th)
	}

	if current.EstimatedUSD != "" { // every wallet balance was read
		for i := range h.Points {
			h.Points[i].EstimatedUSD = usd(h.Tokens, func(t TokenHistory) *big.Int { return t.Balances[i] })
			h.Points[i].ReceivedUSD = usd(h.Tokens, func(t TokenHistory) *big.Int { return t.Received[i] })
			h.Points[i].SentUSD = usd(h.Tokens, func(t TokenHistory) *big.Int { return t.Sent[i] })
		}
	}
	return h, nil
}

func usd(tokens []TokenHistory, amount func(TokenHistory) *big.Int) string {
	sum := new(big.Rat)
	for _, t := range tokens {
		sum.Add(sum, new(big.Rat).SetFrac(amount(t), new(big.Int).Exp(big.NewInt(10), big.NewInt(int64(t.Decimals)), nil)))
	}
	return usdString(sum)
}
