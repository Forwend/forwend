package tests

import (
	"bytes"
	"context"
	"encoding/json"
	"log/slog"
	"math/big"
	"net/http"
	"net/url"
	"slices"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/forwend/forwend/apps/backend/internal/httpapi/invoiceapi"
	"github.com/forwend/forwend/apps/backend/internal/intents"
	"github.com/forwend/forwend/apps/backend/internal/intents/intentstest"
	"github.com/forwend/forwend/apps/backend/internal/invoice"
	"github.com/forwend/forwend/apps/backend/internal/ledger"
)

const (
	tronUSDT  = "nep141:tron-d28a265909efecdcee7c5028585214ea0b96f015.omft.near"
	ethAsset  = "nep141:eth.omft.near"
	arbAsset  = "nep141:arb-0xaf88d065e77c8cc2239327c5edb3a432268e5831.omft.near"
	xlmAsset  = "nep141:stellar-usdc.omft.near"
	solAsset  = "nep141:sol.omft.near" // listed without a price
	refundTo  = "TJRabPrwbZy45sbavfcjinPJC18kjpRTv8"
	crossPath = "/v1/invoices/"
)

// crossChainEnv is the invoice API with Base and Arbitrum mainnet on, Alice in live mode and a fake 1Click whose token
// list the worker has read.
func crossChainEnv(t *testing.T) (invoiceEnv, *intentstest.Fake) {
	t.Helper()
	fake := intentstest.New(t)
	e := invoiceAPICrossChain(t, 0, webhookKey, nil, invoice.Pricing{}, fake.Client())
	e.exec(t, `UPDATE chains SET enabled = true WHERE chain_id IN (8453, 42161)`)
	e.exec(t, `INSERT INTO chain_cursors (chain_id, last_scanned_block, last_finalized_block) VALUES (8453, 0, 0), (42161, 0, 0)`)
	e.exec(t, `UPDATE profiles SET livemode = true WHERE id = $1`, e.aliceProfile)
	keeper := &intents.Keeper{Pool: e.pool, Client: fake.Client(), Every: time.Hour}
	if err := keeper.Tick(context.Background(), time.Now()); err != nil {
		t.Fatal(err)
	}
	return e, fake
}

// liveInvoice is a 100 USD invoice the payer may pay on Base or Arbitrum, closing in expiresIn seconds; it returns the
// pay token and both options.
func liveInvoice(t *testing.T, e invoiceEnv, key string, expiresIn int) (string, map[uint64]map[string]any) {
	t.Helper()
	made := e.post(t, "did:privy:alice", e.aliceProfile, key, `{"amountUsd": "100", "expiresIn": `+strconv.Itoa(expiresIn)+`}`)
	if made.status != http.StatusCreated {
		t.Fatalf("create: %d %v", made.status, made.body)
	}
	options := map[uint64]map[string]any{}
	for _, o := range made.body["options"].([]any) {
		option := o.(map[string]any)
		options[uint64(option["chainId"].(float64))] = option
	}
	if len(options) != 2 {
		t.Fatalf("options %v", made.body["options"])
	}
	return e.link(t, made.body["invoiceId"].(string)), options
}

func TestCrossChainTokensLeaveOutDirectMemoAndDestinationTokens(t *testing.T) {
	e, _ := crossChainEnv(t)
	pay, _ := liveInvoice(t, e, "key-1", 86400)
	r := e.call(t, "GET", crossPath+pay+"/crosschain/tokens", "", "", "")
	if r.status != http.StatusOK || r.body["due"] != "100000000" || r.body["decimals"] != float64(6) {
		t.Fatalf("tokens: %d %v", r.status, r.body)
	}
	var assets []string
	estimates := map[string]string{}
	for _, tok := range r.body["tokens"].([]any) {
		token := tok.(map[string]any)
		assets = append(assets, token["assetId"].(string))
		estimates[token["assetId"].(string)] = token["estimate"].(string)
	}
	// Tron USDT is a stablecoin and comes before ETH; Base and Arbitrum USDC are taken directly; Stellar needs a memo;
	// SOL has no price.
	if !slices.Equal(assets, []string{tronUSDT, ethAsset}) {
		t.Fatalf("assets %v", assets)
	}
	// 100 USD at 2143.49 USD an ETH with 1Click's 1% slippage on top, rounded up to a wei: 100e18 * 1.01 / 2143.49.
	want := new(big.Int).Mul(big.NewInt(100*101), new(big.Int).Exp(big.NewInt(10), big.NewInt(18), nil))
	q, m := new(big.Int).QuoRem(want, big.NewInt(214349), new(big.Int))
	if m.Sign() > 0 {
		q.Add(q, big.NewInt(1))
	}
	if estimates[ethAsset] != q.String() {
		t.Fatalf("ETH estimate %s, want %s", estimates[ethAsset], q)
	}
}

