// Package intentstest is a fake 1Click for tests, signing with its own key, so no test reaches the real API.
package intentstest

import (
	"crypto/ed25519"
	"encoding/json"
	"fmt"
	"maps"
	"math/big"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/forwend/forwend/apps/backend/internal/intents"
)

// Fake is a 1Click; Key is its public key, for intents.Client.Signer.
type Fake struct {
	URL      string
	Key      string
	Tokens   []map[string]any
	Minimum  *big.Int         // least Base USDC its routes deliver
	Limits   map[string]int64 // asset id -> 1Click's USD minimum
	Refuse   map[string]bool  // refusals that name no minimum
	Dry      map[string]bool  // no solver quotes the route
	Unpaired map[string]bool  // a pair 1Click can't quote now
	private  ed25519.PrivateKey
	mu       sync.Mutex
	quotes   int
	Down     bool
	Tamper   func(answer map[string]any) // edits a quote before the fake signs it
	statuses map[string]map[string]any   // per deposit address; none: PENDING_DEPOSIT
	answers  map[string]map[string]any
}

func (f *Fake) SetStatus(depositAddress, status string, swapDetails map[string]any) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.statuses == nil {
		f.statuses = map[string]map[string]any{}
	}
	f.statuses[depositAddress] = map[string]any{"status": status, "updatedAt": time.Now().UTC().Format(time.RFC3339),
		"correlationId": "status", "swapDetails": swapDetails}
}

// Tokens is the fake's list: Base and Arbitrum USDC, Tron USDT, ETH, Stellar USDC (memo), SOL without a price.
var Tokens = []map[string]any{
	{"assetId": intents.BaseUSDCAsset, "blockchain": "base", "symbol": "USDC", "decimals": 6, "price": 0.9998,
		"contractAddress": intents.BaseUSDC},
	{"assetId": "nep141:arb-0xaf88d065e77c8cc2239327c5edb3a432268e5831.omft.near", "blockchain": "arb", "symbol": "USDC",
		"decimals": 6, "price": 0.9998, "contractAddress": "0xaf88d065e77c8cc2239327c5edb3a432268e5831"},
	{"assetId": "nep141:tron-d28a265909efecdcee7c5028585214ea0b96f015.omft.near", "blockchain": "tron", "symbol": "USDT",
		"decimals": 6, "price": 0.9991, "contractAddress": "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t"},
	{"assetId": "nep141:eth.omft.near", "blockchain": "eth", "symbol": "ETH", "decimals": 18, "price": 2143.49},
	{"assetId": "nep141:stellar-usdc.omft.near", "blockchain": "stellar", "symbol": "USDC", "decimals": 7, "price": 1},
	{"assetId": "nep141:sol.omft.near", "blockchain": "sol", "symbol": "SOL", "decimals": 9, "price": nil},
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

func (f *Fake) Client() *intents.Client {
	c := intents.NewClient(f.URL, "", true)
	c.Signer = f.Key
	return c
}

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
	case "/v0/status":
		f.mu.Lock()
		answer, ok := f.statuses[r.URL.Query().Get("depositAddress")]
		answer = maps.Clone(answer)
		f.mu.Unlock()
		if !ok {
			answer = map[string]any{"status": "PENDING_DEPOSIT", "updatedAt": time.Now().UTC().Format(time.RFC3339),
				"correlationId": "status", "swapDetails": map[string]any{"originChainTxHashes": []any{},
					"destinationChainTxHashes": []any{}, "refundedAmount": "0"}}
		}
		f.mu.Lock()
		answer["quoteResponse"] = f.answers[r.URL.Query().Get("depositAddress")]
		f.mu.Unlock()
		_ = json.NewEncoder(w).Encode(answer)
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
	// As 1Click does: a burn address is no recipient.
	if strings.EqualFold(fmt.Sprint(req["recipient"]), "0x000000000000000000000000000000000000dead") {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]string{"message": "recipient is not valid"})
		return
	}
	amount, ok := new(big.Int).SetString(fmt.Sprint(req["amount"]), 10)
	if !ok || amount.Cmp(f.Minimum) < 0 {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]string{"message": "Amount is too low for bridge, try at least " + f.Minimum.String()})
		return
	}
	if f.Refuse[fmt.Sprint(req["originAsset"])] {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]string{"message": "This route is not supported"})
		return
	}
	if f.Unpaired[fmt.Sprint(req["originAsset"])] {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]string{"message": "Quoting for this pair is not available"})
		return
	}
	if f.Dry[fmt.Sprint(req["originAsset"])] {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]string{"message": "No liquidity available"})
		return
	}
	if limit, ok := f.Limits[fmt.Sprint(req["originAsset"])]; ok && amount.Cmp(big.NewInt(limit*1_000_000)) < 0 {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]string{
			"message": fmt.Sprintf("Temporary swap limits: minimum swap amount is $%s", commas(limit))})
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
	if f.Tamper != nil {
		f.Tamper(answer)
	}
	unsigned, _ := json.Marshal(answer)
	message, err := intents.SignedMessage(unsigned)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		return
	}
	answer["signature"] = intents.EncodeKey(ed25519.Sign(f.private, []byte(message)))
	if address, ok := quote["depositAddress"].(string); ok {
		f.mu.Lock()
		if f.answers == nil {
			f.answers = map[string]map[string]any{}
		}
		f.answers[address] = answer
		f.mu.Unlock()
	}
	_ = json.NewEncoder(w).Encode(answer)
}

// commas writes n as 1Click does in its limits: 1,000.
func commas(n int64) string {
	s := strconv.FormatInt(n, 10)
	for i := len(s) - 3; i > 0; i -= 3 {
		s = s[:i] + "," + s[i:]
	}
	return s
}
