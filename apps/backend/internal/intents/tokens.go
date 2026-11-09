package intents

import (
	"context"
	"encoding/json"
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Token is one asset 1Click can take, as its list gives it. USD is "" without a price.
type Token struct {
	AssetID    string
	Blockchain string
	Symbol     string
	Decimals   int
	Contract   string
	USD        string
}

// TokensEvery is how often the worker reads the list; Retry, the wait after a failed read.
const (
	TokensEvery = 10 * time.Minute
	Retry       = 2 * time.Minute
)

var (
	blockchain = regexp.MustCompile(`^[a-z0-9_-]{1,32}$`)
	usdValue   = regexp.MustCompile(`^[0-9]{1,9}(\.[0-9]{1,18})?$`)
)

// Tokens reads 1Click's list. A malformed entry is left out; a list without any usable entry fails.
func (c *Client) Tokens(ctx context.Context) ([]Token, error) {
	answer, err := c.call(ctx, "GET", "/v0/tokens", nil)
	if err != nil {
		return nil, err
	}
	var list []struct {
		AssetID, Blockchain, Symbol, ContractAddress string
		Decimals                                     int
		Price                                        json.Number
	}
	if err := json.Unmarshal(answer, &list); err != nil {
		return nil, fmt.Errorf("%w: token list: %v", ErrUnavailable, err)
	}
	var out []Token
	for _, t := range list {
		if t.AssetID == "" || len(t.AssetID) > 200 || !blockchain.MatchString(t.Blockchain) || t.Symbol == "" ||
			len(t.Symbol) > 32 || t.Decimals < 0 || t.Decimals > 36 || len(t.ContractAddress) > 200 {
			continue
		}
		usd := ""
		// A price is a decimal string above 0; JSON's exponent form, which 1Click doesn't send, is left out with it.
		if p := t.Price.String(); usdValue.MatchString(p) && strings.Trim(p, "0.") != "" {
			usd = p
		}
		out = append(out, Token{AssetID: t.AssetID, Blockchain: t.Blockchain, Symbol: t.Symbol, Decimals: t.Decimals,
			Contract: strings.ToLower(t.ContractAddress), USD: usd})
	}
	if len(out) == 0 {
		return nil, fmt.Errorf("%w: empty token list", ErrUnavailable)
	}
	return out, nil
}

// Keeper keeps 1Click's token list in Postgres for every api replica (R-232).
type Keeper struct {
	Pool   *pgxpool.Pool
	Client *Client
	Every  time.Duration
	due    time.Time
}

func (k *Keeper) Tick(ctx context.Context, now time.Time) error {
	if now.Before(k.due) {
		return nil
	}
	if err := k.refresh(ctx, now); err != nil {
		k.due = now.Add(Retry)
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
	decimals := make([]int32, len(tokens))
	for i, t := range tokens {
		ids[i], chains[i], symbols[i], decimals[i] = t.AssetID, t.Blockchain, t.Symbol, int32(t.Decimals)
		if t.Contract != "" {
			contracts[i] = &tokens[i].Contract
		}
		if t.USD != "" {
			usd[i] = &tokens[i].USD
		}
	}
	return pgx.BeginFunc(ctx, k.Pool, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `INSERT INTO intents_tokens (asset_id, blockchain, symbol, decimals, contract, usd, fetched_at)
			SELECT * , $7::timestamptz FROM unnest($1::text[], $2::text[], $3::text[], $4::int[], $5::text[], $6::numeric[])
			ON CONFLICT (asset_id) DO UPDATE SET blockchain = excluded.blockchain, symbol = excluded.symbol,
			    decimals = excluded.decimals, contract = excluded.contract, usd = excluded.usd, fetched_at = excluded.fetched_at`,
			ids, chains, symbols, decimals, contracts, usd, now); err != nil {
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
	rows, err := db.Query(ctx, `SELECT asset_id, blockchain, symbol, decimals, coalesce(contract, ''), coalesce(usd::text, '')
		FROM intents_tokens ORDER BY coalesce(usd BETWEEN 0.98 AND 1.02, false) DESC, symbol, blockchain, asset_id`)
	if err != nil {
		return nil, fmt.Errorf("list 1Click tokens: %w", err)
	}
	list, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (Token, error) {
		var t Token
		return t, row.Scan(&t.AssetID, &t.Blockchain, &t.Symbol, &t.Decimals, &t.Contract, &t.USD)
	})
	if err != nil {
		return nil, fmt.Errorf("list 1Click tokens: %w", err)
	}
	return list, nil
}

// MemoChains need a memo beside the address, which a payer can forget and lose the money; they are left out (D-123).
var MemoChains = map[string]bool{"stellar": true, "xrp": true, "ton": true}

// Chains maps our live chain ids to 1Click's names for them, so a token the invoice takes directly is not offered.
var Chains = map[uint64]string{BaseChainID: "base", 42161: "arb"}
