package balance

import (
	"context"
	"errors"
	"fmt"
	"math/big"
	"time"

	"github.com/jackc/pgx/v5"
)

// Bounds of a balance history, in days.
const (
	DefaultDays = 30
	MaxDays     = 365
)

// ErrInvalid wraps a days value out of range.
var ErrInvalid = errors.New("invalid balance history request")

// Point is one UTC day of a history. At is the day's end (00:00 UTC of the next day), or now for today. The day's
// bucket runs from the previous point (for the first, the day's start), included, to At, excluded: a transfer at
// 00:00 UTC belongs to the day that starts then. Today's has no end, so it holds every transfer the current balance
// includes. The USD fields count each token as 1 USD with 2 decimals; "" when a wallet balance is missing, as in
// Balances.
type Point struct {
	At                                 time.Time
	EstimatedUSD, ReceivedUSD, SentUSD string
}

// TokenHistory is one token's series, one value per point: the wallet balance at At, and the sum of final transfers
// in and out during its bucket. All three are nil when the current wallet balance is missing.
type TokenHistory struct {
	ChainID                  uint64
	Token                    string
	Symbol                   string
	Decimals                 int
	Balances, Received, Sent []*big.Int
}

type History struct {
	Points []Point
	Tokens []TokenHistory
}

// History returns the profile's balances over the last days UTC days, today included, oldest first (R-38). The last
// balance is the current one from Of; each earlier one undoes the recorded wallet transfers after it that the current
// balance includes: not reorged and at or below the finalized block it was read at. The caller has checked that the
// user owns the profile.
func (s *Service) History(ctx context.Context, profileID string, days int, now time.Time) (History, error) {
	if days < 1 || days > MaxDays {
		return History{}, fmt.Errorf("%w: days must be 1 to %d", ErrInvalid, MaxDays)
	}
	current, err := s.Of(ctx, profileID)
	if err != nil {
		return History{}, err
	}
	start := now.UTC().Truncate(24*time.Hour).AddDate(0, 0, 1-days)
	h := History{Points: make([]Point, days)}
	for i := range h.Points {
		h.Points[i].At = start.AddDate(0, 0, i+1)
	}
	h.Points[days-1].At = now.UTC()

	type key struct {
		chainID uint64
		token   string
	}
	type move struct {
		block  uint64
		time   int64
		in     bool
		amount *big.Int
	}
	moves := map[key][]move{} // newest first
	rows, err := s.pool.Query(ctx, `
		SELECT t.chain_id, t.token_contract, t.block_number, t.block_time, t.direction = 'in', t.amount::text
		FROM wallet_transfers t
		JOIN profile_wallets w ON w.chain_family = t.chain_family AND w.address = t.wallet_address
		WHERE w.profile_id = $1 AND t.status <> 'reorged' AND t.block_time >= $2
		ORDER BY t.block_time DESC, t.id DESC`, profileID, start.Unix())
	if err != nil {
		return History{}, fmt.Errorf("read wallet transfers: %w", err)
	}
	var k key
	var m move
	var amount string
	if _, err := pgx.ForEachRow(rows, []any{&k.chainID, &k.token, &m.block, &m.time, &m.in, &amount}, func() error {
		m.amount, _ = new(big.Int).SetString(amount, 10)
		moves[k] = append(moves[k], m)
		return nil
	}); err != nil {
		return History{}, fmt.Errorf("read wallet transfers: %w", err)
	}

	for _, t := range current.Tokens {
		th := TokenHistory{ChainID: t.ChainID, Token: t.Token, Symbol: t.Symbol, Decimals: t.Decimals}
		if t.Wallet != nil {
			th.Balances, th.Received, th.Sent = make([]*big.Int, days), make([]*big.Int, days), make([]*big.Int, days)
			balance, left := new(big.Int).Set(t.Wallet), moves[key{t.ChainID, t.Token}]
			for i := days - 1; i >= 0; i-- {
				// ponytail: money that moves without a Transfer log of the token (an Arc native-coin send, fees paid
				// in the token) is not undone, so an earlier balance can come out below 0; it shows as 0.
				th.Balances[i] = new(big.Int).Set(balance)
				if balance.Sign() < 0 {
					th.Balances[i].SetInt64(0)
				}
				th.Received[i], th.Sent[i] = new(big.Int), new(big.Int)
				from := start
				if i > 0 {
					from = h.Points[i-1].At
				}
				for ; len(left) > 0 && left[0].time >= from.Unix(); left = left[1:] {
					m := left[0]
					switch {
					case m.block > t.Block: // not final at the block the balance was read at
					case m.in:
						th.Received[i].Add(th.Received[i], m.amount)
						balance.Sub(balance, m.amount)
					default:
						th.Sent[i].Add(th.Sent[i], m.amount)
						balance.Add(balance, m.amount)
					}
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

// usd sums one amount per token at 1 USD per token, cut to cents.
func usd(tokens []TokenHistory, amount func(TokenHistory) *big.Int) string {
	sum := new(big.Rat)
	for _, t := range tokens {
		sum.Add(sum, new(big.Rat).SetFrac(amount(t), new(big.Int).Exp(big.NewInt(10), big.NewInt(int64(t.Decimals)), nil)))
	}
	return usdString(sum)
}
