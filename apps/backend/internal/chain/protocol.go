package chain

import (
	"bytes"
	"encoding/json"
	"errors"
	"strings"
)

// Only stateless reads and already-signed transactions can cross provider boundaries safely.
func requestCalls(body []byte) (int, error) {
	var calls []struct{ Method string }
	if err := json.Unmarshal(body, &calls); err != nil {
		var one struct{ Method string }
		if json.Unmarshal(body, &one) != nil {
			return 0, errors.New("invalid RPC request")
		}
		calls = append(calls, one)
	}
	if len(calls) == 0 {
		return 0, errors.New("empty RPC batch")
	}
	for _, c := range calls {
		switch c.Method {
		case "eth_chainId", "eth_blockNumber", "eth_getBlockByNumber", "eth_getBlockByHash", "eth_getBlockReceipts",
			"eth_getLogs", "eth_getBalance", "eth_getCode", "eth_call", "eth_getTransactionCount", "eth_getTransactionByHash",
			"eth_getTransactionReceipt", "eth_estimateGas", "eth_gasPrice", "eth_maxPriorityFeePerGas", "eth_feeHistory", "eth_sendRawTransaction":
		default:
			return 0, errors.New("RPC method is not permitted")
		}
	}
	return len(calls), nil
}

type response struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id"`
	Result  json.RawMessage `json:"result,omitempty"`
	Error   *responseError  `json:"error,omitempty"`
}

type responseError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

func safeResponse(raw, request []byte) ([]byte, error) {
	batch := len(bytes.TrimSpace(request)) > 0 && bytes.TrimSpace(request)[0] == '['
	var requests []struct{ ID json.RawMessage }
	var answers []response
	if batch {
		if json.Unmarshal(request, &requests) != nil || json.Unmarshal(raw, &answers) != nil {
			return nil, errors.New("invalid batch")
		}
	} else {
		var one struct{ ID json.RawMessage }
		var answer response
		if json.Unmarshal(request, &one) != nil || json.Unmarshal(raw, &answer) != nil {
			return nil, errors.New("invalid response")
		}
		requests = append(requests, one)
		answers = append(answers, answer)
	}
	// Whole-batch size errors are handled before envelope validation in pool.post.
	if len(answers) != len(requests) {
		return nil, errors.New("incomplete response")
	}
	ids := map[string]bool{}
	for _, r := range requests {
		ids[string(r.ID)] = true
	}
	for i := range answers {
		a := &answers[i]
		if a.JSONRPC != "2.0" || !ids[string(a.ID)] || (a.Error == nil) == (len(a.Result) == 0) {
			return nil, errors.New("invalid response envelope")
		}
		delete(ids, string(a.ID))
		if a.Error != nil {
			a.Error.Message = safeMessage(a.Error.Code, a.Error.Message)
		}
	}
	if batch {
		return json.Marshal(answers)
	}
	return json.Marshal(answers[0])
}

func safeMessage(code int, message string) string {
	m := strings.ToLower(message)
	if strings.Contains(m, "batch") && (strings.Contains(m, "not allowed") || strings.Contains(m, "too large") || strings.Contains(m, "maximum batch")) {
		return "batch too large"
	}
	if tooLarge(m) {
		return "log result size too large"
	}
	if rateLimited(code, m) {
		return "rate limited"
	}
	for _, known := range []string{"execution reverted", "already known", "already imported", "nonce too low", "replacement transaction underpriced",
		"insufficient funds", "header not found", "method not found", "method not supported", "transaction underpriced"} {
		if strings.Contains(m, known) {
			return known
		}
	}
	return "RPC execution error"
}
