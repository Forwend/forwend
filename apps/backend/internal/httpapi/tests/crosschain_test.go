package tests

import (
	"context"
	"encoding/json"
	"math/big"
	"net/http"
	"net/url"
	"slices"
	"strconv"
	"strings"
	"testing"
	"time"

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
	// 100 USD at 2143.49 USD an ETH, rounded up to a wei: 100e18 / 2143.49.
	want := new(big.Int).Mul(big.NewInt(100), new(big.Int).Exp(big.NewInt(10), big.NewInt(18), nil))
	want.Mul(want, big.NewInt(100))
	q, m := new(big.Int).QuoRem(want, big.NewInt(214349), new(big.Int))
	if m.Sign() > 0 {
		q.Add(q, big.NewInt(1))
	}
	if estimates[ethAsset] != q.String() {
		t.Fatalf("ETH estimate %s, want %s", estimates[ethAsset], q)
	}
}

func TestCrossChainQuotePaysExactlyWhatIsDueIntoTheBaseOption(t *testing.T) {
	e, fake := crossChainEnv(t)
	pay, options := liveInvoice(t, e, "key-1", 86400)
	base := options[intents.BaseChainID]

	// What the payer sends, the cost and the time, with no address.
	price := e.call(t, "GET", crossPath+pay+"/crosschain/price?originAsset="+url.QueryEscape(tronUSDT), "", "", "")
	if price.status != http.StatusOK || price.body["amountIn"] != "101120000" || price.body["amountOut"] != "100000000" ||
		price.body["amountInUsd"] != "101120000" || price.body["refundFee"] != "5300" ||
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

	// The same token and refund address get the same quote back; another refund address gets its own.
	made := fake.QuoteCount()
	again := e.call(t, "POST", crossPath+pay+"/crosschain/quotes", "", "", `{"originAsset": "`+tronUSDT+`", "refundTo": "`+refundTo+`"}`)
	if again.status != http.StatusCreated || again.body["quoteId"] != r.body["quoteId"] ||
		again.body["depositAddress"] != r.body["depositAddress"] || fake.QuoteCount() != made {
		t.Fatalf("again: %d %v", again.status, again.body)
	}
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
	price := e.call(t, "GET", crossPath+pay+"/crosschain/price?originAsset="+url.QueryEscape(ethAsset), "", "", "")
	if price.status != 422 || errorCode(price) != "below_minimum" || price.body["error"].(map[string]any)["minimum"] != "200000000" {
		t.Fatalf("price below minimum: %d %v", price.status, price.body)
	}
	fake.Minimum = big.NewInt(5301)

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

// baseDeposit books a confirmed transfer of amount to an invoice's Base option, as the watcher and the ledger would.
func baseDeposit(t *testing.T, e invoiceEnv, main, option, amount string) {
	t.Helper()
	baseTransfer(t, e, main, option, option, amount)
}

// baseTransfer is baseDeposit in the transaction txHash.
func baseTransfer(t *testing.T, e invoiceEnv, main, option, txHash, amount string) {
	t.Helper()
	e.exec(t, `UPDATE chain_cursors SET last_scanned_block = 100, last_finalized_block = 100,
		last_finalized_time = extract(epoch FROM now())::bigint WHERE chain_id = 8453`)
	e.exec(t, `INSERT INTO chain_transfers (chain_id, chain_family, token_contract, invoice_id, tx_hash, log_index,
		    block_hash, block_number, block_time, from_address, to_address, amount, status)
		SELECT 8453, 'evm', token_contract, id, $4, 0, $4, 90, extract(epoch FROM now())::bigint, $2, receive_address,
		    $3::numeric, 'confirmed' FROM invoices WHERE id = $1`, option, aliceWallet, amount, txHash)
	// The finalized balance holds what was sent, so a full payment becomes paid.
	balances := func(context.Context, uint64, string, string) (*big.Int, uint64, error) {
		n, _ := new(big.Int).SetString(amount, 10)
		return n, 100, nil
	}
	notDeployed := func(context.Context, uint64, string, string) (uint64, error) { return 0, nil }
	if err := ledger.NewService(e.pool, balances, notDeployed).Process(context.Background(), main); err != nil {
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
	main := e.get(t, pay).body["invoiceId"].(string)
	baseDeposit(t, e, main, options[intents.BaseChainID]["optionId"].(string), "40000000")
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
	baseDeposit(t, e, e.get(t, paid).body["invoiceId"].(string), options[intents.BaseChainID]["optionId"].(string), "100000000")
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