// R-245: a token 1Click has no liquidity for leaves the list until a later dry quote is answered.
func TestCrossChainTokensLeaveOutATokenWithoutLiquidity(t *testing.T) {
	e, fake := crossChainEnv(t)
	pay, _ := liveInvoice(t, e, "key-1", 86400)
	keeper := &intents.Keeper{Pool: e.pool, Client: fake.Client(), Every: time.Hour}
	listed := func(at time.Time) []string {
		t.Helper()
		for i := range 3 { // Arbitrum USDC, Tron USDT and ETH, 5 seconds apart
			if err := keeper.Probe(context.Background(), at.Add(time.Duration(i)*5*time.Second)); err != nil {
				t.Fatal(err)
			}
		}
		r := e.call(t, "GET", crossPath+pay+"/crosschain/tokens", "", "", "")
		var assets []string
		for _, tok := range r.body["tokens"].([]any) {
			assets = append(assets, tok.(map[string]any)["assetId"].(string))
		}
		return assets
	}
	fake.Dry = map[string]bool{ethAsset: true}
	start := time.Now()
	if got := listed(start); !slices.Equal(got, []string{tronUSDT}) {
		t.Fatalf("listed without ETH's liquidity %v", got)
	}
	// A price or quote refused for want of liquidity is the token's, never the refund address's.
	price := e.call(t, "GET", crossPath+pay+"/crosschain/price?originAsset="+url.QueryEscape(ethAsset), "", "", "")
	made := e.call(t, "POST", crossPath+pay+"/crosschain/quotes", "", "",
		`{"originAsset": "`+ethAsset+`", "refundTo": "0x6fd1c6b3f0b7a5b4e5d6a3c2b1a0f9e8d7c6b5a4"}`)
	for name, r := range map[string]reply{"price": price, "quote": made} {
		if r.status != http.StatusUnprocessableEntity || errorCode(r) != "no_liquidity" {
			t.Fatalf("%s without liquidity: %d %v", name, r.status, r.body)
		}
	}
	fake.Dry = nil
	if got := listed(start.Add(time.Hour)); !slices.Equal(got, []string{tronUSDT, ethAsset}) {
		t.Fatalf("listed once ETH is quoted again %v", got)
	}
}

// R-245: a pair 1Click can't quote now leaves the list at the payer's refused price, not the worker's next check.
// D-127: Bitcoin is never offered, priced or quoted.
func TestCrossChainTokensLeaveOutAnUnquotablePairAndBitcoin(t *testing.T) {
	e, fake := crossChainEnv(t)
	const btc = "nep141:btc.omft.near"
	fake.Tokens = append(fake.Tokens, map[string]any{"assetId": btc, "blockchain": "btc", "symbol": "BTC",
		"decimals": 8, "price": 104000.0})
	keeper := &intents.Keeper{Pool: e.pool, Client: fake.Client(), Every: time.Hour}
	if err := keeper.Tick(context.Background(), time.Now()); err != nil {
		t.Fatal(err)
	}
	pay, _ := liveInvoice(t, e, "key-1", 86400)
	listed := func() []string {
		t.Helper()
		r := e.call(t, "GET", crossPath+pay+"/crosschain/tokens", "", "", "")
		var assets []string
		for _, tok := range r.body["tokens"].([]any) {
			assets = append(assets, tok.(map[string]any)["assetId"].(string))
		}
		return assets
	}
	if got := listed(); slices.Contains(got, btc) || !slices.Contains(got, ethAsset) {
		t.Fatalf("listed %v; want ETH and no Bitcoin", got)
	}
	for name, r := range map[string]reply{
		"price": e.call(t, "GET", crossPath+pay+"/crosschain/price?originAsset="+url.QueryEscape(btc), "", "", ""),
		"quote": e.call(t, "POST", crossPath+pay+"/crosschain/quotes", "", "",
			`{"originAsset": "`+btc+`", "refundTo": "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq"}`),
	} {
		if r.status != http.StatusUnprocessableEntity {
			t.Fatalf("Bitcoin %s: %d %v", name, r.status, r.body)
		}
	}
	fake.Unpaired = map[string]bool{ethAsset: true}
	price := e.call(t, "GET", crossPath+pay+"/crosschain/price?originAsset="+url.QueryEscape(ethAsset), "", "", "")
	if price.status != http.StatusUnprocessableEntity || errorCode(price) != "no_liquidity" {
		t.Fatalf("price of a pair 1Click can't quote: %d %v", price.status, price.body)
	}
	if got := listed(); slices.Contains(got, ethAsset) {
		t.Fatalf("listed %v after 1Click said it can't quote ETH", got)
	}
}

