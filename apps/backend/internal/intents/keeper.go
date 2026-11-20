package intents

import (
	"context"
	"encoding/hex"
	"errors"
	"fmt"
	"maps"
	"math/big"
	"slices"
	"time"

	"github.com/forwend/forwend/apps/backend/internal/address"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

// TokensEvery is how often the worker reads the list; retry, the wait after a failed read.
const (
	TokensEvery = 10 * time.Minute
	retry       = 2 * time.Minute
)

// Keeper keeps 1Click's token list in Postgres for every api replica.
type Keeper struct {
	Pool     *pgxpool.Pool
	Client   *Client
	Every    time.Duration
	due      time.Time
	probeDue time.Time
}

func (k *Keeper) Tick(ctx context.Context, now time.Time) error {
	if now.Before(k.due) {
		return nil
	}
	if err := k.refresh(ctx, now); err != nil {
		k.due = now.Add(retry)
		return err
	}
	k.due = now.Add(k.Every)
	return nil
}

// refresh replaces the list: a token 1Click dropped can no longer be quoted.
func (k *Keeper) refresh(ctx context.Context, now time.Time) error {
	tokens, err := k.Client.Tokens(ctx)
	if err != nil {
		return err
	}
	ids, chains, symbols, contracts, usd := make([]string, len(tokens)), make([]string, len(tokens)),
		make([]string, len(tokens)), make([]*string, len(tokens)), make([]*string, len(tokens))
	coins := make([]*string, len(tokens))
	decimals := make([]int32, len(tokens))
	for i, t := range tokens {
		ids[i], chains[i], symbols[i], decimals[i] = t.AssetID, t.Blockchain, t.Symbol, int32(t.Decimals)
		if t.Contract != "" {
			contracts[i] = &tokens[i].Contract
		}
		if t.USD != "" {
			usd[i] = &tokens[i].USD
		}
		if t.CoingeckoID != "" {
			coins[i] = &tokens[i].CoingeckoID
		}
	}
	return pgx.BeginFunc(ctx, k.Pool, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `INSERT INTO intents_tokens (asset_id, blockchain, symbol, decimals, contract, usd, coingecko_id,
			    fetched_at)
			SELECT * , $8::timestamptz
			FROM unnest($1::text[], $2::text[], $3::text[], $4::int[], $5::text[], $6::numeric[], $7::text[])
			ON CONFLICT (asset_id) DO UPDATE SET blockchain = excluded.blockchain, symbol = excluded.symbol,
			    decimals = excluded.decimals, contract = excluded.contract, usd = excluded.usd,
			    coingecko_id = excluded.coingecko_id, fetched_at = excluded.fetched_at`,
			ids, chains, symbols, decimals, contracts, usd, coins, now); err != nil {
			return fmt.Errorf("store 1Click tokens: %w", err)
		}
		if _, err := tx.Exec(ctx, "DELETE FROM intents_tokens WHERE NOT asset_id = ANY($1)", ids); err != nil {
			return fmt.Errorf("drop old 1Click tokens: %w", err)
		}
		return nil
	})
}

// List gives the kept tokens, stablecoins first (a price within 2% of 1 USD), then by symbol.
func List(ctx context.Context, db interface {
	Query(context.Context, string, ...any) (pgx.Rows, error)
}) ([]Token, error) {
	rows, err := db.Query(ctx, `SELECT asset_id, blockchain, symbol, decimals, coalesce(contract, ''), coalesce(usd::text, ''),
		    coalesce(minimum::text, ''), no_liquidity_at IS NOT NULL, coalesce(coingecko_id, '')
		FROM intents_tokens ORDER BY coalesce(usd BETWEEN 0.98 AND 1.02, false) DESC, symbol, blockchain, asset_id`)
	if err != nil {
		return nil, fmt.Errorf("list 1Click tokens: %w", err)
	}
	list, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (Token, error) {
		var t Token
		return t, row.Scan(&t.AssetID, &t.Blockchain, &t.Symbol, &t.Decimals, &t.Contract, &t.USD, &t.Minimum,
			&t.NoLiquidity, &t.CoingeckoID)
	})
	if err != nil {
		return nil, fmt.Errorf("list 1Click tokens: %w", err)
	}
	return list, nil
}

