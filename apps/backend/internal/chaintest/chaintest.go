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
	"runtime"
	"strings"
	"sync"
	"syscall"
	"testing"
	"time"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/common/hexutil"
	"github.com/ethereum/go-ethereum/crypto"
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
	t         *testing.T
	URL       string
	RPC       *rpc.Client
	authority string // the factory's refund authority, impersonated after DeployFactory
}

func Start(t *testing.T) *Anvil {
	t.Helper()
	return StartChain(t, ChainID)
}

func StartArchive(t *testing.T) *Anvil {
	t.Helper()
	return startChain(t, ChainID, t.TempDir())
}

func StartChain(t *testing.T, chainID uint64) *Anvil {
	t.Helper()
	return startChain(t, chainID, "")
}

func startChain(t *testing.T, chainID uint64, archive string) *Anvil {
	t.Helper()
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	port := l.Addr().(*net.TCPAddr).Port
	l.Close()
	// One slot per epoch: safe = latest - 1, finalized = latest - 2. No states on disk: Anvil otherwise writes them to
	// ~/.foundry/anvil/tmp and never removes them, even on a clean exit (Anvil 1.5); tests read only recent blocks.
	persisted := "0"
	if archive != "" {
		persisted = "20000"
	}
	cmd := exec.Command("anvil", "--port", fmt.Sprint(port), "--slots-in-an-epoch", "1", "--silent",
		"--max-persisted-states", persisted, "--chain-id", fmt.Sprint(chainID))
	if archive != "" {
		cmd.Args = append(cmd.Args, "--cache-path", archive)
	}
	if err := cmd.Start(); err != nil {
		t.Fatalf("start anvil (install Foundry): %v", err)
	}
	exited := make(chan error, 1)
	go func() { exited <- cmd.Wait(); close(exited) }()
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
	receipt := a.transact(Sender, "", bytecode(a.t, "MockToken"))
	return strings.ToLower(receipt.ContractAddress)
}

// The CREATE2 deployer Anvil and every testnet have, and script/Deploy.s.sol's salt (contracts test Deploy.t.sol).
var (
	create2Deployer = common.HexToAddress("0x4e59b44847b379578588920ca78fbf26c0b4956c")
	factorySalt     = crypto.Keccak256([]byte("forwend.invoice-receiver-factory.v1"))
)

// DeployFactory deploys the v1 factory as script/Deploy.s.sol does on the testnets, through the CREATE2 deployer with
// the testnet arguments, so it lands at the address the Go code has compiled in. It makes Sender the executor so tests
// sign with Anvil's key, and returns the factory address in lowercase.
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
	args := make([]byte, 0, 64)
	for _, arg := range []string{testnet.RefundAuthority, testnet.Executor} {
		args = append(args, common.LeftPadBytes(common.HexToAddress(arg).Bytes(), 32)...)
	}
	init := append(bytecode(a.t, "InvoiceReceiverFactory"), args...)
	at := crypto.CreateAddress2(create2Deployer, [32]byte(factorySalt), crypto.Keccak256(init))
	// Already there: the script deploys nothing then either.
	if a.code(at) == 0 {
		a.transact(Sender, create2Deployer.Hex(), append(append([]byte{}, factorySalt...), init...))
		if a.code(at) == 0 {
			a.t.Fatalf("factory not deployed at %s", at)
		}
	}
	factory := strings.ToLower(at.Hex())
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

// code is the size of the code at an address.
func (a *Anvil) code(at common.Address) int {
	a.t.Helper()
	var code hexutil.Bytes
	if err := a.RPC.Call(&code, "eth_getCode", at, "latest"); err != nil {
		a.t.Fatal(err)
	}
	return len(code)
}

// AsAuthority sends a call from the factory's refund authority (after DeployFactory).
func (a *Anvil) AsAuthority(to, sig string, args ...string) {
	a.t.Helper()
	a.call(a.authority, to, sig, args...)
}

// AsAuthorityData sends raw calldata from the refund authority, as a Safe sends a Transaction Builder entry.
func (a *Anvil) AsAuthorityData(to string, data []byte) {
	a.t.Helper()
	a.transact(a.authority, to, data)
}

// Calldata is sig(args) encoded as cast send encodes it.
func Calldata(sig string, args ...string) ([]byte, error) {
	return calldata(sig, args...)
}

func (a *Anvil) Mint(token string, amount string) {
	a.t.Helper()
	a.Send(token, "mint(address,uint256)", Sender, amount)
}

func (a *Anvil) Transfer(token, to, amount string) string {
	a.t.Helper()
	return a.Send(token, "transfer(address,uint256)", to, amount)
}

