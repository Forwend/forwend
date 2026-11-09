package intents

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"regexp"
	"strings"
	"time"
)

// BaseUSDC is the one asset a cross-chain payment delivers (D-123): USDC on Base, the 1Click id of its contract.
const (
	BaseChainID   = 8453
	BaseUSDC      = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913"
	BaseUSDCAsset = "nep141:base-" + BaseUSDC + ".omft.near"
)

// Slippage is what the payer's amount may cover beyond today's price, in basis points; what isn't used comes back to
// the refund address.
const Slippage = 100

// Ask is what a payer's quote asks of 1Click: exactly Amount of Base USDC to Recipient, from Origin.
type Ask struct {
	Origin    string
	Amount    *big.Int
	Recipient string // the Base option's receive address
	RefundTo  string // the payer's address on Origin's chain; "" for a dry quote
	Deadline  time.Time
}

// Quote is what 1Click answered. Signed is its answer byte for byte, which its signature covers (D-124).
type Quote struct {
	DepositAddress string
	DepositMemo    string
	AmountIn       *big.Int
	MinAmountIn    *big.Int
	AmountOut      *big.Int
	AmountInUSD    string
	AmountOutUSD   string
	TimeEstimate   int64
	RefundFee      string
	Deadline       time.Time // the request's: refunds of what hasn't converted begin
	Signed         []byte
}

// Quote asks 1Click for an EXACT_OUTPUT quote and checks it is the one asked for, signed by c.Signer. A dry quote
// has no address, and refunds to 1Click's own ledger since no money is sent to it.
func (c *Client) Quote(ctx context.Context, ask Ask, dry bool) (Quote, error) {
	body := request(ask, dry)
	answer, err := c.call(ctx, "POST", "/v0/quote", body)
	if err != nil {
		return Quote{}, err
	}
	return Check(answer, ask, dry, c.Signer)
}

func request(ask Ask, dry bool) map[string]any {
	refundTo, refundType := ask.RefundTo, "ORIGIN_CHAIN"
	if dry {
		refundTo, refundType = ask.Recipient, "INTENTS"
	}
	return map[string]any{
		"dry": dry, "swapType": "EXACT_OUTPUT", "slippageTolerance": Slippage, "originAsset": ask.Origin,
		"depositType": "ORIGIN_CHAIN", "destinationAsset": BaseUSDCAsset, "amount": ask.Amount.String(),
		"refundTo": refundTo, "refundType": refundType, "recipient": ask.Recipient, "recipientType": "DESTINATION_CHAIN",
		"deadline": ask.Deadline.UTC().Format("2006-01-02T15:04:05.000Z"),
	}
}

// ErrMismatch: a signed quote that isn't what was asked, as one for another recipient or amount.
var ErrMismatch = errors.New("1Click quote is not the one asked for")

// Check verifies answer's signature by key, then that its signed request is ask's and its quote delivers exactly the
// amount (D-124). The pay page runs the same checks before it shows the address. A real quote's request deadline is not
// signed (1Click signs the address's own deadline in its place), so it is checked as 1Click's echo of what was asked.
func Check(answer []byte, ask Ask, dry bool, key string) (Quote, error) {
	a, err := verified(answer, key)
	if err != nil {
		return Quote{}, err
	}
	for k, want := range request(ask, dry) {
		wanted, _ := json.Marshal(want)
		got := a.request[k]
		var gotText, wantText string
		if json.Unmarshal(got, &gotText) == nil && json.Unmarshal(wanted, &wantText) == nil &&
			evmAddress.MatchString(gotText) && evmAddress.MatchString(wantText) {
			if !strings.EqualFold(gotText, wantText) { // 1Click may echo a 0x address in another case
				return Quote{}, fmt.Errorf("%w: %s is %s", ErrMismatch, k, gotText)
			}
			continue
		}
		if !bytes.Equal(compact(got), wanted) { // typed: "100" is not 100, nor "false" false
			return Quote{}, fmt.Errorf("%w: %s is %.100s", ErrMismatch, k, got)
		}
	}
	// Signed when set, but Forwend never asks for them: a quote carrying one was asked by someone else.
	for _, k := range []string{"virtualChainRecipient", "virtualChainRefundRecipient", "customRecipientMsg"} {
		if truthy(a.request[k]) {
			return Quote{}, fmt.Errorf("%w: %s is set", ErrMismatch, k)
		}
	}
	var estimate float64
	_ = json.Unmarshal(a.quote["timeEstimate"], &estimate)
	q := Quote{DepositAddress: text(a.quote, "depositAddress"), DepositMemo: text(a.quote, "depositMemo"),
		AmountInUSD: text(a.quote, "amountInUsd"), AmountOutUSD: text(a.quote, "amountOutUsd"),
		RefundFee: text(a.quote, "refundFee"), TimeEstimate: int64(estimate),
		Deadline: ask.Deadline, Signed: answer}
	var ok1, ok2, ok3 bool
	q.AmountIn, ok1 = new(big.Int).SetString(text(a.quote, "amountIn"), 10)
	q.MinAmountIn, ok2 = new(big.Int).SetString(text(a.quote, "minAmountIn"), 10)
	q.AmountOut, ok3 = new(big.Int).SetString(text(a.quote, "amountOut"), 10)
	switch {
	case !ok1 || !ok2 || !ok3 || q.AmountIn.Sign() <= 0 || q.MinAmountIn.Sign() <= 0 || q.MinAmountIn.Cmp(q.AmountIn) > 0:
		return Quote{}, fmt.Errorf("%w: amounts", ErrMismatch)
	case q.AmountOut.Cmp(ask.Amount) != 0 || text(a.quote, "minAmountOut") != ask.Amount.String():
		return Quote{}, fmt.Errorf("%w: delivers %s, not exactly %s", ErrMismatch, text(a.quote, "minAmountOut"), ask.Amount)
	case !dry && q.DepositAddress == "":
		return Quote{}, fmt.Errorf("%w: no deposit address", ErrMismatch)
	case dry && q.DepositAddress != "": // a dry answer's address is not signed
		return Quote{}, fmt.Errorf("%w: a dry quote with an address", ErrMismatch)
	case q.DepositMemo != "": // memo chains are left out: a forgotten memo loses the money (D-123)
		return Quote{}, fmt.Errorf("%w: needs a memo", ErrMismatch)
	}
	return q, nil
}

var evmAddress = regexp.MustCompile(`^0x[0-9a-fA-F]{40}$`)

func compact(raw json.RawMessage) []byte {
	var b bytes.Buffer
	if json.Compact(&b, raw) != nil {
		return nil
	}
	return b.Bytes()
}
