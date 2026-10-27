package chain

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math/big"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/ethereum/go-ethereum/ethclient"
	"github.com/ethereum/go-ethereum/rpc"
	"github.com/forwend/forwend/apps/backend/internal/chaintest"
)

func TestPrivatePriorityFallbackAndRecovery(t *testing.T) {
	a := chaintest.Start(t)
	public, confirm, first, other := a.Proxy(), a.Proxy(), a.Proxy(), a.Proxy()
	spec := testSpec(chaintest.ChainID, public.URL, confirm.URL, first.URL, other.URL)
	spec.Endpoints[2].Tier = Private
	spec.Endpoints[3].Role = Primary
	spec.Endpoints[3].Tier = Private
	r, err := NewRPCs(spec, 1000)
	if err != nil {
		t.Fatal(err)
	}
	defer r.Close()
	number(t, t.Context(), r.Primary)
	if len(first.Calls()) == 0 || len(public.Calls()) != 0 || len(other.Calls()) != 0 {
		t.Fatal("private priority ignored")
	}
	first.Fail(func(chaintest.Call) chaintest.Fault { return chaintest.HTTP503 })
	number(t, t.Context(), r.Primary)
	if len(other.Calls()) == 0 || len(public.Calls()) != 0 {
		t.Fatal("second private endpoint not preferred")
	}
	other.Fail(func(chaintest.Call) chaintest.Fault { return chaintest.HTTP503 })
	number(t, t.Context(), r.Primary)
	if len(public.Calls()) == 0 {
		t.Fatal("public fallback not used")
	}
	number(t, t.Context(), r.Second)
	if len(confirm.Calls()) == 0 {
		t.Fatal("confirmation did not use its independent group")
	}
	first.Fail(nil)
	r.pool.mu.Lock()
	r.pool.endpoints[0].restUntil = time.Now().Add(-time.Second)
	r.pool.mu.Unlock()
	before := len(first.Calls())
	number(t, t.Context(), r.Primary)
	if len(first.Calls()) != before+2 {
		t.Fatal("recovered private endpoint was not revalidated and restored")
	}
}

func TestRateLimitCooldownAndSafeExecutionErrors(t *testing.T) {
	a := chaintest.Start(t)
	for _, rateLimit := range []bool{true, false} {
		t.Run(fmt.Sprint(rateLimit), func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				raw, _ := io.ReadAll(r.Body)
				var req struct {
					ID     json.RawMessage
					Method string
				}
				_ = json.Unmarshal(raw, &req)
				if req.Method == "eth_chainId" {
					forward(t, w, a.URL, raw)
					return
				}
				if rateLimit {
					w.Header().Set("Retry-After", "60")
					w.WriteHeader(429)
					fmt.Fprint(w, "SECRET")
					return
				}
				fmt.Fprintf(w, `{"jsonrpc":"2.0","id":%s,"error":{"code":3,"message":"execution reverted SECRET","data":"SECRET"}}`, req.ID)
			}))
			defer server.Close()
			r := newRPCs(t, server.URL, a.URL)
			_, err := tryNumber(t.Context(), r.Primary)
			if err == nil || strings.Contains(err.Error(), "SECRET") {
				t.Fatalf("unsafe error: %v", err)
			}
			failures, until := health(r, r.pool.endpoints[0])
			if rateLimit {
				if failures != 1 || time.Until(until) < 59*time.Second || !errors.Is(err, ErrUnavailable) {
					t.Fatal("rate limit was not controlled and cooled down")
				}
			} else if failures != 0 || !strings.Contains(err.Error(), "execution reverted") {
				t.Fatal("revert incorrectly treated as an outage")
			}
		})
	}
}

func forward(t *testing.T, w http.ResponseWriter, target string, body []byte) {
	t.Helper()
	res, err := http.Post(target, "application/json", bytes.NewReader(body))
	if err != nil {
		t.Error(err)
		w.WriteHeader(502)
		return
	}
	defer res.Body.Close()
	_, _ = io.Copy(w, res.Body)
}

