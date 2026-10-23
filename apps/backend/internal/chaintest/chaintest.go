// Package chaintest runs a real Anvil chain with the real contracts for tests (D-17). It needs Foundry (anvil, forge,
// cast) on PATH, as CI and contract work already do.
package chaintest

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"syscall"
	"testing"
	"time"

	"github.com/ethereum/go-ethereum/rpc"
)

var deployedTo = regexp.MustCompile(`"deployedTo":\s*"(0x[0-9a-fA-F]{40})"`)

// Anvil's first default account: public test key, never used outside a local chain.
const (
	Key    = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
	Sender = "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266"
)

// ChainID is Anvil's default chain id.
const ChainID = 31337

// Anvil is a running local chain whose finalized block is always 2 blocks behind the latest.
type Anvil struct {
	t         *testing.T
	URL       string
	RPC       *rpc.Client
	authority string // the factory's refund authority, impersonated after DeployFactory
}

func Start(t *testing.T) *Anvil {
	t.Helper()
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	port := l.Addr().(*net.TCPAddr).Port
	l.Close()
	// One slot per epoch: safe = latest - 1, finalized = latest - 2. No states on disk: Anvil otherwise writes them to
	// ~/.foundry/anvil/tmp and never removes them, even on a clean exit (Anvil 1.5); tests read only recent blocks.
	cmd := exec.Command("anvil", "--port", fmt.Sprint(port), "--slots-in-an-epoch", "1", "--silent",
		"--max-persisted-states", "0")
	if err := cmd.Start(); err != nil {
		t.Fatalf("start anvil (install Foundry): %v", err)
	}
	exited := make(chan error, 1)
	go func() { exited <- cmd.Wait() }()
	t.Cleanup(func() { _ = cmd.Process.Kill(); <-exited })

	a := &Anvil{t: t, URL: fmt.Sprintf("http://127.0.0.1:%d", port)}
	for i := 0; ; i++ {
		select {
		case err := <-exited: // e.g. the port was taken: never talk to another process on it
			t.Fatalf("anvil exited: %v", err)
		default:
		}
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
	m := deployedTo.FindStringSubmatch(out)
	if m == nil {
		a.t.Fatalf("forge create: no deployedTo in\n%s", out)
	}
	return strings.ToLower(m[1])
}

var factoryLine = regexp.MustCompile(`factory (0x[0-9a-fA-F]{40})`)

// DeployFactory deploys the v1 factory as on the testnets, so it lands at the address the Go code has compiled in,
// and makes Sender the executor so tests sign with Anvil's key. It returns the factory address in lowercase.
func (a *Anvil) DeployFactory() string {
	a.t.Helper()
	raw, err := os.ReadFile(filepath.Join(contractsDir(), "deployments.json"))
	if err != nil {
		a.t.Fatal(err)
	}
	var d struct {
		Chains map[string]struct{ RefundAuthority, Executor string } `json:"chains"`
	}
	if err := json.Unmarshal(raw, &d); err != nil {
		a.t.Fatal(err)
	}
	testnet := d.Chains["base-sepolia"]
	// Foundry locks the script's broadcast recovery file, one per chain ID, so deploys from parallel test processes
	// take turns.
	cache := filepath.Join(contractsDir(), "cache")
	if err := os.MkdirAll(cache, 0o755); err != nil {
		a.t.Fatal(err)
	}
	lock, err := os.OpenFile(filepath.Join(cache, "chaintest-deploy.lock"), os.O_CREATE|os.O_RDWR, 0o600)
	if err != nil {
		a.t.Fatal(err)
	}
	defer lock.Close()
	if err := syscall.Flock(int(lock.Fd()), syscall.LOCK_EX); err != nil {
		a.t.Fatal(err)
	}
	out := a.runEnv([]string{"REFUND_AUTHORITY=" + testnet.RefundAuthority, "EXECUTOR=" + testnet.Executor,
		"DEPLOYER_PRIVATE_KEY=" + Key}, "forge", "script", filepath.Join(contractsDir(), "script/Deploy.s.sol")+":Deploy",
		"--root", contractsDir(),
		"--rpc-url", a.URL, "--broadcast")
	m := factoryLine.FindStringSubmatch(out)
	if m == nil {
		a.t.Fatalf("forge script Deploy: no factory in\n%s", out)
	}
	factory := strings.ToLower(m[1])
	for _, call := range [][]any{{"anvil_setBalance", testnet.RefundAuthority, "0xde0b6b3a7640000"},
		{"anvil_impersonateAccount", testnet.RefundAuthority}} {
		if err := a.RPC.Call(nil, call[0].(string), call[1:]...); err != nil {
			a.t.Fatal(err)
		}
	}
	a.authority = testnet.RefundAuthority
	a.AsAuthority(factory, "setExecutor(address)", Sender)
	return factory
}

// AsAuthority sends a call from the factory's refund authority (after DeployFactory).
func (a *Anvil) AsAuthority(to, sig string, args ...string) {
	a.t.Helper()
	a.run("cast", append([]string{"send", "--rpc-url", a.URL, "--unlocked", "--from", a.authority, to, sig}, args...)...)
}

func (a *Anvil) Mint(token string, amount string) {
	a.t.Helper()
	a.Send(token, "mint(address,uint256)", Sender, amount)
}

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

func (a *Anvil) Mine(n int) {
	a.t.Helper()
	if err := a.RPC.Call(nil, "anvil_mine", fmt.Sprintf("0x%x", n)); err != nil {
		a.t.Fatal(err)
	}
}

func (a *Anvil) Now() int64 {
	a.t.Helper()
	var block struct {
		Timestamp string `json:"timestamp"`
	}
	if err := a.RPC.Call(&block, "eth_getBlockByNumber", "latest", false); err != nil {
		a.t.Fatal(err)
	}
	var n int64
	if _, err := fmt.Sscanf(block.Timestamp, "0x%x", &n); err != nil {
		a.t.Fatal(err)
	}
	return n
}

// Wait moves the chain's clock forward; the next mined block carries the new time.
func (a *Anvil) Wait(seconds int64) {
	a.t.Helper()
	if err := a.RPC.Call(nil, "evm_increaseTime", seconds); err != nil {
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

func (a *Anvil) RawTx(hash string) string {
	a.t.Helper()
	var raw string
	if err := a.RPC.Call(&raw, "eth_getRawTransactionByHash", hash); err != nil || raw == "" {
		a.t.Fatalf("raw transaction %s: %v", hash, err)
	}
	return raw
}

// SendRaw broadcasts signed transaction bytes and waits until Anvil has mined them, like cast send does.
func (a *Anvil) SendRaw(raw string) {
	a.t.Helper()
	var hash string
	if err := a.RPC.Call(&hash, "eth_sendRawTransaction", raw); err != nil {
		a.t.Fatal(err)
	}
	for i := 0; ; i++ {
		var receipt map[string]any
		if err := a.RPC.Call(&receipt, "eth_getTransactionReceipt", hash); err != nil {
			a.t.Fatal(err)
		}
		if receipt != nil {
			return
		}
		if i == 100 {
			a.t.Fatalf("transaction %s not mined", hash)
		}
		time.Sleep(20 * time.Millisecond)
	}
}

func (a *Anvil) run(name string, args ...string) string {
	a.t.Helper()
	return a.runEnv(nil, name, args...)
}

func (a *Anvil) runEnv(env []string, name string, args ...string) string {
	a.t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	cmd := exec.CommandContext(ctx, name, args...)
	if env != nil {
		cmd.Env = append(os.Environ(), env...)
	}
	out, err := cmd.Output()
	if err != nil {
		stderr := ""
		if ee, ok := err.(*exec.ExitError); ok {
			stderr = string(ee.Stderr)
		}
		a.t.Fatalf("%s %s: %v\n%s%s", name, args[0], err, out, stderr)
	}
	return string(out)
}

func contractsDir() string {
	_, file, _, _ := runtime.Caller(0)
	return filepath.Join(filepath.Dir(file), "../../../../packages/contracts")
}
