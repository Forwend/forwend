package intents

import (
	"context"
	"encoding/json"
	"fmt"
	"math/big"
	"regexp"
	"strings"
)

// Token is one asset 1Click can take, as its list gives it. USD is "" without a price.
type Token struct {
	AssetID     string
	Blockchain  string
	Symbol      string
	Decimals    int
	Contract    string
	USD         string
	Minimum     string // Base USDC base units; "" if none named
	NoLiquidity bool
	CoingeckoID string // "" if none or not a plain id
}

var (
	blockchain = regexp.MustCompile(`^[a-z0-9_-]{1,32}$`)
	// The web builds a logo file's path from the id, so only a plain one is kept.
	coinID = regexp.MustCompile(`^[a-z0-9-]{1,64}$`)
)

// Tokens reads 1Click's list without malformed entries or tokens marked like USDC(DEPRECATED); none usable fails.
func (c *Client) Tokens(ctx context.Context) ([]Token, error) {
	answer, err := c.call(ctx, "GET", "/v0/tokens", nil)
	if err != nil {
		return nil, err
	}
	var list []struct {
		AssetID, Blockchain, Symbol, ContractAddress string
		Decimals                                     int
		Price                                        json.Number
		// Any JSON value: an id that is no text only loses the token its logo.
		CoingeckoID any
	}
	if err := json.Unmarshal(answer, &list); err != nil {
		return nil, fmt.Errorf("%w: token list: %v", errUnavailable, err)
	}
	var out []Token
	seen := map[string]bool{}
	for _, t := range list {
		if seen[t.AssetID] || t.AssetID == "" || len(t.AssetID) > 200 || !blockchain.MatchString(t.Blockchain) ||
			t.Symbol == "" || len(t.Symbol) > 32 || t.Decimals < 0 || t.Decimals > 36 || len(t.ContractAddress) > 200 ||
			strings.Contains(strings.ToUpper(t.Symbol), "DEPRECATED") {
			continue
		}
		seen[t.AssetID] = true // twice in one list would fail the upsert of the whole list
		contract := t.ContractAddress
		if evmAddress.MatchString(contract) { // other chains' contracts, as Tron's, are case-sensitive
			contract = strings.ToLower(contract)
		}
		coin, _ := t.CoingeckoID.(string)
		if !coinID.MatchString(coin) {
			coin = ""
		}
		out = append(out, Token{AssetID: t.AssetID, Blockchain: t.Blockchain, Symbol: t.Symbol, Decimals: t.Decimals,
			Contract: contract, USD: usd(t.Price), CoingeckoID: coin})
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
