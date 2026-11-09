package intents

import (
	"context"
	"encoding/json"
	"fmt"
	"math/big"
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

// TokensEvery is how often the worker reads the list; retry, the wait after a failed read.
const (
	TokensEvery = 10 * time.Minute
	retry       = 2 * time.Minute
)

var blockchain = regexp.MustCompile(`^[a-z0-9_-]{1,32}$`)

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
		return nil, fmt.Errorf("%w: token list: %v", errUnavailable, err)
	}
	var out []Token
	seen := map[string]bool{}
	for _, t := range list {
		if seen[t.AssetID] || t.AssetID == "" || len(t.AssetID) > 200 || !blockchain.MatchString(t.Blockchain) ||
			t.Symbol == "" || len(t.Symbol) > 32 || t.Decimals < 0 || t.Decimals > 36 || len(t.ContractAddress) > 200 {
			continue
		}
		seen[t.AssetID] = true // twice in one list would fail the upsert of the whole list
		contract := t.ContractAddress
		if evmAddress.MatchString(contract) { // other chains' contracts, as Tron's, are case-sensitive
			contract = strings.ToLower(contract)
		}
		out = append(out, Token{AssetID: t.AssetID, Blockchain: t.Blockchain, Symbol: t.Symbol, Decimals: t.Decimals,
			Contract: contract, USD: usd(t.Price)})
	}
	if len(out) == 0 {
		return nil, fmt.Errorf("%w: empty token list", errUnavailable)
	}
	return out, nil
}

// usd is a listed price as a plain decimal, exponent form included; "" for none, 0 or over the table's bound.
func usd(price json.Number) string {
	r, ok := new(big.Rat).SetString(price.String())
	if !ok || r.Sign() <= 0 || r.Cmp(big.NewRat(1e9, 1)) >= 0 {
		return ""
	}
	return strings.TrimRight(strings.TrimRight(r.FloatString(30), "0"), ".")
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

// chainNames are 1Click's chains as payers know them; ChainName writes any other in capitals.
var chainNames = map[string]string{"eth": "Ethereum", "base": "Base", "arb": "Arbitrum", "op": "Optimism",
	"pol": "Polygon", "bsc": "BNB Chain", "avax": "Avalanche", "gnosis": "Gnosis", "sol": "Solana", "tron": "Tron",
	"btc": "Bitcoin", "near": "NEAR", "sui": "Sui", "aptos": "Aptos", "doge": "Dogecoin", "ltc": "Litecoin",
	"bch": "Bitcoin Cash", "zec": "Zcash", "cardano": "Cardano", "starknet": "Starknet", "bera": "Berachain",
	"scroll": "Scroll", "monad": "Monad", "xlayer": "X Layer", "plasma": "Plasma", "hypercore": "Hyperliquid",
	"abs": "Abstract"}

// ChainName is 1Click's chain name as a reader knows it: "tron" is Tron.
func ChainName(blockchain string) string {
	if name, ok := chainNames[blockchain]; ok {
		return name
	}
	return strings.ToUpper(blockchain)
}

// Chains maps our live chain ids to 1Click's names for them, so a token the invoice takes directly is not offered.
var Chains = map[uint64]string{BaseChainID: "base", 42161: "arb"}