func TestStaleAndUnsupportedFinalizedNodesFailOver(t *testing.T) {
	a := chaintest.Start(t)
	a.Mine(3)
	for _, fault := range []string{"stale", "no-finalized"} {
		t.Run(fault, func(t *testing.T) {
			bad := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				raw, _ := io.ReadAll(r.Body)
				var req struct {
					ID     json.RawMessage
					Method string
					Params []json.RawMessage
				}
				_ = json.Unmarshal(raw, &req)
				if req.Method == "eth_getBlockByNumber" && len(req.Params) > 0 {
					if fault == "stale" && string(req.Params[0]) == `"latest"` {
						fmt.Fprintf(w, `{"jsonrpc":"2.0","id":%s,"result":{"number":"0x1","timestamp":"0x1","hash":"0x%s"}}`, req.ID, strings.Repeat("a", 64))
						return
					}
					if fault == "no-finalized" && string(req.Params[0]) == `"finalized"` {
						fmt.Fprintf(w, `{"jsonrpc":"2.0","id":%s,"result":null}`, req.ID)
						return
					}
				}
				forward(t, w, a.URL, raw)
			}))
			defer bad.Close()
			spec := testSpec(chaintest.ChainID, bad.URL, a.URL, localhost(a.URL))
			spec.MaxHeadAge = time.Minute
			r, err := NewRPCs(spec, 1000)
			if err != nil {
				t.Fatal(err)
			}
			defer r.Close()
			number(t, t.Context(), r.Primary)
			if failures, _ := health(r, r.pool.endpoints[0]); failures != 1 {
				t.Fatal("unhealthy node accepted")
			}
		})
	}
}

func TestRPCRejectsNodeManagedTransactionsAndRedirects(t *testing.T) {
	a := chaintest.Start(t)
	target := a.Proxy()
	redirect := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { http.Redirect(w, r, target.URL, 307) }))
	defer redirect.Close()
	r := newRPCs(t, redirect.URL, a.URL, localhost(a.URL))
	var result string
	if err := r.Primary.CallContext(t.Context(), &result, "eth_sendTransaction", map[string]string{"from": chaintest.Sender}); err == nil {
		t.Fatal("node-managed signing allowed")
	}
	number(t, t.Context(), r.Primary)
	if len(target.Calls()) != 0 {
		t.Fatal("RPC followed a redirect")
	}
}

func TestLostBroadcastResponseRetriesIdenticalSignedBytes(t *testing.T) {
	a := chaintest.Start(t)
	key, err := crypto.HexToECDSA(strings.TrimPrefix(chaintest.Key, "0x"))
	if err != nil {
		t.Fatal(err)
	}
	client := ethclient.NewClient(a.RPC)
	nonce, err := client.PendingNonceAt(t.Context(), common.HexToAddress(chaintest.Sender))
	if err != nil {
		t.Fatal(err)
	}
	gas, err := client.SuggestGasPrice(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	tx, err := types.SignTx(types.NewTransaction(nonce, common.HexToAddress("0x1234"), big.NewInt(1), 21000, gas, nil), types.LatestSignerForChainID(big.NewInt(chaintest.ChainID)), key)
	if err != nil {
		t.Fatal(err)
	}
	var mu sync.Mutex
	var sent [][]byte
	proxy := func(drop bool) *httptest.Server {
		return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			body, _ := io.ReadAll(r.Body)
			var req struct{ Method string }
			_ = json.Unmarshal(body, &req)
			if req.Method == "eth_sendRawTransaction" {
				mu.Lock()
				sent = append(sent, append([]byte{}, body...))
				mu.Unlock()
				if drop {
					res, err := http.Post(a.URL, "application/json", bytes.NewReader(body))
					if err != nil {
						t.Error(err)
					} else {
						res.Body.Close()
					}
					w.WriteHeader(503)
					return
				}
			}
			forward(t, w, a.URL, body)
		}))
	}
	lost, next := proxy(true), proxy(false)
	defer lost.Close()
	defer next.Close()
	r := newRPCs(t, lost.URL, a.URL, next.URL)
	err = ethclient.NewClient(r.Primary).SendTransaction(t.Context(), tx)
	if err != nil && !strings.Contains(err.Error(), "already") && !strings.Contains(err.Error(), "nonce too low") {
		t.Fatal(err)
	}
	mu.Lock()
	defer mu.Unlock()
	if len(sent) != 2 || !bytes.Equal(sent[0], sent[1]) {
		t.Fatal("retry changed or duplicated signed transaction identity")
	}
	a.Mine(1)
	receipt, err := client.TransactionReceipt(t.Context(), tx.Hash())
	if err != nil || receipt.Status != 1 {
		t.Fatalf("transaction not mined: %v", err)
	}
	after, err := client.NonceAt(t.Context(), common.HexToAddress(chaintest.Sender), nil)
	if err != nil || after != nonce+1 {
		t.Fatal("broadcast retry consumed another nonce")
	}
}

