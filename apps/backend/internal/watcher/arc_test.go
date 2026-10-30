package watcher

import (
	"encoding/json"
	"fmt"
	"math/big"
	"net/http"
	"net/http/httptest"
	"slices"
	"testing"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/common/hexutil"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/ethereum/go-ethereum/rpc"
	"github.com/forwend/forwend/apps/backend/internal/chain"
)

var (
	arcPayer    = common.HexToAddress("0x00000000000000000000000000000000000000a1")
	arcReceiver = common.HexToAddress("0x00000000000000000000000000000000000000b2")
)

func arcLog(from common.Address, emitter common.Address, tx byte, index uint, value *big.Int) types.Log {
	return types.Log{Address: emitter, Topics: []common.Hash{transferTopic, common.BytesToHash(from.Bytes()),
		common.BytesToHash(arcReceiver.Bytes())}, Data: common.LeftPadBytes(value.Bytes(), 32), BlockNumber: 7,
		TxHash: common.Hash{tx}, BlockHash: common.Hash{0xbb}, Index: index}
}

// micro is n micro-USDC in the system log's 18 decimals.
func micro(n int64) *big.Int { return new(big.Int).Mul(big.NewInt(n), arcScale) }

func credited(logs []types.Log) []string {
	var out []string
	for _, l := range logs {
		out = append(out, fmt.Sprintf("%s:%d:%s", l.Address.Hex()[:6], l.Index, new(big.Int).SetBytes(l.Data)))
	}
	return out
}

func TestArcUSDCIsCreditedOncePerMovement(t *testing.T) {
	toOther := arcLog(arcPayer, arcEmitter, 1, 1, micro(1000000))
	toOther.Topics = []common.Hash{transferTopic, common.BytesToHash(arcPayer.Bytes()), common.BytesToHash(arcPayer.Bytes())}
	for name, c := range map[string]struct {
		logs []types.Log
		want []string
	}{
		"an ERC-20 transfer logs a system twin just before it": {
			[]types.Log{arcLog(arcPayer, arcEmitter, 1, 1, micro(5000000)), arcLog(arcPayer, arcUSDC, 1, 2, big.NewInt(5000000))},
			[]string{"0x3600:2:5000000"}},
		"a native send logs only the system log": {
			[]types.Log{arcLog(arcPayer, arcEmitter, 1, 0, micro(5000000))},
			[]string{"0x3600:0:5000000"}},
		"a native send floors to 6 decimals": {
			[]types.Log{arcLog(arcPayer, arcEmitter, 1, 0, new(big.Int).Add(micro(5000000), big.NewInt(999999999999)))},
			[]string{"0x3600:0:5000000"}},
		"under one micro-USDC is no credit": {
			[]types.Log{arcLog(arcPayer, arcEmitter, 1, 0, big.NewInt(999999999999))},
			nil},
		"a CCTP mint's twin comes two logs later": {
			[]types.Log{arcLog(common.Address{}, arcEmitter, 1, 3, micro(2000000)), arcLog(common.Address{}, arcUSDC, 1, 5, big.NewInt(2000000))},
			[]string{"0x3600:5:2000000"}},
		"a native send and an equal ERC-20 transfer in one transaction both count": {
			[]types.Log{arcLog(arcPayer, arcEmitter, 1, 0, micro(1000000)), arcLog(arcPayer, arcEmitter, 1, 1, micro(1000000)),
				arcLog(arcPayer, arcUSDC, 1, 2, big.NewInt(1000000))},
			[]string{"0x3600:0:1000000", "0x3600:2:1000000"}},
		"a system log of another transaction is no twin": {
			[]types.Log{arcLog(arcPayer, arcEmitter, 1, 1, micro(1000000)), arcLog(arcPayer, arcUSDC, 2, 2, big.NewInt(1000000))},
			[]string{"0x3600:1:1000000", "0x3600:2:1000000"}},
		"a system log of another sender is no twin": {
			[]types.Log{arcLog(arcPayer, arcEmitter, 1, 0, micro(1000000)), arcLog(arcReceiver, arcEmitter, 1, 1, micro(1000000)),
				arcLog(arcPayer, arcUSDC, 1, 2, big.NewInt(1000000))},
			[]string{"0x3600:1:1000000", "0x3600:2:1000000"}},
		"a system log to another receiver is no twin": {
			[]types.Log{toOther, arcLog(arcPayer, arcUSDC, 1, 2, big.NewInt(1000000))},
			[]string{"0x3600:1:1000000", "0x3600:2:1000000"}},
		"a system log of another amount is no twin": {
			[]types.Log{arcLog(arcPayer, arcEmitter, 1, 1, micro(3000000)), arcLog(arcPayer, arcUSDC, 1, 2, big.NewInt(1000000))},
			[]string{"0x3600:1:3000000", "0x3600:2:1000000"}},
	} {
		t.Run(name, func(t *testing.T) {
			if got := credited(nativeSends(c.logs)); !slices.Equal(got, c.want) {
				t.Fatalf("credited %v, want %v", got, c.want)
			}
		})
	}
}

