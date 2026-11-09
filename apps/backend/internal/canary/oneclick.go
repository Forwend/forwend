package canary

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math/big"
	"net/http"
	"net/url"
	"strings"

	"github.com/forwend/forwend/apps/backend/internal/config"
	"github.com/forwend/forwend/apps/backend/internal/outbound"
)

// quote is one "quote <option id> <deposit address> <amount out>" line: a cross-chain quote the pay page may show for
// an option (R-235). The canary checks it against 1Click's own record with code of its own (D-124).
type quote struct {
	OptionID, DepositAddress, AmountOut string
}

func parseQuote(line string) (quote, error) {
	f := strings.Fields(line)
	if len(f) != 4 || f[0] != "quote" {
		return quote{}, errors.New("want: quote option_id deposit_address amount_out")
	}
	amount, ok := new(big.Int).SetString(f[3], 10)
	if !invoiceID.MatchString(f[1]) || f[2] == "" || len(f[2]) > 200 || !ok || amount.Sign() <= 0 || amount.String() != f[3] {
		return quote{}, errors.New("a value is malformed")
	}
	return quote{OptionID: f[1], DepositAddress: f[2], AmountOut: f[3]}, nil
}

// checkQuote reads 1Click's status of the deposit address and requires its signed quote to pay exactly AmountOut of
// the option's token, USDC on Base, into receive, the address the factory predicts for the option.
func checkQuote(ctx context.Context, c config.Canary, t terms, receive string, q quote) error {
	if t.ChainID != 8453 {
		return fmt.Errorf("quote on chain %d: only Base takes cross-chain payments", t.ChainID)
	}
	client := outbound.Client(c.AllowLoopback)
	defer client.CloseIdleConnections()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet,
		c.OneClickURL+"/v0/status?depositAddress="+url.QueryEscape(q.DepositAddress), nil)
	if err != nil {
		return err
	}
	res, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("1Click status: %w", err)
	}
	defer res.Body.Close()
	body, err := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	if err != nil || res.StatusCode != http.StatusOK {
		return fmt.Errorf("1Click status: %d %v", res.StatusCode, err)
	}
	var status map[string]json.RawMessage
	if err := json.Unmarshal(body, &status); err != nil {
		return fmt.Errorf("1Click status: %w", err)
	}
	signed := status["quoteResponse"]
	request, answer, err := verifyQuote(signed, c.OneClickKey)
	if err != nil {
		return err
	}
	want := map[string]string{"recipient": receive, "destinationAsset": "nep141:base-" + t.Token + ".omft.near",
		"swapType": "EXACT_OUTPUT", "recipientType": "DESTINATION_CHAIN", "amount": q.AmountOut}
	for k, v := range want {
		if got := text(request[k]); !strings.EqualFold(got, v) {
			return fmt.Errorf("1Click quote %s is %s, want %s", k, got, v)
		}
	}
	switch {
	case text(answer["depositAddress"]) != q.DepositAddress:
		return fmt.Errorf("1Click quote address %s, want %s", text(answer["depositAddress"]), q.DepositAddress)
	case text(answer["amountOut"]) != q.AmountOut || text(answer["minAmountOut"]) != q.AmountOut:
		return fmt.Errorf("1Click quote delivers %s, want exactly %s", text(answer["minAmountOut"]), q.AmountOut)
	case text(answer["depositMemo"]) != "":
		return errors.New("1Click quote needs a memo")
	}
	for _, k := range []string{"virtualChainRecipient", "virtualChainRefundRecipient", "customRecipientMsg"} {
		if truthy(request[k]) {
			return fmt.Errorf("1Click quote sets %s", k)
		}
	}
	return nil
}

