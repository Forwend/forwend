package chain

import (
	"bytes"
	"encoding/json"
	"errors"
	"strings"

	"github.com/ethereum/go-ethereum/common/hexutil"
)

// request is the size of one HTTP request: its number of calls, and the blocks of a single eth_getLogs.
type request struct {
	calls     int
	blocks    uint64
	addresses int  // contracts a single eth_getLogs names
	broadcast bool // it sends a signed transaction
}

// Only stateless reads and already-signed transactions can cross provider boundaries safely.
func parseRequest(body []byte) (request, error) {
	type call struct {
		Method string
		Params []json.RawMessage
	}
	var calls []call
	if err := json.Unmarshal(body, &calls); err != nil {
		var one call
		if json.Unmarshal(body, &one) != nil {
			return request{}, errors.New("invalid RPC request")
		}
		calls = append(calls, one)
	}
	if len(calls) == 0 {
		return request{}, errors.New("empty RPC batch")
	}
	for _, c := range calls {
		switch c.Method {
		case "eth_chainId", "eth_blockNumber", "eth_getBlockByNumber", "eth_getBlockByHash", "eth_getBlockReceipts",
			"eth_getLogs", "eth_getBalance", "eth_getCode", "eth_call", "eth_getTransactionCount", "eth_getTransactionByHash",
			"eth_getTransactionReceipt", "eth_estimateGas", "eth_gasPrice", "eth_maxPriorityFeePerGas", "eth_feeHistory", "eth_sendRawTransaction":
		default:
			return request{}, errors.New("RPC method is not permitted")
		}
	}
	r := request{calls: len(calls)}
	for _, c := range calls {
		r.broadcast = r.broadcast || c.Method == "eth_sendRawTransaction"
	}
	if len(calls) == 1 && calls[0].Method == "eth_getLogs" && len(calls[0].Params) == 1 {
		var filter struct {
			FromBlock, ToBlock hexutil.Uint64
			Address            json.RawMessage
		}
		if json.Unmarshal(calls[0].Params[0], &filter) == nil && filter.ToBlock >= filter.FromBlock {
			r.blocks = uint64(filter.ToBlock-filter.FromBlock) + 1
		}
		var addresses []string
		if json.Unmarshal(filter.Address, &addresses) == nil {
			r.addresses = len(addresses)
		}
	}
	return r, nil
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

// missing is the safe message for a block or state the endpoint doesn't have: one behind the head, or a pruned node.
const missing = "block or state not available"

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
	for _, lacks := range []string{"header not found", "unknown block", "block not found", "missing trie node", "historical state",
		"state not available", "state is not available", "pruned"} {
		if strings.Contains(m, lacks) {
			return missing
		}
	}
	for _, known := range []string{"execution reverted", "already known", "already imported", "nonce too low", "replacement transaction underpriced",
		"insufficient funds", "method not found", "method not supported", "transaction underpriced"} {
		if strings.Contains(m, known) {
			return known
		}
	}
	return "RPC execution error"
}