// The deposit scan asks for Arc's system logs with the token's and counts a native send as the invoice's token.
func TestArcDepositScanReadsNativeSends(t *testing.T) {
	lookalike := common.HexToAddress("0x00000000000000000000000000000000000000c3")
	var asked []common.Address
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			ID     json.RawMessage
			Params []struct{ Address []common.Address }
		}
		_ = json.NewDecoder(r.Body).Decode(&req)
		asked = req.Params[0].Address
		logs := []types.Log{
			arcLog(arcPayer, arcEmitter, 1, 0, micro(4000000)),
			arcLog(arcPayer, arcEmitter, 2, 0, micro(1000000)), arcLog(arcPayer, arcUSDC, 2, 1, big.NewInt(1000000)),
			arcLog(arcPayer, lookalike, 3, 0, big.NewInt(9000000)),
		}
		out, _ := json.Marshal(logs)
		fmt.Fprintf(w, `{"jsonrpc":"2.0","id":%s,"result":%s}`, req.ID, out)
	}))
	t.Cleanup(server.Close)
	client, err := rpc.Dial(server.URL)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(client.Close)
	c := NewChain(nil, 5042002, client)
	logs, err := c.logs(t.Context(), 1, 10, map[common.Address]receiver{arcReceiver: {"0x01", hexutil.Encode(arcUSDC[:])}})
	if err != nil {
		t.Fatal(err)
	}
	if !slices.Contains(asked, arcEmitter) || !slices.Contains(asked, arcUSDC) {
		t.Fatalf("asked for logs of %v, want the token and the system emitter", asked)
	}
	if got := credited(logs); !slices.Equal(got, []string{"0x3600:0:4000000", "0x3600:1:1000000"}) {
		t.Fatalf("credited %v; want the native send and the ERC-20 transfer once each, never the look-alike", got)
	}
	// An invoice in another token never counts the system emitter's logs, which move only USDC.
	logs, err = c.logs(t.Context(), 1, 10, map[common.Address]receiver{arcReceiver: {"0x01", hexutil.Encode(lookalike[:])}})
	if err != nil {
		t.Fatal(err)
	}
	if slices.Contains(asked, arcEmitter) {
		t.Fatalf("asked for the system emitter's logs for an invoice in another token: %v", asked)
	}
	if got := credited(logs); !slices.Equal(got, []string{lookalike.Hex()[:6] + ":0:9000000"}) {
		t.Fatalf("credited %v; want only the invoice's own token", got)
	}
}

// When every endpoint refuses the receivers' list for its length, the scan reads it in smaller parts.
func TestReceiverEventsAreReadInPartsWhenEveryEndpointRefusesTheList(t *testing.T) {
	var asked []int
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			ID     json.RawMessage
			Method string
			Params []struct{ Address []common.Address }
		}
		_ = json.NewDecoder(r.Body).Decode(&req)
		if req.Method == "eth_chainId" {
			fmt.Fprintf(w, `{"jsonrpc":"2.0","id":%s,"result":"0x4cef52"}`, req.ID)
			return
		}
		asked = append(asked, len(req.Params[0].Address))
		if len(req.Params[0].Address) > 2 {
			w.WriteHeader(http.StatusForbidden)
			fmt.Fprintf(w, `{"jsonrpc":"2.0","error":{"code":-32602,"message":"A maximum of 2 addresses is allowed."},"id":%s}`, req.ID)
			return
		}
		var logs []types.Log
		for _, a := range req.Params[0].Address {
			l := arcLog(arcPayer, a, 1, 0, big.NewInt(1))
			l.Topics[0] = settledTopic
			logs = append(logs, l)
		}
		out, _ := json.Marshal(logs)
		fmt.Fprintf(w, `{"jsonrpc":"2.0","id":%s,"result":%s}`, req.ID, out)
	}))
	t.Cleanup(server.Close)
	r, err := chain.NewRPCs(chain.Spec{ChainID: 5042002, AllowLoopback: true, Endpoints: []chain.Endpoint{{ID: "rpc-0",
		Provider: "provider-0", Role: chain.Primary, Tier: chain.Public, URL: server.URL, BudgetGroup: "budget-0"}}}, 1000)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(r.Close)
	receivers := map[common.Address]receiver{}
	for i := range 5 {
		receivers[common.BigToAddress(big.NewInt(int64(0xb0+i)))] = receiver{fmt.Sprintf("0x%02x", i), hexutil.Encode(arcUSDC[:])}
	}
	logs, err := NewChain(nil, 5042002, r.Client).outflowLogs(t.Context(), 1, 10, receivers)
	if err != nil || len(logs) != 5 {
		t.Fatalf("%d receiver events, %v; want all 5 read in parts (asked %v)", len(logs), err, asked)
	}
}