func TestCrossChainQuotePaysExactlyWhatIsDueIntoTheBaseOption(t *testing.T) {
	e, fake := crossChainEnv(t)
	pay, options := liveInvoice(t, e, "key-1", 86400)
	base := options[intents.BaseChainID]

	// What the payer sends, the cost and the time, with no address.
	price := e.call(t, "GET", crossPath+pay+"/crosschain/price?originAsset="+url.QueryEscape(tronUSDT), "", "", "")
	if price.status != http.StatusOK || price.body["amountIn"] != "101120000" || price.body["amountOut"] != "100000000" ||
		price.body["amountInUsd"] != "101120000" || price.body["amountOutUsd"] != "100000000" || price.body["refundFee"] != "5300" ||
		price.body["timeEstimate"] != float64(27) || price.body["depositAddress"] != nil || price.body["signed"] != nil ||
		price.body["quoteId"] != nil {
		t.Fatalf("price: %d %v", price.status, price.body)
	}
	// A second pick of the same token is the kept dry quote, not another call to 1Click.
	before := fake.QuoteCount()
	e.call(t, "GET", crossPath+pay+"/crosschain/price?originAsset="+url.QueryEscape(tronUSDT), "", "", "")
	if fake.QuoteCount() != before {
		t.Fatal("the dry quote was asked for again")
	}

	start := time.Now()
	r := e.call(t, "POST", crossPath+pay+"/crosschain/quotes", "", "", `{"originAsset": "`+tronUSDT+`", "refundTo": "`+refundTo+`"}`)
	if r.status != http.StatusCreated || r.body["depositAddress"] == nil || r.body["amountOut"] != "100000000" ||
		r.body["refundTo"] != refundTo {
		t.Fatalf("quote: %d %v", r.status, r.body)
	}
	signed, _ := json.Marshal(r.body["signed"])
	var answer struct {
		QuoteRequest map[string]any
	}
	if err := json.Unmarshal(signed, &answer); err != nil {
		t.Fatal(err)
	}
	req := answer.QuoteRequest
	if req["recipient"] != base["receiveAddress"] || req["destinationAsset"] != intents.BaseUSDCAsset ||
		req["swapType"] != "EXACT_OUTPUT" || req["amount"] != "100000000" || req["refundTo"] != refundTo ||
		req["refundType"] != "ORIGIN_CHAIN" {
		t.Fatalf("signed request %v", req)
	}
	deadline, _ := time.Parse(time.RFC3339, r.body["deadline"].(string))
	shown, _ := time.Parse(time.RFC3339, r.body["shownUntil"].(string))
	if d := deadline.Sub(start); d < 59*time.Minute || d > 61*time.Minute {
		t.Fatalf("deadline in %s, want an hour", d)
	}
	if d := shown.Sub(start); d < 14*time.Minute || d > 16*time.Minute {
		t.Fatalf("price shown for %s, want 15 minutes", d)
	}
	// The pay link opens on the Base option again (R-57).
	if got := e.get(t, pay).body["pickedOptionId"]; got != base["optionId"] {
		t.Fatalf("picked %v, want the Base option %v", got, base["optionId"])
	}

	// The same token and refund address get the same quote back.
	made := fake.QuoteCount()
	again := e.call(t, "POST", crossPath+pay+"/crosschain/quotes", "", "", `{"originAsset": "`+tronUSDT+`", "refundTo": "`+refundTo+`"}`)
	if again.status != http.StatusCreated || again.body["quoteId"] != r.body["quoteId"] ||
		again.body["depositAddress"] != r.body["depositAddress"] || fake.QuoteCount() != made {
		t.Fatalf("again: %d %v", again.status, again.body)
	}
	// Another refund address waits until this quote's deadline: each address delivers all that is due, so both paid
	// would pay the invoice twice.
	other := e.call(t, "POST", crossPath+pay+"/crosschain/quotes", "", "", `{"originAsset": "`+tronUSDT+`", "refundTo": "TOther"}`)
	if other.status != http.StatusCreated || other.body["quoteId"] == r.body["quoteId"] {
		t.Fatalf("other refund address: %d %v", other.status, other.body)
	}
	// A quote is given again while 5 minutes of its window are left, and not once fewer are.
	e.exec(t, `UPDATE crosschain_quotes SET shown_until = now() + interval '6 minutes'`)
	if kept := e.call(t, "POST", crossPath+pay+"/crosschain/quotes", "", "", `{"originAsset": "`+tronUSDT+`", "refundTo": "`+refundTo+`"}`); kept.status != http.StatusCreated ||
		kept.body["quoteId"] != r.body["quoteId"] {
		t.Fatalf("6 minutes left: %d %v", kept.status, kept.body)
	}
	e.exec(t, `UPDATE crosschain_quotes SET shown_until = now() + interval '4 minutes'`)
	if late := e.call(t, "POST", crossPath+pay+"/crosschain/quotes", "", "", `{"originAsset": "`+tronUSDT+`", "refundTo": "`+refundTo+`"}`); late.status != http.StatusCreated ||
		late.body["quoteId"] == r.body["quoteId"] {
		t.Fatalf("late: %d %v", late.status, late.body)
	}
	// Past its deadline another refund address gets its own.
	next, _ := liveInvoice(t, e, "key-2", 86400)
	if r := e.call(t, "POST", crossPath+next+"/crosschain/quotes", "", "", `{"originAsset": "`+tronUSDT+`", "refundTo": "`+refundTo+`"}`); r.status != http.StatusCreated {
		t.Fatalf("first: %d %v", r.status, r.body)
	}
	e.exec(t, `UPDATE crosschain_quotes SET shown_until = now() - interval '1 second', deadline = now() - interval '1 second'`)
	if other := e.call(t, "POST", crossPath+next+"/crosschain/quotes", "", "", `{"originAsset": "`+tronUSDT+`", "refundTo": "TOther"}`); other.status != http.StatusCreated {
		t.Fatalf("other refund address past the deadline: %d %v", other.status, other.body)
	}
}

func TestCrossChainQuoteFromTheOwnersPreviewKeepsNoPick(t *testing.T) {
	e, _ := crossChainEnv(t)
	pay, _ := liveInvoice(t, e, "key-1", 86400)
	r := e.call(t, "POST", crossPath+pay+"/crosschain/quotes", "", "", `{"originAsset": "`+tronUSDT+`", "refundTo": "`+refundTo+`", "preview": true}`)
	if r.status != http.StatusCreated || r.body["depositAddress"] == nil {
		t.Fatalf("quote: %d %v", r.status, r.body)
	}
	if got := e.get(t, pay).body["pickedOptionId"]; got != nil {
		t.Fatalf("picked %v, want none from the owner's preview", got)
	}
}