// verifyQuote checks 1Click's ed25519 signature over a quote answer, as its SDK's verifyQuoteSignature builds the
// message, and returns the signed request and quote read with exact keys.
func verifyQuote(signed []byte, key string) (request, answer map[string]json.RawMessage, err error) {
	var top map[string]json.RawMessage
	if err := json.Unmarshal(signed, &top); err != nil {
		return nil, nil, errors.New("1Click status has no quote")
	}
	if json.Unmarshal(top["quoteRequest"], &request) != nil || json.Unmarshal(top["quote"], &answer) != nil {
		return nil, nil, errors.New("1Click status has no quote")
	}
	fields := map[string]json.RawMessage{}
	for _, k := range []string{"dry", "swapType", "slippageTolerance", "originAsset", "depositType", "destinationAsset",
		"amount", "refundTo", "refundType", "recipient", "recipientType", "deadline"} {
		if v, ok := request[k]; ok {
			fields[k] = v
		}
	}
	for _, k := range []string{"quoteWaitingTimeMs", "referral", "virtualChainRecipient", "virtualChainRefundRecipient",
		"customRecipientMsg"} {
		if truthy(request[k]) {
			fields[k] = request[k]
		}
	}
	for _, k := range []string{"amountIn", "amountInFormatted", "amountInUsd", "minAmountIn", "amountOut",
		"amountOutFormatted", "amountOutUsd", "minAmountOut"} {
		if v, ok := answer[k]; ok {
			fields[k] = v
		}
	}
	if string(request["dry"]) != "true" {
		for _, k := range []string{"depositAddress", "depositMemo", "deadline", "timeWhenInactive", "timeEstimate",
			"refundFee", "withdrawFee"} {
			if truthy(answer[k]) {
				fields[k] = answer[k]
			} else {
				delete(fields, k)
			}
		}
	}
	if v, ok := top["timestamp"]; ok {
		fields["timestamp"] = v
	}
	values := map[string]any{}
	for k, raw := range fields {
		d := json.NewDecoder(bytes.NewReader(raw))
		d.UseNumber()
		var v any
		if err := d.Decode(&v); err != nil {
			return nil, nil, errors.New("1Click quote is malformed")
		}
		values[k] = v
	}
	var message bytes.Buffer
	enc := json.NewEncoder(&message)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(values); err != nil {
		return nil, nil, err
	}
	hash := sha256.Sum256(bytes.TrimSuffix(message.Bytes(), []byte("\n")))
	pub, sig := base58Key(key), base58Key(text(top["signature"]))
	if len(pub) != ed25519.PublicKeySize || len(sig) != ed25519.SignatureSize ||
		!ed25519.Verify(pub, []byte(base58(hash[:])), sig) {
		return nil, nil, errors.New("1Click quote signature does not verify")
	}
	return request, answer, nil
}

func text(raw json.RawMessage) string {
	var s string
	_ = json.Unmarshal(raw, &s)
	return s
}

func truthy(raw json.RawMessage) bool {
	switch s := strings.TrimSpace(string(raw)); s {
	case "", "null", "false", `""`:
		return false
	default:
		f, ok := new(big.Float).SetString(s)
		return !ok || f.Sign() != 0
	}
}

const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"

func base58(b []byte) string {
	n, out := new(big.Int).SetBytes(b), []byte{}
	for mod := new(big.Int); n.Sign() > 0; {
		n.DivMod(n, big.NewInt(58), mod)
		out = append([]byte{alphabet[mod.Int64()]}, out...)
	}
	for _, c := range b {
		if c != 0 {
			break
		}
		out = append([]byte{'1'}, out...)
	}
	return string(out)
}

// base58Key reads "ed25519:<base58>"; nil when it isn't.
func base58Key(s string) []byte {
	s = strings.TrimPrefix(s, "ed25519:")
	n := new(big.Int)
	for _, c := range s {
		i := strings.IndexRune(alphabet, c)
		if i < 0 {
			return nil
		}
		n.Mul(n, big.NewInt(58)).Add(n, big.NewInt(int64(i)))
	}
	out := n.Bytes()
	for _, c := range s {
		if c != '1' {
			break
		}
		out = append([]byte{0}, out...)
	}
	return out
}
