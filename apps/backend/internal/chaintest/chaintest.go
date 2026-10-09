// Package chaintest runs a real Anvil chain with the real contracts for tests (D-17). It needs Foundry (anvil, forge,
// cast) on PATH, as CI and contract work already do.
package chaintest

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/ethereum/go-ethereum/rpc"
)

// Anvil's first default account: public test key, never used outside a local chain.
const (
	Key    = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
	Sender = "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266"
)

// ChainID is Anvil's default chain id.
const ChainID = 31337

// Anvil is a running local chain whose finalized block is always 2 blocks behind the latest.
type Anvil struct {
	t   *testing.T
	URL string
	RPC *rpc.Client
}

// Start runs Anvil on a free port until the test ends.
func Start(t *testing.T) *Anvil {
	t.Helper()
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	port := l.Addr().(*net.TCPAddr).Port
	l.Close()
	// One slot per epoch: safe = latest - 1, finalized = latest - 2.
	cmd := exec.Command("anvil", "--port", fmt.Sprint(port), "--slots-in-an-epoch", "1", "--silent")
	if err := cmd.Start(); err != nil {
		t.Fatalf("start anvil (install Foundry): %v", err)
	}
	t.Cleanup(func() { _ = cmd.Process.Kill(); _ = cmd.Wait() })

	a := &Anvil{t: t, URL: fmt.Sprintf("http://127.0.0.1:%d", port)}
	for i := 0; ; i++ {
		if a.RPC, err = rpc.Dial(a.URL); err == nil {
			var id string
			if err = a.RPC.Call(&id, "eth_chainId"); err == nil {
				break
			}
		}
		if i == 100 {
			t.Fatalf("anvil did not start: %v", err)
		}
		time.Sleep(50 * time.Millisecond)
	}
	t.Cleanup(a.RPC.Close)
	return a
}

// DeployToken deploys a fresh MockToken (6 decimals, public mint) and returns its lowercase address.
func (a *Anvil) DeployToken() string {
	a.t.Helper()
	out := a.run("forge", "create", "test/mocks/MockToken.sol:MockToken", "--root", contractsDir(),
		"--rpc-url", a.URL, "--private-key", Key, "--broadcast", "--json")
	var res struct {
		DeployedTo string `json:"deployedTo"`
	}
	if err := json.Unmarshal([]byte(out[strings.LastIndex(out, "{\n"):]), &res); err != nil || res.DeployedTo == "" {
		a.t.Fatalf("forge create: %v\n%s", err, out)
	}
	return strings.ToLower(res.DeployedTo)
}

// Mint gives the sender tokens.
func (a *Anvil) Mint(token string, amount string) {
	a.t.Helper()
	a.Send(token, "mint(address,uint256)", Sender, amount)
}

// Transfer sends tokens from the sender and returns the transaction hash.
func (a *Anvil) Transfer(token, to, amount string) string {
	a.t.Helper()
	return a.Send(token, "transfer(address,uint256)", to, amount)
}

// Send calls a contract from the sender, waits for the receipt and returns the transaction hash.
func (a *Anvil) Send(to, sig string, args ...string) string {
	a.t.Helper()
	out := a.run("cast", append([]string{"send", "--rpc-url", a.URL, "--private-key", Key, "--json", to, sig}, args...)...)
	var receipt struct {
		TransactionHash string `json:"transactionHash"`
	}
	if err := json.Unmarshal([]byte(out), &receipt); err != nil {
		a.t.Fatalf("cast send: %v\n%s", err, out)
	}
	return receipt.TransactionHash
}

// Mine adds n empty blocks.
func (a *Anvil) Mine(n int) {
	a.t.Helper()
	if err := a.RPC.Call(nil, "anvil_mine", fmt.Sprintf("0x%x", n)); err != nil {
		a.t.Fatal(err)
	}
}

// Reorg replaces the last depth blocks with new empty ones; their transactions are dropped.
func (a *Anvil) Reorg(depth int) {
	a.t.Helper()
	if err := a.RPC.Call(nil, "anvil_reorg", depth, []any{}); err != nil {
		a.t.Fatal(err)
	}
}

// RawTx returns a mined transaction's signed bytes, so it can be sent again after a reorg drops it.
func (a *Anvil) RawTx(hash string) string {
	a.t.Helper()
	var raw string
	if err := a.RPC.Call(&raw, "eth_getRawTransactionByHash", hash); err != nil || raw == "" {
		a.t.Fatalf("raw transaction %s: %v", hash, err)
	}
	return raw
}

// SendRaw broadcasts signed transaction bytes; Anvil mines them at once.
func (a *Anvil) SendRaw(raw string) {
	a.t.Helper()
	var hash string
	if err := a.RPC.Call(&hash, "eth_sendRawTransaction", raw); err != nil {
		a.t.Fatal(err)
	}
}

func (a *Anvil) run(name string, args ...string) string {
	a.t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	out, err := exec.CommandContext(ctx, name, args...).Output()
	if err != nil {
		stderr := ""
		if ee, ok := err.(*exec.ExitError); ok {
			stderr = string(ee.Stderr)
		}
		a.t.Fatalf("%s %s: %v\n%s%s", name, args[0], err, out, stderr)
	}
	return string(out)
}

// contractsDir is packages/contracts, found from this file's location.
func contractsDir() string {
	_, file, _, _ := runtime.Caller(0)
	return filepath.Join(filepath.Dir(file), "../../../../packages/contracts")
}