// TwoTransfers moves token out of the sender twice in one transaction, as a bundler or a Tempo fee does: a contract the
// sender allowed calls transferFrom for each. It returns the transaction hash.
func (a *Anvil) TwoTransfers(token, to1, amount1, to2, amount2 string) string {
	a.t.Helper()
	batcher := "0x00000000000000000000000000000000000000dd"
	// Copy both calls' data, make each and revert if it fails (so the gas estimate covers both), then stop.
	call := func(argsOffset string) string {
		return "600060006064" + "60" + argsOffset + "6000" + "73" + strings.TrimPrefix(token, "0x") + "5af1" + "15605257"
	}
	if err := a.RPC.Call(nil, "anvil_setCode", batcher,
		"0x60c86000600037"+call("00")+call("64")+"00"+"5b60006000fd"); err != nil {
		a.t.Fatal(err)
	}
	a.Send(token, "approve(address,uint256)", batcher, "115792089237316195423570985008687907853269984665640564039457584007913129639935")
	first, err := calldata("transferFrom(address,address,uint256)", Sender, to1, amount1)
	if err != nil {
		a.t.Fatal(err)
	}
	second, err := calldata("transferFrom(address,address,uint256)", Sender, to2, amount2)
	if err != nil {
		a.t.Fatal(err)
	}
	return a.transact(Sender, batcher, append(first, second...)).TransactionHash
}

// Send calls a contract from the sender, waits for the receipt and returns the transaction hash.
func (a *Anvil) Send(to, sig string, args ...string) string {
	a.t.Helper()
	return a.call(Sender, to, sig, args...)
}

// call sends sig(args) from an account Anvil signs for (its own or an impersonated one), as cast send does.
func (a *Anvil) call(from, to, sig string, args ...string) string {
	a.t.Helper()
	data, err := calldata(sig, args...)
	if err != nil {
		a.t.Fatal(err)
	}
	return a.transact(from, to, data).TransactionHash
}

type receipt struct {
	TransactionHash string `json:"transactionHash"`
	ContractAddress string `json:"contractAddress"`
	Status          string `json:"status"`
}

// transact sends a transaction from an account Anvil signs for and waits for its successful receipt; an empty to
// creates a contract. A revert stops the test, as cast send and forge create did.
func (a *Anvil) transact(from, to string, data []byte) receipt {
	a.t.Helper()
	tx := map[string]any{"from": from, "data": hexutil.Bytes(data)}
	if to != "" {
		tx["to"] = to
	}
	var hash string
	if err := a.RPC.Call(&hash, "eth_sendTransaction", tx); err != nil {
		a.t.Fatalf("send to %q: %v", to, err)
	}
	for i := 0; ; i++ {
		var r *receipt
		if err := a.RPC.Call(&r, "eth_getTransactionReceipt", hash); err != nil {
			a.t.Fatal(err)
		}
		if r != nil {
			if r.Status != "0x1" {
				a.t.Fatalf("transaction %s to %q reverted", hash, to)
			}
			return *r
		}
		if i == 100 {
			a.t.Fatalf("transaction %s not mined", hash)
		}
		time.Sleep(20 * time.Millisecond)
	}
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

var (
	buildOnce sync.Once
	buildErr  error
)

// bytecode is a contract's creation code from Foundry's build. The contracts build once per test process; the build
// takes a lock, as test packages run as parallel processes that would otherwise write the same output.
func bytecode(t *testing.T, contract string) []byte {
	t.Helper()
	buildOnce.Do(func() { buildErr = build() })
	if buildErr != nil {
		t.Fatal(buildErr)
	}
	matches, err := filepath.Glob(filepath.Join(contractsDir(), "out", "*", contract+".json"))
	if err != nil || len(matches) != 1 {
		t.Fatalf("artifact %s: %v %v", contract, matches, err)
	}
	raw, err := os.ReadFile(matches[0])
	if err != nil {
		t.Fatal(err)
	}
	var artifact struct {
		Bytecode struct {
			Object hexutil.Bytes `json:"object"`
		} `json:"bytecode"`
	}
	if err := json.Unmarshal(raw, &artifact); err != nil || len(artifact.Bytecode.Object) == 0 {
		t.Fatalf("artifact %s: no bytecode: %v", contract, err)
	}
	return artifact.Bytecode.Object
}

func build() error {
	cache := filepath.Join(contractsDir(), "cache")
	if err := os.MkdirAll(cache, 0o755); err != nil {
		return err
	}
	lock, err := os.OpenFile(filepath.Join(cache, "chaintest-build.lock"), os.O_CREATE|os.O_RDWR, 0o600)
	if err != nil {
		return err
	}
	defer lock.Close()
	if err := syscall.Flock(int(lock.Fd()), syscall.LOCK_EX); err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()
	if out, err := exec.CommandContext(ctx, "forge", "build", "--root", contractsDir()).CombinedOutput(); err != nil {
		return fmt.Errorf("forge build: %v\n%s", err, out)
	}
	return nil
}

func contractsDir() string {
	_, file, _, _ := runtime.Caller(0)
	return filepath.Join(filepath.Dir(file), "../../../../packages/contracts")
}