func TestOnlyOneRecoveryProbeRuns(t *testing.T) {
	a := chaintest.Start(t)
	var checks atomic.Int32
	var recovering atomic.Bool
	entered, release := make(chan struct{}), make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		var req struct{ Method string }
		_ = json.Unmarshal(raw, &req)
		if req.Method == "eth_chainId" && recovering.Load() {
			if checks.Add(1) == 1 {
				close(entered)
			}
			<-release
		}
		forward(t, w, a.URL, raw)
	}))
	defer server.Close()
	r := newRPCs(t, server.URL, a.URL)
	number(t, t.Context(), r.Primary)
	r.pool.mu.Lock()
	r.pool.endpoints[0].checked = false
	r.pool.endpoints[0].failures = 1
	r.pool.mu.Unlock()
	recovering.Store(true)
	var wg sync.WaitGroup
	for range 8 {
		wg.Go(func() { _, _ = tryNumber(t.Context(), r.Primary) })
	}
	select {
	case <-entered:
	case <-time.After(time.Second):
		t.Fatal("no recovery probe")
	}
	time.Sleep(30 * time.Millisecond)
	close(release)
	wg.Wait()
	if checks.Load() != 1 {
		t.Fatalf("%d simultaneous recovery checks", checks.Load())
	}
}

func TestFinalizedBalanceDoesNotReadAnotherBlockHash(t *testing.T) {
	a := chaintest.Start(t)
	token := a.DeployToken()
	a.Mint(token, "100")
	a.Mine(2)
	client := ethclient.NewClient(a.RPC)
	if _, err := TokenBalanceAtHash(context.Background(), client, chaintest.ChainID, token, chaintest.Sender, common.HexToHash("0xdead")); err == nil {
		t.Fatal("unknown block silently read as latest")
	}
}

func TestOrdinaryCompletionCannotReleaseAnotherHealthProbe(t *testing.T) {
	a := chaintest.Start(t)
	var hold atomic.Bool
	var blocks, checks atomic.Int32
	normalStarted, normalRelease := make(chan struct{}), make(chan struct{})
	probeStarted, probeRelease := make(chan struct{}), make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		var req struct{ Method string }
		_ = json.Unmarshal(raw, &req)
		if hold.Load() {
			if req.Method == "eth_blockNumber" && blocks.Add(1) == 1 {
				close(normalStarted)
				<-normalRelease
			}
			if req.Method == "eth_chainId" {
				if checks.Add(1) == 1 {
					close(probeStarted)
				}
				<-probeRelease
			}
		}
		forward(t, w, a.URL, raw)
	}))
	defer server.Close()
	r := newRPCs(t, server.URL, a.URL)
	number(t, t.Context(), r.Primary)
	hold.Store(true)
	var wg sync.WaitGroup
	normalDone := make(chan struct{})
	wg.Go(func() { _, _ = tryNumber(t.Context(), r.Primary); close(normalDone) })
	<-normalStarted
	r.pool.mu.Lock()
	r.pool.endpoints[0].checkedAt = time.Time{}
	r.pool.mu.Unlock()
	wg.Go(func() { _, _ = tryNumber(t.Context(), r.Primary) })
	<-probeStarted
	close(normalRelease)
	<-normalDone
	wg.Go(func() { _, _ = tryNumber(t.Context(), r.Primary) })
	time.Sleep(30 * time.Millisecond)
	close(probeRelease)
	wg.Wait()
	if checks.Load() != 1 {
		t.Fatalf("ordinary completion released someone else's probe: %d checks", checks.Load())
	}
}

