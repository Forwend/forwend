package chain

import (
	"bytes"
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/ethereum/go-ethereum/rpc"
)

// missing is the safe message for a block or state the endpoint doesn't have: one behind the head, or a pruned node.
const missing = "block or state not available"

// lacksData reports a lowercase error message saying the endpoint doesn't have the block or state asked for.
func lacksData(m string) bool {
	for _, lacks := range []string{"header not found", "unknown block", "block not found", "missing trie node", "historical state",
		"state not available", "state is not available", "pruned"} {
		if strings.Contains(m, lacks) {
			return true
		}
	}
	return false
}

// tooManyAddresses is the safe message for a log query refused for the number of contracts it names.
const tooManyAddresses = "too many addresses"

func safeMessage(code int, message string) string {
	m := strings.ToLower(message)
	if strings.Contains(m, "execution reverted") {
		return "execution reverted" // a revert reason is the contract's text, whatever words it holds
	}
	if batchLimit(m) {
		return "batch too large"
	}
	if tooLarge(m) {
		return "log result size too large"
	}
	if addressLimit(m) {
		return tooManyAddresses
	}
	if rateLimited(code, m) {
		return "rate limited"
	}
	if lacksData(m) {
		return missing
	}
	for _, known := range []string{"execution reverted", "already known", "already imported", "nonce too low", "replacement transaction underpriced",
		"insufficient funds", "method not found", "method not supported", "transaction underpriced"} {
		if strings.Contains(m, known) {
			return known
		}
	}
	return "RPC execution error"
}

const notJSONRPC = "answer is not JSON-RPC"

// outage says why a 200 answer is about the endpoint rather than the call, or returns "". A rate limit on any call
// of a batch sends the whole batch to the next endpoint.
func outage(raw []byte) string {
	type answer struct {
		Error *struct {
			Code    int    `json:"code"`
			Message string `json:"message"`
		} `json:"error"`
	}
	var answers []answer
	raw = bytes.TrimSpace(raw)
	if len(raw) > 0 && raw[0] == '[' {
		if json.Unmarshal(raw, &answers) != nil {
			return notJSONRPC
		}
	} else {
		var one answer
		if json.Unmarshal(raw, &one) != nil {
			return notJSONRPC
		}
		answers = []answer{one}
	}
	for _, a := range answers {
		if a.Error != nil && a.Error.Code == -32002 {
			return "resource unavailable"
		}
		if a.Error != nil && rateLimited(a.Error.Code, a.Error.Message) {
			return "rate limited"
		}
	}
	return ""
}

// rateLimited: code 429, -32005 (EIP-1474, Infura), -32007 (QuickNode) or a message saying so. Infura's -32005 for
// too many log results is about the call (tooLarge), and the watcher narrows its range.
func rateLimited(code int, message string) bool {
	m := strings.ToLower(message)
	if tooLarge(m) {
		return false
	}
	return code == 429 || code == -32005 || code == -32007 ||
		strings.Contains(m, "rate limit") || strings.Contains(m, "rate exceeded") || strings.Contains(m, "too many requests")
}

// tooLarge reports a lowercase error message about a log query's block range or result size, such as "query returned
// more than 10000 results" (Infura), "exceed maximum block range", "query exceeds max results 20000, retry with the
// range" (Arc) or "log response size exceeded". A timeout or other failure that only mentions a result is not one.
func tooLarge(m string) bool {
	return strings.Contains(m, "range") || strings.Contains(m, "results") || strings.Contains(m, "response size") ||
		strings.Contains(m, "result size") || strings.Contains(m, "too large") || strings.Contains(m, "too big")
}

// addressLimit reports a lowercase error message refusing a log query for the contracts it names, such as "a maximum of
// 10 addresses is allowed" (PublicNode).
// A rate limit that names the caller's IP address is not one, nor is a range or result refusal.
func addressLimit(m string) bool {
	return strings.Contains(m, "address") && !strings.Contains(m, "rate") && !tooLarge(m) &&
		(strings.Contains(m, "maximum") || strings.Contains(m, "too many") || strings.Contains(m, "limit") ||
			strings.Contains(m, "exceed"))
}

// Missing reports an answer that no endpoint has the block or state asked for (see missing), from the pool or a provider.
func Missing(err error) bool {
	var e rpc.Error
	return errors.As(err, &e) && (e.Error() == missing || lacksData(strings.ToLower(e.Error())))
}

// AddressesTooMany reports a log query refused for the number of contracts it names, by the pool or a provider.
func AddressesTooMany(err error) bool {
	var status rpc.HTTPError
	if errors.As(err, &status) {
		var answer struct{ Error *struct{ Message string } }
		return json.Unmarshal(status.Body, &answer) == nil && answer.Error != nil && addressLimit(strings.ToLower(answer.Error.Message))
	}
	var e rpc.Error
	return errors.As(err, &e) && addressLimit(strings.ToLower(e.Error()))
}

// batchLimit reports a lowercase error message refusing a batch's size, such as "batch of more than 3 requests are not
// allowed" or "batch size 101 exceeds limit of 100".
func batchLimit(m string) bool {
	return strings.Contains(m, "batch") && !strings.Contains(m, "rate") && (strings.Contains(m, "not allowed") ||
		strings.Contains(m, "too large") || strings.Contains(m, "maximum batch") || strings.Contains(m, "exceeds") ||
		strings.Contains(m, "limit"))
}

func TooLarge(err error) bool {
	var status rpc.HTTPError
	if errors.As(err, &status) && (status.StatusCode == http.StatusBadRequest || status.StatusCode == http.StatusRequestEntityTooLarge) {
		var answer struct{ Error *struct{ Message string } }
		return json.Unmarshal(status.Body, &answer) == nil && answer.Error != nil && tooLarge(strings.ToLower(answer.Error.Message))
	}
	var e rpc.Error
	return errors.As(err, &e) && tooLarge(strings.ToLower(e.Error()))
}

func BatchTooLarge(err error) bool {
	limited := func(message string) bool { return batchLimit(strings.ToLower(message)) }
	var rpcErr rpc.Error
	if errors.As(err, &rpcErr) {
		return limited(rpcErr.Error())
	}
	var status rpc.HTTPError
	if !errors.As(err, &status) || (status.StatusCode != 400 && status.StatusCode != 413 && status.StatusCode != 500) {
		return false
	}
	type answer struct{ Error *struct{ Message string } }
	var answers []answer
	if json.Unmarshal(status.Body, &answers) != nil {
		var one answer
		if json.Unmarshal(status.Body, &one) != nil {
			return false
		}
		answers = []answer{one}
	}
	for _, a := range answers {
		if a.Error != nil && limited(a.Error.Message) {
			return true
		}
	}
	return false
}