// A slow chain's deposit can take an hour to mine, and 1Click refunds what isn't done by the deadline: its quote gets a
// longer deadline, and isn't offered when the close leaves too little time.
func TestSlowChainQuoteGetsALongerDeadline(t *testing.T) {
	e, fake := crossChainEnv(t)
	ltc := "nep141:ltc.omft.near"
	fake.Tokens = append(slices.Clone(intentstest.Tokens), map[string]any{"assetId": ltc, "blockchain": "ltc",
		"symbol": "LTC", "decimals": 8, "price": 82})
	if err := (&intents.Keeper{Pool: e.pool, Client: fake.Client(), Every: time.Hour}).Tick(context.Background(), time.Now()); err != nil {
		t.Fatal(err)
	}
	quote := func(pay string) reply {
		return e.call(t, "POST", crossPath+pay+"/crosschain/quotes", "", "",
			`{"originAsset": "`+ltc+`", "refundTo": "ltc1qg42tkwuuxefutzxezdkdel39gfstuap288mfea"}`)
	}
	soon, _ := liveInvoice(t, e, "key-1", 1500) // closes in 25 minutes
	for _, tok := range e.call(t, "GET", crossPath+soon+"/crosschain/tokens", "", "", "").body["tokens"].([]any) {
		if tok.(map[string]any)["assetId"] == ltc {
			t.Fatal("LTC offered 25 minutes before the close")
		}
	}
	if r := quote(soon); r.status != http.StatusUnprocessableEntity || errorCode(r) != "invalid_value" {
		t.Fatalf("LTC 25 minutes before the close: %d %v", r.status, r.body)
	}
	day, _ := liveInvoice(t, e, "key-2", 86400)
	start := time.Now()
	r := quote(day)
	if r.status != http.StatusCreated {
		t.Fatalf("LTC: %d %v", r.status, r.body)
	}
	deadline, _ := time.Parse(time.RFC3339, r.body["deadline"].(string))
	if d := deadline.Sub(start); d < 119*time.Minute || d > 121*time.Minute {
		t.Fatalf("LTC deadline in %s, want two hours", d)
	}
}

// Anyone can make pay tokens from a public link, so 1Click calls made with Forwend's key share one budget across
// invoices, prices apart from quotes. A kept price or quote spends none.
func TestCrossChainCallsShareOneBudgetAcrossInvoices(t *testing.T) {
	// No refill while the test runs, so a slow machine can't earn a token back between calls.
	dryRate, quoteRate := invoiceapi.DryQuoteAllRate, invoiceapi.QuoteAllRate
	invoiceapi.DryQuoteAllRate, invoiceapi.QuoteAllRate = 0, 0
	t.Cleanup(func() { invoiceapi.DryQuoteAllRate, invoiceapi.QuoteAllRate = dryRate, quoteRate })
	e, fake := crossChainEnv(t)
	var pays []string
	for i := range invoiceapi.QuoteAllBurst + 1 {
		pay, _ := liveInvoice(t, e, "key-"+strconv.Itoa(i), 86400)
		pays = append(pays, pay)
	}
	price := func(pay, asset string) reply {
		return e.call(t, "GET", crossPath+pay+"/crosschain/price?originAsset="+url.QueryEscape(asset), "", "", "")
	}
	var prices []reply
	for _, pay := range pays {
		for _, asset := range []string{tronUSDT, ethAsset} {
			prices = append(prices, price(pay, asset))
		}
	}
	for i, r := range prices[:invoiceapi.DryQuoteAllBurst] {
		if r.status != http.StatusOK {
			t.Fatalf("price %d: %d %v", i, r.status, r.body)
		}
	}
	if last := prices[len(prices)-1]; last.status != http.StatusTooManyRequests || errorCode(last) != "rate_limited" {
		t.Fatalf("a price over the shared budget: %d %v", last.status, last.body)
	}
	if r := price(pays[0], tronUSDT); r.status != http.StatusOK {
		t.Fatalf("a kept price: %d %v", r.status, r.body)
	}
	made := fake.QuoteCount()
	quote := func(pay string) reply {
		return e.call(t, "POST", crossPath+pay+"/crosschain/quotes", "", "", `{"originAsset": "`+tronUSDT+`", "refundTo": "`+refundTo+`"}`)
	}
	var quotes []reply
	for i, pay := range pays[:invoiceapi.QuoteAllBurst] {
		if quotes = append(quotes, quote(pay)); quotes[i].status != http.StatusCreated {
			t.Fatalf("quote %d: %d %v", i, quotes[i].status, quotes[i].body)
		}
	}
	if r := quote(pays[invoiceapi.QuoteAllBurst]); r.status != http.StatusTooManyRequests || errorCode(r) != "rate_limited" {
		t.Fatalf("a quote over the shared budget: %d %v", r.status, r.body)
	}
	if again := quote(pays[0]); again.status != http.StatusCreated || again.body["quoteId"] != quotes[0].body["quoteId"] {
		t.Fatalf("a kept quote: %d %v", again.status, again.body)
	}
	if got := fake.QuoteCount() - made; got != invoiceapi.QuoteAllBurst {
		t.Fatalf("1Click quotes %d, want %d", got, invoiceapi.QuoteAllBurst)
	}
}