func TestMalformedResponsesFailOverWithoutLeakingProviderText(t *testing.T) {
	a := chaintest.Start(t)
	for _, answer := range []string{`{}`, `null`, `[]`, `{"jsonrpc":"2.0","id":999,"result":"SECRET"}`, `{"jsonrpc":"2.0","id":1,"result":"0x1","error":{"code":3,"message":"SECRET"}}`} {
		t.Run(answer, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				raw, _ := io.ReadAll(r.Body)
				var req struct{ Method string }
				_ = json.Unmarshal(raw, &req)
				if req.Method == "eth_chainId" {
					forward(t, w, a.URL, raw)
					return
				}
				_, _ = io.WriteString(w, answer)
			}))
			defer server.Close()
			r := newRPCs(t, server.URL, a.URL, localhost(a.URL))
			number(t, t.Context(), r.Primary)
			if failures, _ := health(r, r.pool.endpoints[0]); failures != 1 {
				t.Fatal("malformed provider response accepted")
			}
		})
	}
}

func TestFinalizedHeaderPreservesTheProviderHash(t *testing.T) {
	a := chaintest.Start(t)
	a.Mine(3)
	want := common.HexToHash("0x1234")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		res, err := http.Post(a.URL, "application/json", bytes.NewReader(raw))
		if err != nil {
			t.Error(err)
			return
		}
		defer res.Body.Close()
		var reply map[string]any
		if err := json.NewDecoder(res.Body).Decode(&reply); err != nil {
			t.Error(err)
			return
		}
		reply["result"].(map[string]any)["hash"] = want.Hex()
		_ = json.NewEncoder(w).Encode(reply)
	}))
	defer server.Close()
	client, err := ethclient.Dial(server.URL)
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()
	head, err := Finalized(t.Context(), client)
	if err != nil || head.Hash != want {
		t.Fatalf("provider hash was recomputed: %v", err)
	}
}

func TestHTTP200WholeBatchLimitsRemainSplittable(t *testing.T) {
	a := chaintest.Start(t)
	for _, array := range []bool{false, true} {
		t.Run(fmt.Sprint(array), func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				raw, _ := io.ReadAll(r.Body)
				if len(raw) > 0 && raw[0] == '[' {
					answer := `{"jsonrpc":"2.0","id":null,"error":{"code":-32005,"message":"maximum batch exceeded SECRET"}}`
					if array {
						answer = "[" + answer + "]"
					}
					_, _ = io.WriteString(w, answer)
					return
				}
				forward(t, w, a.URL, raw)
			}))
			defer server.Close()
			r := newRPCs(t, server.URL, a.URL)
			var first, second string
			err := r.Primary.BatchCallContext(t.Context(), []rpc.BatchElem{{Method: "eth_blockNumber", Result: &first}, {Method: "eth_blockNumber", Result: &second}})
			if !BatchTooLarge(err) || strings.Contains(err.Error(), "SECRET") {
				t.Fatalf("whole-batch limit lost or leaked: %v", err)
			}
			if failures, _ := health(r, r.pool.endpoints[0]); failures != 0 {
				t.Fatal("query size limit rested a healthy provider")
			}
			number(t, t.Context(), r.Primary)
		})
	}
}

func TestPeriodicHealthCheckRejectsAProviderThatChangesChains(t *testing.T) {
	a := chaintest.Start(t)
	var wrong atomic.Bool
	var business atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		var req struct {
			ID     json.RawMessage
			Method string
		}
		_ = json.Unmarshal(raw, &req)
		if wrong.Load() {
			if req.Method == "eth_chainId" {
				fmt.Fprintf(w, `{"jsonrpc":"2.0","id":%s,"result":"0x1"}`, req.ID)
				return
			}
			business.Add(1)
		}
		forward(t, w, a.URL, raw)
	}))
	defer server.Close()
	r := newRPCs(t, server.URL, a.URL, localhost(a.URL))
	number(t, t.Context(), r.Primary)
	wrong.Store(true)
	r.pool.mu.Lock()
	r.pool.endpoints[0].checkedAt = time.Time{}
	r.pool.mu.Unlock()
	number(t, t.Context(), r.Primary)
	if business.Load() != 0 {
		t.Fatal("business request sent after chain identity changed")
	}
}