// A dry quote this small names any route's minimum. One goes out every ProbeGap; a token again after probeEvery.
const (
	probeEvery = time.Hour
	ProbeGap   = 5 * time.Second
)

var probeAmount = big.NewInt(10_000) // 0.01 USDC

// The probe's recipient is our Base refund authority: 1Click refuses a burn address, and a dry quote moves nothing.
var probeRecipient = func() string {
	authority := address.Known[address.Factory].RefundAuthority
	return "0x" + hex.EncodeToString(authority[:])
}()

// Probe asks one dry quote for the token checked longest ago, so payers see which tokens fit before they pick.
func (k *Keeper) Probe(ctx context.Context, now time.Time) error {
	if now.Before(k.probeDue) {
		return nil
	}
	k.probeDue = now.Add(ProbeGap)
	skipped := slices.Concat(slices.Collect(maps.Keys(MemoChains)), slices.Collect(maps.Keys(LeftOutChains)))
	var asset string
	err := k.Pool.QueryRow(ctx, `SELECT asset_id FROM intents_tokens WHERE asset_id <> $1 AND usd IS NOT NULL
		    AND NOT blockchain = ANY($2) AND (minimum_checked_at IS NULL OR minimum_checked_at <= $3)
		ORDER BY minimum_checked_at NULLS FIRST, asset_id LIMIT 1`, BaseUSDCAsset, skipped, now.Add(-probeEvery)).Scan(&asset)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("pick a 1Click token to check: %w", err)
	}
	// A bridge's least can hide a higher dollar limit behind it, so a named minimum is asked again; the highest is kept.
	amount, minimum := probeAmount, (*big.Int)(nil)
	for range 3 {
		_, err = k.Client.Quote(ctx, Ask{Origin: asset, Amount: amount, Recipient: probeRecipient,
			Deadline: now.Add(time.Hour)}, true)
		var below *BelowMinimum
		if !errors.As(err, &below) {
			break
		}
		next, ok := new(big.Int).SetString(below.Minimum, 10)
		err = nil
		if !ok || next.Cmp(amount) <= 0 {
			break
		}
		minimum, amount = next, next
	}
	if err == nil {
		return SetMinimum(ctx, k.Pool, asset, minimum, now)
	}
	if errors.Is(err, ErrNoLiquidity) { // an answer of its own, not a fault to log
		return SetNoLiquidity(ctx, k.Pool, asset, now)
	}
	// Any other answer keeps the known minimum and is returned to be logged: a refusal naming none can be
	// our request's fault. The token waits its next turn, so it can't hold up the rest.
	var kept error
	if minimum != nil {
		kept = SetMinimum(ctx, k.Pool, asset, minimum, now)
	} else {
		_, kept = k.Pool.Exec(ctx, "UPDATE intents_tokens SET minimum_checked_at = $2 WHERE asset_id = $1", asset, now)
	}
	if !errors.Is(err, ErrRefused) {
		k.probeDue = now.Add(retry)
	}
	return errors.Join(err, kept)
}

// SetMinimum keeps asset's least amount in Base USDC base units, nil if none; an answer means a route.
func SetMinimum(ctx context.Context, db interface {
	Exec(context.Context, string, ...any) (pgconn.CommandTag, error)
}, asset string, minimum *big.Int, at time.Time) error {
	var units *string
	if minimum != nil && minimum.Sign() > 0 {
		s := minimum.String()
		units = &s
	}
	if _, err := db.Exec(ctx, `UPDATE intents_tokens SET minimum = $2::numeric, minimum_checked_at = $3, no_liquidity_at = NULL
		WHERE asset_id = $1`, asset, units, at); err != nil {
		return fmt.Errorf("keep 1Click minimum of %s: %w", asset, err)
	}
	return nil
}

// SetNoLiquidity marks that 1Click has no route for asset now, so payers aren't offered it until a dry quote answers.
func SetNoLiquidity(ctx context.Context, db interface {
	Exec(context.Context, string, ...any) (pgconn.CommandTag, error)
}, asset string, at time.Time) error {
	if _, err := db.Exec(ctx, "UPDATE intents_tokens SET no_liquidity_at = $2, minimum_checked_at = $2 WHERE asset_id = $1",
		asset, at); err != nil {
		return fmt.Errorf("keep 1Click's no liquidity for %s: %w", asset, err)
	}
	return nil
}
