// Package intentstest is a fake 1Click for tests: it answers token lists and quotes, signed with its own key, so no
// test reaches the real API.
package intentstest

import (
	"crypto/ed25519"
	"encoding/json"
	"fmt"
	"math/big"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/forwend/forwend/apps/backend/internal/intents"
)

// Fake is a 1Click. Key is its public key, for intents.Client.Signer. Minimum is the least Base USDC its routes
// deliver. Quotes counts the quotes it made, dry ones too.
type Fake struct {
	URL     string
	Key     string
	Tokens  []map[string]any
	Minimum *big.Int
	private ed25519.PrivateKey
	mu      sync.Mutex
	quotes  int
	// Down makes every call answer 503.
	Down bool
}

// Tokens is the fake's default list: Base and Arbitrum USDC, Tron USDT, Ethereum ETH and Stellar USDC (a memo chain).
var Tokens = []map[string]any{
	{"assetId": intents.BaseUSDCAsset, "blockchain": "base", "symbol": "USDC", "decimals": 6, "price": 0.9998,
		"contractAddress": intents.BaseUSDC},
	{"assetId": "nep141:arb-0xaf88d065e77c8cc2239327c5edb3a432268e5831.omft.near", "blockchain": "arb", "symbol": "USDC",
		"decimals": 6, "price": 0.9998, "contractAddress": "0xaf88d065e77c8cc2239327c5edb3a432268e5831"},
	{"assetId": "nep141:tron-d28a265909efecdcee7c5028585214ea0b96f015.omft.near", "blockchain": "tron", "symbol": "USDT",
		"decimals": 6, "price": 0.9991, "contractAddress": "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t"},
	{"assetId": "nep141:eth.omft.near", "blockchain": "eth", "symbol": "ETH", "decimals": 18, "price": 2143.49},
	{"assetId": "nep141:stellar-usdc.omft.near", "blockchain": "stellar", "symbol": "USDC", "decimals": 7, "price": 1},
}

func New(t *testing.T) *Fake {
	t.Helper()
	pub, private, err := ed25519.GenerateKey(nil)
	if err != nil {
		t.Fatal(err)
	}
	f := &Fake{Key: intents.EncodeKey(pub), Tokens: Tokens, Minimum: big.NewInt(5301), private: private}
	server := httptest.NewServer(http.HandlerFunc(f.serve))
	t.Cleanup(server.Close)
	f.URL = server.URL
	return f
}

// Client is an intents.Client for the fake.
func (f *Fake) Client() *intents.Client {
	c := intents.NewClient(f.URL, "", true)
	c.Signer = f.Key
	return c
}

// QuoteCount is how many quotes the fake made.
func (f *Fake) QuoteCount() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.quotes
}

func (f *Fake) serve(w http.ResponseWriter, r *http.Request) {
	if f.Down {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	switch r.URL.Path {
	case "/v0/tokens":
		_ = json.NewEncoder(w).Encode(f.Tokens)
	case "/v0/quote":
		f.quote(w, r)
	default:
		http.NotFound(w, r)
	}
}

// quote answers as 1Click does: the payer sends 1.12% over the amount, of which 1% is slippage it may get back.
func (f *Fake) quote(w http.ResponseWriter, r *http.Request) {
	var req map[string]any
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		return
	}
	amount, ok := new(big.Int).SetString(fmt.Sprint(req["amount"]), 10)
	if !ok || amount.Cmp(f.Minimum) < 0 {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]string{"message": "Amount is too low for bridge, try at least " + f.Minimum.String()})
		return
	}
	if req["refundTo"] == "refused" {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]string{"message": "refundTo is not valid"})
		return
	}
	f.mu.Lock()
	f.quotes++
	n := f.quotes
	f.mu.Unlock()
	in := new(big.Int).Div(new(big.Int).Mul(amount, big.NewInt(10112)), big.NewInt(10000))
	minIn := new(big.Int).Div(new(big.Int).Mul(amount, big.NewInt(10012)), big.NewInt(10000))
	quote := map[string]any{"amountIn": in.String(), "amountInFormatted": in.String(), "amountInUsd": in.String(),
		"minAmountIn": minIn.String(), "amountOut": amount.String(), "amountOutFormatted": amount.String(),
		"amountOutUsd": amount.String(), "minAmountOut": amount.String(), "timeEstimate": 27, "refundFee": "5300",
		"withdrawFee": "2400"}
	if req["dry"] != true {
		quote["depositAddress"] = fmt.Sprintf("0x%040x", n)
		quote["deadline"] = time.Now().Add(72 * time.Hour).UTC().Format(time.RFC3339)
		if req["originAsset"] == "nep141:stellar-usdc.omft.near" {
			quote["depositMemo"] = "123"
		}
	}
	answer := map[string]any{"quote": quote, "quoteRequest": req, "timestamp": time.Now().UTC().Format(time.RFC3339Nano),
		"correlationId": fmt.Sprint(n)}
	unsigned, _ := json.Marshal(answer)
	message, err := intents.SignedMessage(unsigned)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		return
	}
	answer["signature"] = intents.EncodeKey(ed25519.Sign(f.private, []byte(message)))
	_ = json.NewEncoder(w).Encode(answer)
}