func TestCrossChainQuoteRefusals(t *testing.T) {
	e, fake := crossChainEnv(t)
	pay, _ := liveInvoice(t, e, "key-1", 86400)
	quote := func(pay, asset, refund string) reply {
		return e.call(t, "POST", crossPath+pay+"/crosschain/quotes", "", "", `{"originAsset": "`+asset+`", "refundTo": "`+refund+`"}`)
	}
	for name, c := range map[string]struct {
		asset, refund, code string
		status              int
	}{
		"memo chain":       {xlmAsset, refundTo, "invalid_value", 422},
		"no price":         {solAsset, refundTo, "invalid_value", 422},
		"direct token":     {arbAsset, refundTo, "invalid_value", 422},
		"destination":      {intents.BaseUSDCAsset, refundTo, "invalid_value", 422},
		"unknown token":    {"nep141:nothing", refundTo, "invalid_value", 422},
		"no refund":        {tronUSDT, "", "invalid_value", 422},
		"refused refund":   {tronUSDT, "refused", "invalid_value", 422},
		"spaces in refund": {tronUSDT, "T a", "invalid_value", 422},
	} {
		// Each case has its own invoice: refused requests spend the invoice's request budget too.
		own, _ := liveInvoice(t, e, "key-"+name, 86400)
		if r := quote(own, c.asset, c.refund); r.status != c.status || errorCode(r) != c.code {
			t.Fatalf("%s: %d %v", name, r.status, r.body)
		}
	}

	// A checkout closing in under 20 minutes takes no quote: the conversion must land before the close.
	closing, _ := liveInvoice(t, e, "key-2", 900)
	if r := quote(closing, tronUSDT, refundTo); r.status != 422 || errorCode(r) != "crosschain_unavailable" {
		t.Fatalf("closing: %d %v", r.status, r.body)
	}
	// Test mode has no 1Click (D-123).
	e.exec(t, `UPDATE profiles SET livemode = false WHERE id = $1`, e.aliceProfile)
	test := e.post(t, "did:privy:alice", e.aliceProfile, "key-3", basicBody)
	if r := quote(e.link(t, test.body["invoiceId"].(string)), tronUSDT, refundTo); r.status != 422 || errorCode(r) != "crosschain_unavailable" ||
		!strings.Contains(r.body["error"].(map[string]any)["message"].(string), "test mode") {
		t.Fatalf("test mode: %d %v", r.status, r.body)
	}
	e.exec(t, `UPDATE profiles SET livemode = true WHERE id = $1`, e.aliceProfile)

	// A route whose minimum is above the amount says how much it needs.
	fake.Minimum = big.NewInt(200_000_000)
	if r := quote(pay, ethAsset, "0x6fd1c6b3f0b7a5b4e5d6a3c2b1a0f9e8d7c6b5a4"); r.status != 422 || errorCode(r) != "below_minimum" ||
		r.body["error"].(map[string]any)["minimum"] != "200000000" {
		t.Fatalf("below minimum: %d %v", r.status, r.body)
	}
	// The refused quote alone teaches it: the next payer's list names it (D-126).
	if got := listedMinimums(t, e, pay)[ethAsset]; got != "200000000" {
		t.Fatalf("listed minimum after a refused quote: %v", got)
	}
	price := e.call(t, "GET", crossPath+pay+"/crosschain/price?originAsset="+url.QueryEscape(ethAsset), "", "", "")
	if price.status != 422 || errorCode(price) != "below_minimum" || price.body["error"].(map[string]any)["minimum"] != "200000000" {
		t.Fatalf("price below minimum: %d %v", price.status, price.body)
	}
	fake.Minimum = big.NewInt(5301)
	// A temporary limit 1Click names in dollars is a minimum too, in Base USDC units (D-126).
	fake.Limits = map[string]int64{tronUSDT: 1000}
	price = e.call(t, "GET", crossPath+pay+"/crosschain/price?originAsset="+url.QueryEscape(tronUSDT), "", "", "")
	if price.status != 422 || errorCode(price) != "below_minimum" || price.body["error"].(map[string]any)["minimum"] != "1000000000" {
		t.Fatalf("price below a temporary limit: %d %v", price.status, price.body)
	}
	fake.Limits = nil
	// The next payer's list already names both minimums.
	if minimums := listedMinimums(t, e, pay); minimums[tronUSDT] != "1000000000" || minimums[ethAsset] != "200000000" {
		t.Fatalf("listed minimums %v", minimums)
	}

	// Twenty quotes an hour, then none: nineteen kept already, the twentieth made, the next refused. Quotes older than
	// an hour don't count.
	kept := func(n int, age string) {
		e.exec(t, `INSERT INTO crosschain_quotes (invoice_id, option_id, origin_asset, refund_to, deposit_address, amount_in,
			    min_amount_in, amount_out, time_estimate, shown_until, deadline, signed, created_at)
			SELECT id, id, 'x', 'x', 'kept-' || $3 || n, 1, 1, 1, 0, now(), now(), '{}', now() - $3::interval
			FROM invoices, generate_series(1, $2) n WHERE pay_token = $1`, pay, n, age)
	}
	kept(30, "61 minutes")
	kept(19, "1 minute")
	if r := quote(pay, tronUSDT, "Tlast"); r.status != http.StatusCreated {
		t.Fatalf("twentieth: %d %v", r.status, r.body)
	}
	if r := quote(pay, tronUSDT, "Tover"); r.status != http.StatusTooManyRequests || errorCode(r) != "too_many_quotes" {
		t.Fatalf("over the limit: %d %v", r.status, r.body)
	}

	// Once 1Click saw a deposit, no new quote: another would pay the invoice twice.
	other, _ := liveInvoice(t, e, "key-4", 86400)
	if r := quote(other, tronUSDT, refundTo); r.status != http.StatusCreated {
		t.Fatalf("first: %d %v", r.status, r.body)
	}
	e.exec(t, `UPDATE crosschain_quotes SET status = 'PROCESSING' WHERE invoice_id = (SELECT id FROM invoices WHERE pay_token = $1)`, other)
	if r := quote(other, ethAsset, "0x6fd1c6b3f0b7a5b4e5d6a3c2b1a0f9e8d7c6b5a4"); r.status != http.StatusConflict || errorCode(r) != "pick_locked" {
		t.Fatalf("converting: %d %v", r.status, r.body)
	}
}

