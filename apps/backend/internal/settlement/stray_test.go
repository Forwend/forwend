package settlement

import (
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/ethereum/go-ethereum"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/ethclient"
	"github.com/forwend/forwend/apps/backend/internal/address"
	"github.com/forwend/forwend/apps/backend/internal/chaintest"
)

func dial(t *testing.T, a *chaintest.Anvil) *ethclient.Client {
	t.Helper()
	c, err := ethclient.Dial(a.URL)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(c.Close)
	return c
}

func balanceOf(t *testing.T, c *ethclient.Client, token, holder string) int64 {
	t.Helper()
	to := common.HexToAddress(token)
	out, err := c.CallContract(t.Context(), ethereum.CallMsg{To: &to,
		Data: append(append([]byte{}, balanceOfSelector...), common.LeftPadBytes(common.HexToAddress(holder).Bytes(), 32)...)}, nil)
	if err != nil {
		t.Fatal(err)
	}
	return new(big.Int).SetBytes(out).Int64()
}

// D-33, D-118: support returns another token, or money on another chain, with recover where our contracts are, and
// says plainly where they aren't.
func TestSupportRecoversWrongTokenAndWrongChainMoney(t *testing.T) {
	e := setup(t)
	ctx := t.Context()
	id, receive := e.create(t, 7)
	option := CaseOption{ID: id, ChainID: e.chainID}
	withFactory := chaintest.StartChain(t, 31338)
	withFactory.DeployFactory()
	without := chaintest.StartChain(t, 31339)
	clients := map[uint64]*ethclient.Client{e.chainID: e.client, 31338: dial(t, withFactory), 31339: dial(t, without)}

	// find makes the transfer final first: a recover is printed only for a final one.
	find := func(a *chaintest.Anvil, hash string, chainID uint64) Stray {
		t.Helper()
		a.Mine(2)
		strays, err := FindStrays(ctx, e.pool, clients, hash)
		if err != nil {
			t.Fatal(err)
		}
		if len(strays) != 1 || strays[0].Option != option || strays[0].ChainID != chainID ||
			strays[0].From != common.HexToAddress(chaintest.Sender) || strays[0].Amount.Sign() <= 0 {
			t.Fatalf("strays %+v", strays)
		}
		return strays[0]
	}
	plan := func(s Stray) (Recovery, error) {
		t.Helper()
		return PlanRecovery(ctx, e.pool, e.client, clients[s.ChainID], s, nil)
	}
	run := func(a *chaintest.Anvil, s Stray, r Recovery) {
		t.Helper()
		if r.To != s.From || len(r.Calls) == 0 || r.Calls[len(r.Calls)-1].Signature != recoverSignature {
			t.Fatalf("recovery %+v", r)
		}
		for _, c := range r.Calls {
			a.AsAuthority(strings.ToLower(c.To.Hex()), c.Signature, c.Args...)
		}
	}
	held := func(s Stray) int64 {
		t.Helper()
		return balanceOf(t, clients[s.ChainID], strings.ToLower(s.Token.Hex()), receive)
	}

	// Another token on the invoice's chain: the receiver isn't deployed, so the batch deploys it, then recovers.
	other := e.anvil.DeployToken()
	e.anvil.Mint(other, "5000000")
	s := find(e.anvil, e.anvil.Transfer(other, receive, "2000000"), e.chainID)
	if s.Symbol != "" {
		t.Fatalf("a token Forwend doesn't take has symbol %q", s.Symbol)
	}
	r, err := plan(s)
	if err != nil {
		t.Fatal(err)
	}
	if len(r.Calls) != 2 || len(r.Warnings) != 1 || !strings.Contains(r.Warnings[0], "can still be paid") {
		t.Fatalf("an early deploy: %+v", r)
	}
	// Printed once: a second run is refused until it is released.
	if _, err := plan(s); !errors.Is(err, ErrRecoveryQueued) {
		t.Fatalf("second run: %v", err)
	}
	// Never sent: no recover on chain, so it can be released.
	if n, err := ReleaseRecovery(ctx, e.pool, clients, s.TxHash); err != nil || n != 1 {
		t.Fatalf("release: %d, %v", n, err)
	}
	if r, err = plan(s); err != nil {
		t.Fatal(err)
	}
	run(e.anvil, s, r)
	if got := held(s); got != 0 {
		t.Fatalf("receive address still holds %d", got)
	}
	// Sent: a rerun says it was printed, not that it can't come back, and the lock can't be released.
	if _, err := plan(s); !errors.Is(err, ErrRecoveryQueued) {
		t.Fatalf("rerun after sending: %v", err)
	}
	if _, err := ReleaseRecovery(ctx, e.pool, clients, s.TxHash); !errors.Is(err, ErrRecoverySent) {
		t.Fatalf("release after sending: %v", err)
	}
	// Once deployed, the recover alone, dry-run against the receiver.
	s = find(e.anvil, e.anvil.Transfer(other, receive, "2000000"), e.chainID)
	if r, err = plan(s); err != nil || len(r.Calls) != 1 {
		t.Fatalf("deployed: %+v, %v", r, err)
	}
	run(e.anvil, s, r)
	// An RPC that answers with an error (rate limited) is an error, never "can't be returned".
	limited := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		var call struct {
			ID     json.RawMessage `json:"id"`
			Method string          `json:"method"`
		}
		_ = json.NewDecoder(req.Body).Decode(&call)
		if call.Method == "eth_getCode" {
			fmt.Fprintf(w, `{"jsonrpc":"2.0","id":%s,"result":"0x"}`, call.ID)
			return
		}
		fmt.Fprintf(w, `{"jsonrpc":"2.0","id":%s,"error":{"code":-32005,"message":"rate limited"}}`, call.ID)
	}))
	t.Cleanup(limited.Close)
	busy, err := ethclient.Dial(limited.URL)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(busy.Close)
	s = find(e.anvil, e.anvil.Transfer(other, receive, "2000000"), e.chainID)
	if _, err := PlanRecovery(ctx, e.pool, e.client, busy, s, nil); err == nil || errors.Is(err, ErrCantReturn) {
		t.Fatalf("a rate-limited RPC: %v", err)
	}
	// The invoice's own token is its payment, never a stray.
	if strays, err := FindStrays(ctx, e.pool, clients, e.anvil.Transfer(e.token, receive, "1000000")); err != nil || len(strays) != 0 {
		t.Fatalf("a payment read as strays: %+v, %v", strays, err)
	}

	// The invoice's token on another chain with our factory: the same token and receive address there. The same
	// payer sends twice; returning the first can't return it again out of the second's money.
	usdc := withFactory.DeployToken()
	if usdc != e.token {
		t.Fatalf("the token there is %s, not the invoice's %s", usdc, e.token)
	}
	withFactory.Mint(usdc, "5000000")
	early := withFactory.Transfer(usdc, receive, "2000000")
	strays, err := FindStrays(ctx, e.pool, clients, early)
	if err != nil || len(strays) != 1 {
		t.Fatalf("strays %+v, %v", strays, err)
	}
	if _, err := plan(strays[0]); !errors.Is(err, ErrNotFinal) {
		t.Fatalf("a transfer not final yet: %v", err)
	}
	first := find(withFactory, early, 31338)
	if r, err = plan(first); err != nil || len(r.Warnings) != 0 {
		t.Fatalf("another chain: %+v, %v", r, err)
	}
	run(withFactory, first, r)
	second := find(withFactory, withFactory.Transfer(usdc, receive, "2000000"), 31338)
	if _, err := plan(first); !errors.Is(err, ErrRecoveryQueued) || held(first) != 2000000 {
		t.Fatalf("returned twice: %v, %d held", err, held(first))
	}
	if r, err = plan(second); err != nil {
		t.Fatal(err)
	}
	run(withFactory, second, r)
	// Both sent: the second's release must count the first's recover, sent before the second transfer.
	if _, err := ReleaseRecovery(ctx, e.pool, clients, second.TxHash); !errors.Is(err, ErrRecoverySent) {
		t.Fatalf("release of a sent recover: %v", err)
	}
	// One transaction with two such transfers, one recover sent to the payer: neither is released, since either may be
	// the sent one. Safe, though the other stays locked.
	if _, err := e.pool.Exec(ctx, `INSERT INTO stray_recoveries (chain_id, tx_hash, log_index, block_number, invoice_id,
		token_contract, destination, amount) SELECT chain_id, tx_hash, 99, block_number, invoice_id, token_contract,
		destination, amount FROM stray_recoveries WHERE tx_hash = $1`, second.TxHash); err != nil {
		t.Fatal(err)
	}
	if n, err := ReleaseRecovery(ctx, e.pool, clients, second.TxHash); n != 0 || !errors.Is(err, ErrRecoverySent) {
		t.Fatalf("release of one sent and one unsent: %d, %v", n, err)
	}
	// A mistaken release of a sent recover is refused: a recover to its destination is on chain since its transfer.
	// So a later recover waiting in the Safe can't be paid out a second time.
	withFactory.Mint(usdc, "6000000")
	sentOne := find(withFactory, withFactory.Transfer(usdc, receive, "3000000"), 31338)
	if r, err = plan(sentOne); err != nil {
		t.Fatal(err)
	}
	run(withFactory, sentOne, r)
	rejected := find(withFactory, withFactory.Transfer(usdc, receive, "3000000"), 31338)
	if _, err = plan(rejected); err != nil {
		t.Fatal(err)
	}
	if n, err := ReleaseRecovery(ctx, e.pool, clients, sentOne.TxHash); n != 0 || !errors.Is(err, ErrRecoverySent) {
		t.Fatalf("the mistaken release: %d, %v", n, err)
	}
	// The count starts at the first transfer of the key ever locked, released or not: with the sent lock marked
	// released by hand, the rejected one still can't look unsent.
	if _, err := e.pool.Exec(ctx, "UPDATE stray_recoveries SET released_at = now() WHERE tx_hash = $1", sentOne.TxHash); err != nil {
		t.Fatal(err)
	}
	if n, err := ReleaseRecovery(ctx, e.pool, clients, rejected.TxHash); n != 0 || !errors.Is(err, ErrRecoverySent) {
		t.Fatalf("release after a mistaken one: %d, %v", n, err)
	}

	// A chain without our factory, or with other code at its address: support says it can't be returned.
	lost := without.DeployToken()
	without.Mint(lost, "5000000")
	s = find(without, without.Transfer(lost, receive, "2000000"), 31339)
	for _, setup := range []func(){func() {}, func() {
		if err := without.RPC.Call(nil, "anvil_setCode", common.Address(address.Factory).Hex(), "0x6000"); err != nil {
			t.Fatal(err)
		}
	}} {
		setup()
		if _, err := plan(s); !errors.Is(err, ErrCantReturn) || !strings.Contains(err.Error(), "no Forwend factory") {
			t.Fatalf("not our factory: %v", err)
		}
	}
	if got := held(s); got != 2000000 {
		t.Fatalf("receive address on the chain without a factory holds %d", got)
	}
}
