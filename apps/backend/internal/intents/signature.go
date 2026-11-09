package intents

import (
	"bytes"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"strings"
)

// ManagerKey is the ed25519 key 1Click signs its quotes with (D-124), as the 1Click SDK pins it.
const ManagerKey = "ed25519:reYaWhvwu8Jzo3WUM3zhn6VrhuMEF4eADL17qtRVifc"

// ErrSignature: the answer is not a quote 1Click signed, or a field changed after it signed it.
var ErrSignature = errors.New("1Click signature does not verify")

// The fields 1Click signs, in the SDK's verifyQuoteSignature. Each optional one counts only when JavaScript would call
// it true, as the SDK drops it otherwise.
var (
	signedRequest   = []string{"dry", "swapType", "slippageTolerance", "originAsset", "depositType", "destinationAsset", "amount", "refundTo", "refundType", "recipient", "recipientType", "deadline"}
	optionalRequest = []string{"quoteWaitingTimeMs", "referral", "virtualChainRecipient", "virtualChainRefundRecipient", "customRecipientMsg"}
	signedAmounts   = []string{"amountIn", "amountInFormatted", "amountInUsd", "minAmountIn", "amountOut", "amountOutFormatted", "amountOutUsd", "minAmountOut"}
	optionalQuote   = []string{"depositAddress", "depositMemo", "deadline", "timeWhenInactive", "timeEstimate", "refundFee", "withdrawFee"}
)

// answer is a quote answer read with exact keys. Go's struct decoding matches keys in any case, so a "DepositAddress"
// beside 1Click's "depositAddress" would win; every value checked comes from these maps, as the signature covers them.
type answer struct {
	top, request, quote map[string]json.RawMessage
}

func parseAnswer(b []byte) (answer, error) {
	var a answer
	if err := json.Unmarshal(b, &a.top); err != nil {
		return a, fmt.Errorf("%w: %v", ErrSignature, err)
	}
	if err := json.Unmarshal(a.top["quoteRequest"], &a.request); err != nil {
		return a, fmt.Errorf("%w: quoteRequest: %v", ErrSignature, err)
	}
	if err := json.Unmarshal(a.top["quote"], &a.quote); err != nil {
		return a, fmt.Errorf("%w: quote: %v", ErrSignature, err)
	}
	return a, nil
}

// text is the string at key in m, "" when it is missing or not a string.
func text(m map[string]json.RawMessage, key string) string {
	var s string
	_ = json.Unmarshal(m[key], &s)
	return s
}

// verified checks that signed, a quote answer exactly as 1Click sent it, carries key's signature, and returns it read.
func verified(signed []byte, key string) (answer, error) {
	pub, err := decodeKey(key)
	if err != nil || len(pub) != ed25519.PublicKeySize {
		return answer{}, fmt.Errorf("%w: bad key", ErrSignature)
	}
	a, err := parseAnswer(signed)
	if err != nil {
		return answer{}, err
	}
	sig, err := decodeKey(text(a.top, "signature"))
	if err != nil || len(sig) != ed25519.SignatureSize {
		return answer{}, fmt.Errorf("%w: bad signature", ErrSignature)
	}
	message, err := a.message()
	if err != nil {
		return answer{}, err
	}
	if !ed25519.Verify(pub, []byte(message), sig) {
		return answer{}, ErrSignature
	}
	return a, nil
}

// SignedMessage is the text 1Click signs for a quote answer: the base58 SHA-256 of the signed fields as sorted-key
// JSON, the way json-stable-stringify writes it. A test's fake 1Click signs it with its own key.
func SignedMessage(b []byte) (string, error) {
	a, err := parseAnswer(b)
	if err != nil {
		return "", err
	}
	return a.message()
}

func (a answer) message() (string, error) {
	fields := map[string]json.RawMessage{}
	for _, k := range signedRequest {
		if v, ok := a.request[k]; ok {
			fields[k] = v
		}
	}
	for _, k := range optionalRequest {
		if v := a.request[k]; truthy(v) {
			fields[k] = v
		}
	}
	for _, k := range signedAmounts {
		if v, ok := a.quote[k]; ok {
			fields[k] = v
		}
	}
	// A real quote's fields are spread over the request's: its deadline (when the address goes inactive) replaces the
	// request's, which is then not signed, and drops it when it has none.
	if !bytes.Equal(a.request["dry"], []byte("true")) {
		for _, k := range optionalQuote {
			if v := a.quote[k]; truthy(v) {
				fields[k] = v
			} else {
				delete(fields, k)
			}
		}
	}
	if v, ok := a.top["timestamp"]; ok {
		fields["timestamp"] = v
	}
	message, err := stableJSON(fields)
	if err != nil {
		return "", fmt.Errorf("%w: %v", ErrSignature, err)
	}
	hash := sha256.Sum256(message)
	return base58(hash[:]), nil
}

// EncodeKey writes an ed25519 key or signature as 1Click does: "ed25519:<base58>".
func EncodeKey(b []byte) string { return "ed25519:" + base58(b) }

// stableJSON writes fields with sorted keys and each value as JSON.stringify would: no spaces, no HTML escaping.
func stableJSON(fields map[string]json.RawMessage) ([]byte, error) {
	var out bytes.Buffer
	enc := json.NewEncoder(&out)
	enc.SetEscapeHTML(false)
	values := make(map[string]any, len(fields))
	for k, raw := range fields {
		d := json.NewDecoder(bytes.NewReader(raw))
		d.UseNumber() // the number as 1Click wrote it, never a float's rendering
		var v any
		if err := d.Decode(&v); err != nil {
			return nil, err
		}
		values[k] = v
	}
	if err := enc.Encode(values); err != nil { // a map's keys come out sorted
		return nil, err
	}
	return bytes.TrimSuffix(out.Bytes(), []byte("\n")), nil
}

// truthy is JavaScript's truth of a JSON value: false, null, 0 and "" are not.
func truthy(v json.RawMessage) bool {
	switch s := strings.TrimSpace(string(v)); s {
	case "", "null", "false", `""`:
		return false
	default:
		if f, ok := new(big.Float).SetString(s); ok {
			return f.Sign() != 0
		}
		return true
	}
}

const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"

func base58(b []byte) string {
	n := new(big.Int).SetBytes(b)
	var out []byte
	for mod, base := new(big.Int), big.NewInt(58); n.Sign() > 0; {
		n.DivMod(n, base, mod)
		out = append(out, alphabet[mod.Int64()])
	}
	for _, c := range b {
		if c != 0 {
			break
		}
		out = append(out, '1')
	}
	for i, j := 0, len(out)-1; i < j; i, j = i+1, j-1 {
		out[i], out[j] = out[j], out[i]
	}
	return string(out)
}

// decodeKey reads a NEAR-style "ed25519:<base58>" key or signature.
func decodeKey(s string) ([]byte, error) {
	s = strings.TrimPrefix(s, "ed25519:")
	n := new(big.Int)
	for _, c := range s {
		i := strings.IndexRune(alphabet, c)
		if i < 0 {
			return nil, errors.New("not base58")
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
	return out, nil
}