func TestCrossChainQuoteNot1ClickSignedIsRefused(t *testing.T) {
	fake := intentstest.New(t)
	client := fake.Client()
	client.Signer = intentstest.New(t).Key // another key than the one the fake signs with
	e := invoiceAPICrossChain(t, 0, webhookKey, nil, invoice.Pricing{}, client)
	e.exec(t, `UPDATE chains SET enabled = true WHERE chain_id IN (8453, 42161)`)
	e.exec(t, `INSERT INTO chain_cursors (chain_id, last_scanned_block, last_finalized_block) VALUES (8453, 0, 0), (42161, 0, 0)`)
	e.exec(t, `UPDATE profiles SET livemode = true WHERE id = $1`, e.aliceProfile)
	if err := (&intents.Keeper{Pool: e.pool, Client: fake.Client(), Every: time.Hour}).Tick(context.Background(), time.Now()); err != nil {
		t.Fatal(err)
	}
	pay, _ := liveInvoice(t, e, "key-1", 86400)
	r := e.call(t, "POST", crossPath+pay+"/crosschain/quotes", "", "", `{"originAsset": "`+tronUSDT+`", "refundTo": "`+refundTo+`"}`)
	if r.status != http.StatusServiceUnavailable || errorCode(r) != "provider_unavailable" {
		t.Fatalf("unsigned: %d %v", r.status, r.body)
	}
	var kept int
	if err := e.pool.QueryRow(context.Background(), "SELECT count(*) FROM crosschain_quotes").Scan(&kept); err != nil || kept != 0 {
		t.Fatalf("kept %d quotes (%v)", kept, err)
	}
}

// listedMinimums is each token's minimum in the pay page's list, by asset id.
func listedMinimums(t *testing.T, e invoiceEnv, pay string) map[string]any {
	t.Helper()
	minimums := map[string]any{}
	for _, tok := range e.call(t, "GET", crossPath+pay+"/crosschain/tokens", "", "", "").body["tokens"].([]any) {
		minimums[tok.(map[string]any)["assetId"].(string)] = tok.(map[string]any)["minimum"]
	}
	return minimums
}

// baseDeposit books a confirmed transfer of amount to an invoice's Base option, as the watcher and the ledger would.
func baseDeposit(t *testing.T, e invoiceEnv, option, amount string) {
	t.Helper()
	baseTransfer(t, e, option, option, amount)
}

// baseTransfer is baseDeposit in the transaction txHash.
func baseTransfer(t *testing.T, e invoiceEnv, option, txHash, amount string) {
	t.Helper()
	chainTransfer(t, e, intents.BaseChainID, option, txHash, amount)
}

// chainTransfer books amount sent to option on chainID in the transaction txHash.
func chainTransfer(t *testing.T, e invoiceEnv, chainID uint64, option, txHash, amount string) {
	t.Helper()
	e.exec(t, `UPDATE chain_cursors SET last_scanned_block = 100, last_finalized_block = 100,
		last_finalized_time = extract(epoch FROM now())::bigint WHERE chain_id = $1`, chainID)
	e.exec(t, `INSERT INTO chain_transfers (chain_id, chain_family, token_contract, invoice_id, tx_hash, log_index,
		    block_hash, block_number, block_time, from_address, to_address, amount, status)
		SELECT $5, 'evm', token_contract, id, $4, 0, $4, 90, extract(epoch FROM now())::bigint, $2, receive_address,
		    $3::numeric, 'confirmed' FROM invoices WHERE id = $1`, option, aliceWallet, amount, txHash, chainID)
	// The finalized balance holds what was sent, so a full payment becomes paid.
	balances := func(context.Context, uint64, string, string) (*big.Int, uint64, error) {
		n, _ := new(big.Int).SetString(amount, 10)
		return n, 100, nil
	}
	notDeployed := func(context.Context, uint64, string, string) (uint64, error) { return 0, nil }
	if err := ledger.NewService(e.pool, balances, notDeployed).Process(context.Background(), option); err != nil {
		t.Fatal(err)
	}
}

func TestCrossChainQuoteAsksForWhatIsLeftAndEndsBeforeTheClose(t *testing.T) {
	e, _ := crossChainEnv(t)
	quote := func(pay string) reply {
		return e.call(t, "POST", crossPath+pay+"/crosschain/quotes", "", "", `{"originAsset": "`+tronUSDT+`", "refundTo": "`+refundTo+`"}`)
	}
	// 40 USDC paid on Base leaves 60 to convert.
	pay, options := liveInvoice(t, e, "key-1", 86400)
	baseDeposit(t, e, options[intents.BaseChainID]["optionId"].(string), "40000000")
	if r := quote(pay); r.status != http.StatusCreated || r.body["amountOut"] != "60000000" {
		t.Fatalf("partly paid: %d %v", r.status, r.body)
	}
	if r := e.call(t, "GET", crossPath+pay+"/crosschain/tokens", "", "", ""); r.body["due"] != "60000000" {
		t.Fatalf("tokens due: %v", r.body)
	}

	// Closing in 25 minutes: refunds start 10 minutes before the close, and the price shows until 5 minutes before that.
	start := time.Now()
	soon, _ := liveInvoice(t, e, "key-2", 1500)
	r := quote(soon)
	if r.status != http.StatusCreated {
		t.Fatalf("closing soon: %d %v", r.status, r.body)
	}
	deadline, _ := time.Parse(time.RFC3339, r.body["deadline"].(string))
	shown, _ := time.Parse(time.RFC3339, r.body["shownUntil"].(string))
	if d := deadline.Sub(start); d < 14*time.Minute || d > 16*time.Minute {
		t.Fatalf("deadline in %s, want 15 minutes", d)
	}
	if d := deadline.Sub(shown); d != 5*time.Minute {
		t.Fatalf("price window ends %s before the deadline, want 5 minutes", d)
	}
}

func TestCrossChainNeedsAnOpenBaseOptionWithNothingConfirming(t *testing.T) {
	e, _ := crossChainEnv(t)
	quote := func(pay string) reply {
		return e.call(t, "POST", crossPath+pay+"/crosschain/quotes", "", "", `{"originAsset": "`+tronUSDT+`", "refundTo": "`+refundTo+`"}`)
	}
	arbitrum := e.post(t, "did:privy:alice", e.aliceProfile, "key-1",
		`{"chainId": 42161, "token": "0xaf88d065e77c8cc2239327c5edb3a432268e5831", "amount": "5000000"}`)
	if arbitrum.status != http.StatusCreated {
		t.Fatalf("create: %d %v", arbitrum.status, arbitrum.body)
	}
	if r := quote(e.link(t, arbitrum.body["invoiceId"].(string))); r.status != 422 || errorCode(r) != "crosschain_unavailable" {
		t.Fatalf("no Base option: %d %v", r.status, r.body)
	}

	pay, options := liveInvoice(t, e, "key-2", 86400)
	base := options[intents.BaseChainID]["optionId"].(string)
	e.exec(t, `INSERT INTO chain_transfers (chain_id, chain_family, token_contract, invoice_id, tx_hash, log_index,
		    block_hash, block_number, block_time, from_address, to_address, amount, status)
		SELECT 8453, 'evm', token_contract, id, $1, 0, $1, 1, extract(epoch FROM now())::bigint, $2, receive_address,
		    1000000, 'detected' FROM invoices WHERE id = $1`, base, aliceWallet)
	if r := quote(pay); r.status != 422 || errorCode(r) != "crosschain_unavailable" {
		t.Fatalf("confirming: %d %v", r.status, r.body)
	}

	paid, options := liveInvoice(t, e, "key-3", 86400)
	baseDeposit(t, e, options[intents.BaseChainID]["optionId"].(string), "100000000")
	if r := quote(paid); r.status != 422 || errorCode(r) != "crosschain_unavailable" {
		t.Fatalf("paid: %d %v", r.status, r.body)
	}
}

func TestCrossChainQuoteRefusesWhat1ClickSignedForAnotherPayment(t *testing.T) {
	e, fake := crossChainEnv(t)
	quote := func(pay, refund string) reply {
		return e.call(t, "POST", crossPath+pay+"/crosschain/quotes", "", "", `{"originAsset": "`+tronUSDT+`", "refundTo": "`+refund+`"}`)
	}
	for name, tamper := range map[string]func(map[string]any){
		"recipient": func(a map[string]any) {
			a["quoteRequest"].(map[string]any)["recipient"] = "0x0000000000000000000000000000000000000bad"
		},
		// Tron addresses are case-sensitive: another case is another address.
		"refund case": func(a map[string]any) {
			a["quoteRequest"].(map[string]any)["refundTo"] = strings.ToLower(refundTo)
		},
		"less out": func(a map[string]any) { a["quote"].(map[string]any)["minAmountOut"] = "99000000" },
		"memo":     func(a map[string]any) { a["quote"].(map[string]any)["depositMemo"] = "7" },
		// Signed when set, but never asked for: another recipient on a virtual chain.
		"virtual recipient": func(a map[string]any) {
			a["quoteRequest"].(map[string]any)["virtualChainRecipient"] = "0x0000000000000000000000000000000000000bad"
		},
		// Another asset to the same address would pay the receiver in a token the invoice doesn't take.
		"destination": func(a map[string]any) {
			a["quoteRequest"].(map[string]any)["destinationAsset"] = "nep141:arb-0xaf88d065e77c8cc2239327c5edb3a432268e5831.omft.near"
		},
		"swap type": func(a map[string]any) { a["quoteRequest"].(map[string]any)["swapType"] = "EXACT_INPUT" },
		// Typed: the slippage asked for is the number 100, not the text.
		"typed": func(a map[string]any) { a["quoteRequest"].(map[string]any)["slippageTolerance"] = "100" },
	} {
		fake.Tamper = tamper
		pay, _ := liveInvoice(t, e, "key-"+name, 86400)
		if r := quote(pay, refundTo); r.status != http.StatusServiceUnavailable || errorCode(r) != "provider_unavailable" {
			t.Fatalf("%s: %d %v", name, r.status, r.body)
		}
	}
	// A dry answer's address is not signed, so a price that has one is refused.
	fake.Tamper = func(a map[string]any) {
		a["quote"].(map[string]any)["depositAddress"] = "0x000000000000000000000000000000000000beef"
	}
	dry, _ := liveInvoice(t, e, "key-dry", 86400)
	if r := e.call(t, "GET", crossPath+dry+"/crosschain/price?originAsset="+url.QueryEscape(tronUSDT), "", "", ""); r.status != http.StatusServiceUnavailable {
		t.Fatalf("dry with an address: %d %v", r.status, r.body)
	}
	fake.Tamper = nil

	// A kept quote is checked again before it is given: a changed row never reaches a payer.
	pay, _ := liveInvoice(t, e, "key-kept", 86400)
	first := quote(pay, refundTo)
	if first.status != http.StatusCreated {
		t.Fatalf("first: %d %v", first.status, first.body)
	}
	e.exec(t, `UPDATE crosschain_quotes SET signed = replace(signed, deposit_address, '0x000000000000000000000000000000000000beef')`)
	if r := quote(pay, refundTo); r.status != http.StatusServiceUnavailable || errorCode(r) != "provider_unavailable" {
		t.Fatalf("changed row: %d %v", r.status, r.body)
	}

	// 1Click down: the payer is told to try again.
	fake.Down = true
	down, _ := liveInvoice(t, e, "key-down", 86400)
	if r := quote(down, refundTo); r.status != http.StatusServiceUnavailable || errorCode(r) != "provider_unavailable" {
		t.Fatalf("down: %d %v", r.status, r.body)
	}
	if r := e.call(t, "GET", crossPath+down+"/crosschain/price?originAsset="+url.QueryEscape(tronUSDT), "", "", ""); r.status != http.StatusServiceUnavailable {
		t.Fatalf("down price: %d %v", r.status, r.body)
	}
}

// An old signed quote replayed, or one whose address soon stops taking deposits, could take money to an address
// 1Click no longer serves: it is refused.
func TestCrossChainQuoteThatIsNotFreshIsRefused(t *testing.T) {
	e, fake := crossChainEnv(t)
	for name, tamper := range map[string]func(map[string]any){
		"old": func(a map[string]any) {
			a["timestamp"] = time.Now().Add(-16 * time.Minute).UTC().Format(time.RFC3339Nano)
		},
		"address ends soon": func(a map[string]any) {
			a["quote"].(map[string]any)["deadline"] = time.Now().Add(30 * time.Minute).UTC().Format(time.RFC3339)
		},
		"no address deadline": func(a map[string]any) { delete(a["quote"].(map[string]any), "deadline") },
	} {
		fake.Tamper = tamper
		pay, _ := liveInvoice(t, e, "key-"+name, 86400)
		r := e.call(t, "POST", crossPath+pay+"/crosschain/quotes", "", "", `{"originAsset": "`+tronUSDT+`", "refundTo": "`+refundTo+`"}`)
		if r.status != http.StatusServiceUnavailable || errorCode(r) != "provider_unavailable" {
			t.Fatalf("%s: %d %v", name, r.status, r.body)
		}
	}
}

// A refusal that doesn't name the refund address is NEAR Intents' own: the payer isn't told to check their address,
// and the log keeps 1Click's words, so a reworded answer shows.
func TestCrossChainQuoteRefusedForAnotherReasonDoesNotBlameTheRefundAddress(t *testing.T) {
	e, fake := crossChainEnv(t)
	pay, _ := liveInvoice(t, e, "key-1", 86400)
	fake.Refuse = map[string]bool{tronUSDT: true}
	var logs bytes.Buffer
	defer slog.SetDefault(slog.Default())
	slog.SetDefault(slog.New(slog.NewTextHandler(&logs, nil)))
	r := e.call(t, "POST", crossPath+pay+"/crosschain/quotes", "", "", `{"originAsset": "`+tronUSDT+`", "refundTo": "`+refundTo+`"}`)
	if r.status != 422 || errorCode(r) != "quote_refused" ||
		strings.Contains(r.body["error"].(map[string]any)["message"].(string), "refundTo") {
		t.Fatalf("refused: %d %v", r.status, r.body)
	}
	if !strings.Contains(logs.String(), "This route is not supported") || !strings.Contains(logs.String(), "level=WARN") {
		t.Fatalf("logs lack 1Click's refusal:\n%s", logs.String())
	}
}

// R-250: a token carries the CoinGecko id 1Click names for it, by which the web finds a logo file it ships.
func TestCrossChainTokensCarryTheirCoingeckoID(t *testing.T) {
	e, _ := crossChainEnv(t)
	pay, _ := liveInvoice(t, e, "key-1", 86400)
	e.exec(t, `UPDATE intents_tokens SET coingecko_id = 'tether' WHERE asset_id = $1`, tronUSDT)

	r := e.call(t, "GET", crossPath+pay+"/crosschain/tokens", "", "", "")
	if r.status != http.StatusOK {
		t.Fatalf("tokens: %d %v", r.status, r.body)
	}
	for _, tok := range r.body["tokens"].([]any) {
		token := tok.(map[string]any)
		id, listed := token["coingeckoId"]
		if want := any(nil); !listed || token["assetId"] != tronUSDT && id != want || token["assetId"] == tronUSDT && id != "tether" {
			t.Errorf("%v: coingeckoId %v (listed %v), want tether for Tron's USDT and null for the rest", token["assetId"], id, listed)
		}
	}
	price := e.call(t, "GET", crossPath+pay+"/crosschain/price?originAsset="+url.QueryEscape(tronUSDT), "", "", "")
	if token, _ := price.body["token"].(map[string]any); price.status != http.StatusOK || token["coingeckoId"] != "tether" {
		t.Fatalf("price: %d %v", price.status, price.body)
	}
}
