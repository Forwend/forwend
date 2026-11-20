package send

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"math/big"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/common/hexutil"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/forwend/forwend/apps/backend/internal/activity"
	"github.com/forwend/forwend/apps/backend/internal/chain"
	"github.com/forwend/forwend/apps/backend/internal/chaintest"
	"github.com/forwend/forwend/apps/backend/internal/search"
)

const collector = "0x00000000000000000000000000000000000000ee"

func (e env) paymaster(t *testing.T) {
	t.Helper()
	if _, err := e.pool.Exec(context.Background(), "UPDATE tokens SET native_gas = false, fee_asset = 'usdc'"); err != nil {
		t.Fatal(err)
	}
	chain.EthUSD[chaintest.ChainID] = chain.PriceFeed{Address: e.anvil.PriceFeed(big.NewInt(2000e8)), Heartbeat: time.Hour}
	t.Cleanup(func() { delete(chain.EthUSD, chaintest.ChainID) })
}

func (e env) relayTx(t *testing.T, amount, fee string, feeFirst bool) string {
	t.Helper()
	if feeFirst {
		return e.anvil.TwoTransfers(e.token, collector, fee, outsider, amount)
	}
	return e.anvil.TwoTransfers(e.token, outsider, amount, collector, fee)
}

func TestAPaymasterSendIsSignedByTheUserAndSentByTheServer(t *testing.T) {
	e := newEnv(t)
	ctx := context.Background()
	e.paymaster(t)
	fee, paymaster, err := e.sends.Fee(ctx, e.profile, chaintest.ChainID, e.token, outsider)
	if err != nil || !paymaster || fee.Sign() <= 0 {
		t.Fatalf("fee = %v, paymaster %v, %v; want a paymaster fee", fee, paymaster, err)
	}
	s, err := e.prepare(t, outsider, "", 3_000_000)
	if err != nil {
		t.Fatal(err)
	}
	if s.FeeAsset == nil || *s.FeeAsset != "usdc" || s.Gas != nil || s.NetworkFee.Sign() <= 0 {
		t.Fatalf("send fee asset %v gas %+v fee %v", s.FeeAsset, s.Gas, s.NetworkFee)
	}
	if _, err := e.prepare(t, outsider, "", 100_000_000); !errors.Is(err, ErrInvalid) {
		t.Errorf("the whole balance leaves no room for the fee: err = %v, want ErrInvalid", err)
	}
	s, err = e.prepare(t, outsider, "", 3_000_000)
	if err != nil {
		t.Fatal(err)
	}
	approved, err := e.sends.Approve(ctx, e.profile, s.ID)
	if err != nil || approved.Relay == nil {
		t.Fatalf("approve = %+v, %v; want a Privy request", approved.Relay, err)
	}
	if _, err := e.sends.Submit(ctx, e.profile, s.ID, "0x"+strings.Repeat("ab", 32)); !errors.Is(err, ErrInvalid) {
		t.Errorf("a browser hash on a paymaster send: err = %v, want ErrInvalid", err)
	}
	r := approved.Relay
	expiry := strconv.FormatInt(approved.ApprovedAt.Add(ApproveHold).UnixMilli(), 10)
	if r.URL != e.privy.URL+"/v1/wallets/w1/rpc" || r.Headers["privy-idempotency-key"] != s.ID ||
		r.Headers["privy-request-expiry"] != expiry || r.Headers["privy-app-id"] == "" {
		t.Errorf("request %s %v", r.URL, r.Headers)
	}
	var body struct {
		Method         string            `json:"method"`
		Caip2          string            `json:"caip2"`
		Sponsor        bool              `json:"sponsor"`
		SponsorOptions map[string]string `json:"sponsor_options"`
		Params         struct {
			Transaction map[string]string `json:"transaction"`
		} `json:"params"`
	}
	if err := json.Unmarshal(r.Body, &body); err != nil {
		t.Fatal(err)
	}
	transfer, err := chaintest.Calldata("transfer(address,uint256)", outsider, "3000000")
	if err != nil {
		t.Fatal(err)
	}
	tx := body.Params.Transaction
	if body.Method != "eth_sendTransaction" || body.Caip2 != "eip155:31337" || !body.Sponsor ||
		body.SponsorOptions["asset"] != "usdc" || tx["from"] != chaintest.Sender || tx["to"] != e.token ||
		tx["data"] != hexutil.Encode(transfer) || tx["value"] != "0x0" {
		t.Errorf("body %s", r.Body)
	}

	sent, err := e.sends.Relay(ctx, e.profile, s.ID, "sig-1")
	if err != nil || sent.Status != Submitted || sent.TxHash != nil || sent.RelayID == nil || *sent.RelayID != "tx-"+s.ID {
		t.Fatalf("relay = %s hash %v relay %v, %v", sent.Status, sent.TxHash, sent.RelayID, err)
	}
	if _, err := e.sends.Relay(ctx, e.profile, s.ID, "sig-1"); err != nil {
		t.Fatal(err)
	}
	if len(e.privy.RPCs) != 1 {
		t.Fatalf("%d requests to Privy, want 1", len(e.privy.RPCs))
	}
	got := e.privy.RPCs[0]
	if got.Path != "/v1/wallets/w1/rpc" || !bytes.Equal(got.Body, r.Body) ||
		got.Headers.Get("privy-authorization-signature") != "sig-1" ||
		got.Headers.Get("privy-idempotency-key") != s.ID || got.Headers.Get("privy-request-expiry") != expiry {
		t.Errorf("Privy got %s %s %v", got.Path, got.Body, got.Headers)
	}

	hash := e.relayTx(t, "3000000", "4000", true)
	if err := e.watch.Scan(ctx); err != nil {
		t.Fatal(err)
	}
	if s, _ = e.sends.Get(ctx, e.profile, s.ID); s.TxHash != nil {
		t.Fatalf("hash %v before Privy gave one", *s.TxHash)
	}
	e.privy.Hashes[*sent.RelayID] = hash
	if s, _ = e.sends.Get(ctx, e.profile, s.ID); s.TxHash == nil || *s.TxHash != hash {
		t.Fatalf("hash %v, want Privy's %s", s.TxHash, hash)
	}
	e.anvil.Mine(3)
	if err := e.watch.Scan(ctx); err != nil {
		t.Fatal(err)
	}
	if s, _ = e.sends.Get(ctx, e.profile, s.ID); s.Status != Sent || s.FeePaid == nil || s.FeePaid.Int64() != 4000 {
		t.Fatalf("send %s paid %v, want sent with 4000", s.Status, s.FeePaid)
	}
	page, err := activity.NewService(e.pool).Transfers(ctx, e.profile, "", 10, "", search.Query{})
	if err != nil {
		t.Fatal(err)
	}
	var outs int
	for _, tr := range page.Items {
		if tr.Direction != "out" {
			continue
		}
		outs++
		if tr.Counterparty != outsider || tr.FeePaid == nil || tr.FeePaid.Int64() != 4000 {
			t.Errorf("out transfer to %s fee %v; want the send to %s with fee 4000", tr.Counterparty, tr.FeePaid, outsider)
		}
	}
	if outs != 1 {
		t.Errorf("%d transfers out, want the send alone", outs)
	}
	var notices int
	if err := e.pool.QueryRow(ctx, "SELECT count(*) FROM outbox_events WHERE kind = 'wallet.outflow'").Scan(&notices); err != nil {
		t.Fatal(err)
	}
	if notices != 0 {
		t.Errorf("%d outflow notices for the owner's own send and its fee, want 0", notices)
	}
}

func TestATheftShapedLikeARelayedSendStillTellsTheOwner(t *testing.T) {
	e := newEnv(t)
	ctx := context.Background()
	e.paymaster(t)
	s, err := e.prepare(t, outsider, "", 3_000_000)
	if err != nil {
		t.Fatal(err)
	}
	e.approve(t, s)
	if s, err = e.sends.Relay(ctx, e.profile, s.ID, "sig"); err != nil {
		t.Fatal(err)
	}
	e.relayTx(t, "3000000", "90000000", false)
	e.anvil.Mine(3)
	if err := e.watch.Scan(ctx); err != nil {
		t.Fatal(err)
	}
	if got, _ := e.sends.Get(ctx, e.profile, s.ID); got.TxHash != nil {
		t.Errorf("the theft's transaction became the send's: %s", *got.TxHash)
	}
	var notices int
	if err := e.pool.QueryRow(ctx, `SELECT count(*) FROM outbox_events o JOIN wallet_transfers w ON w.id = o.wallet_transfer_id
		WHERE o.kind = 'wallet.outflow' AND w.counterparty = $1`, collector).Scan(&notices); err != nil {
		t.Fatal(err)
	}
	if notices != 1 {
		t.Errorf("%d notices for the money taken, want 1", notices)
	}
	page, err := activity.NewService(e.pool).Transfers(ctx, e.profile, "", 10, "", search.Query{})
	if err != nil {
		t.Fatal(err)
	}
	var shown bool
	for _, tr := range page.Items {
		shown = shown || tr.Counterparty == collector
	}
	if !shown {
		t.Error("Transactions hides the money taken")
	}
}

func TestAnOutflowTooBigForAFeeInPrivysTransactionTellsTheOwner(t *testing.T) {
	e := newEnv(t)
	ctx := context.Background()
	e.paymaster(t)
	s, err := e.prepare(t, outsider, "", 3_000_000)
	if err != nil {
		t.Fatal(err)
	}
	e.approve(t, s)
	if s, err = e.sends.Relay(ctx, e.profile, s.ID, "sig"); err != nil {
		t.Fatal(err)
	}
	taken := new(big.Int).Mul(s.NetworkFee, big.NewInt(chain.PaymasterFeeSlack+1))
	e.privy.Hashes[*s.RelayID] = e.relayTx(t, "3000000", taken.String(), false)
	e.anvil.Mine(3)
	if err := e.watch.Scan(ctx); err != nil {
		t.Fatal(err)
	}
	if got, _ := e.sends.Get(ctx, e.profile, s.ID); got.Status != Sent || got.FeePaid == nil || got.FeePaid.Sign() != 0 {
		t.Fatalf("send %s paid %v, want sent with no fee counted", got.Status, got.FeePaid)
	}
	var notices int
	if err := e.pool.QueryRow(ctx, `SELECT count(*) FROM outbox_events o JOIN wallet_transfers w ON w.id = o.wallet_transfer_id
		WHERE o.kind = 'wallet.outflow' AND w.counterparty = $1`, collector).Scan(&notices); err != nil {
		t.Fatal(err)
	}
	if notices != 1 {
		t.Errorf("%d notices for an outflow too big for a fee, want 1", notices)
	}
	page, err := activity.NewService(e.pool).Transfers(ctx, e.profile, "", 10, "", search.Query{})
	if err != nil {
		t.Fatal(err)
	}
	var shown bool
	for _, tr := range page.Items {
		shown = shown || tr.Counterparty == collector
	}
	if !shown {
		t.Error("Transactions hides an outflow too big for a fee")
	}
}

func TestPrivysAnswerCountsOnlyForItsSend(t *testing.T) {
	e := newEnv(t)
	ctx := context.Background()
	e.paymaster(t)
	relay := func() Send {
		t.Helper()
		s, err := e.prepare(t, outsider, "", 1_000_000)
		if err != nil {
			t.Fatal(err)
		}
		e.approve(t, s)
		if s, err = e.sends.Relay(ctx, e.profile, s.ID, "sig"); err != nil {
			t.Fatal(err)
		}
		return s
	}
	s := relay()
	other := "0x" + strings.Repeat("ab", 32)
	e.privy.Hashes[*s.RelayID] = other
	e.privy.Owners[*s.RelayID] = "another-wallet"
	if got, _ := e.sends.Get(ctx, e.profile, s.ID); got.TxHash != nil {
		t.Fatalf("took the hash of another wallet's transaction: %s", *got.TxHash)
	}
	delete(e.privy.Owners, *s.RelayID)
	e.privy.FailTransactions = true
	e.sends.now = func() time.Time { return time.Now().Add(DropAfter) }
	if got, _ := e.sends.Get(ctx, e.profile, s.ID); got.Status != Submitted {
		t.Fatalf("a send Privy can't be read for after DropAfter = %s, want still submitted", got.Status)
	}
	e.sends.now = func() time.Time { return time.Now().Add(RelayGiveUp) }
	if got, _ := e.sends.Get(ctx, e.profile, s.ID); got.Status != Failed || got.Failure == nil || *got.Failure != "dropped" {
		t.Fatalf("a send Privy can't be read for after RelayGiveUp = %s %v, want failed dropped", got.Status, got.Failure)
	}
	e.sends.now = time.Now
	e.privy.FailTransactions = false

	s = relay()
	e.privy.Hashes[*s.RelayID] = other
	if got, _ := e.sends.Get(ctx, e.profile, s.ID); got.TxHash == nil || *got.TxHash != other {
		t.Fatalf("hash %v, want Privy's first %s", got.TxHash, other)
	}
	mined := e.anvil.Transfer(e.token, outsider, "1000000")
	e.privy.Hashes[*s.RelayID] = mined
	e.anvil.Mine(3)
	if err := e.watch.Scan(ctx); err != nil {
		t.Fatal(err)
	}
	e.sends.now = func() time.Time { return time.Now().Add(DropAfter) }
	if got, _ := e.sends.Get(ctx, e.profile, s.ID); got.Status != Sent || got.TxHash == nil || *got.TxHash != mined {
		t.Errorf("a replaced relayed send = %s %v, want sent under %s", got.Status, got.TxHash, mined)
	}
}

func TestARelayAfterTheRequestExpiredIsRefused(t *testing.T) {
	e := newEnv(t)
	ctx := context.Background()
	e.paymaster(t)
	s, err := e.prepare(t, outsider, "", 1_000_000)
	if err != nil {
		t.Fatal(err)
	}
	e.approve(t, s)
	e.sends.now = func() time.Time { return time.Now().Add(ApproveHold) }
	if _, err := e.sends.Relay(ctx, e.profile, s.ID, "sig"); !errors.Is(err, ErrInvalid) {
		t.Errorf("relay past the request's expiry: err = %v, want ErrInvalid", err)
	}
	if len(e.privy.RPCs) != 0 {
		t.Errorf("%d requests reached Privy, want none", len(e.privy.RPCs))
	}
}

func TestPrivyTellsARelayedSendsHashOrFailure(t *testing.T) {
	e := newEnv(t)
	ctx := context.Background()
	e.paymaster(t)
	relay := func() Send {
		t.Helper()
		s, err := e.prepare(t, outsider, "", 1_000_000)
		if err != nil {
			t.Fatal(err)
		}
		e.approve(t, s)
		if s, err = e.sends.Relay(ctx, e.profile, s.ID, "sig"); err != nil {
			t.Fatal(err)
		}
		return s
	}
	lost := relay()
	e.privy.Statuses[*lost.RelayID] = "failed"
	if got, _ := e.sends.Get(ctx, e.profile, lost.ID); got.Status != Failed || got.Failure == nil || *got.Failure != "dropped" {
		t.Fatalf("a send Privy failed = %s %v, want failed dropped", got.Status, got.Failure)
	}
	late := e.anvil.Transfer(e.token, outsider, "1000000")
	e.privy.Hashes[*lost.RelayID] = late
	e.anvil.Mine(3)
	if err := e.watch.Scan(ctx); err != nil {
		t.Fatal(err)
	}
	if got, _ := e.sends.Get(ctx, e.profile, lost.ID); got.Status != Sent || got.TxHash == nil || *got.TxHash != late {
		t.Fatalf("a dropped send mined later = %s %v, want sent", got.Status, got.TxHash)
	}

	s := relay()
	hash := e.anvil.Transfer(e.token, outsider, "1000000")
	e.privy.Hashes[*s.RelayID] = hash
	if got, _ := e.sends.Get(ctx, e.profile, s.ID); got.TxHash == nil || *got.TxHash != hash {
		t.Fatalf("hash %v, want Privy's %s", got.TxHash, hash)
	}
	e.anvil.Mine(3)
	if err := e.watch.Scan(ctx); err != nil {
		t.Fatal(err)
	}
	if got, _ := e.sends.Get(ctx, e.profile, s.ID); got.Status != Sent || got.FeePaid == nil || got.FeePaid.Sign() != 0 {
		t.Errorf("send %s paid %v, want sent with nothing taken", got.Status, got.FeePaid)
	}
	waiting := relay()
	e.sends.now = func() time.Time { return time.Now().Add(DropAfter) }
	if got, _ := e.sends.Get(ctx, e.profile, waiting.ID); got.Status != Failed {
		t.Errorf("a relayed send Privy never sent after DropAfter = %s, want failed", got.Status)
	}
}

func TestPaymasterTookIsWhatElseLeftTheWallet(t *testing.T) {
	out := Send{From: chaintest.Sender, To: outsider, Token: "0x00000000000000000000000000000000000000ab",
		Amount: big.NewInt(3_000_000), NetworkFee: big.NewInt(4000)}
	log := func(token, from, to string, value int64) *types.Log {
		return &types.Log{Address: common.HexToAddress(token), Topics: []common.Hash{chain.TransferTopic,
			common.BytesToHash(common.HexToAddress(from).Bytes()), common.BytesToHash(common.HexToAddress(to).Bytes())},
			Data: common.LeftPadBytes(big.NewInt(value).Bytes(), 32)}
	}
	r := &types.Receipt{Status: types.ReceiptStatusSuccessful, Logs: []*types.Log{
		log(out.Token, out.From, out.To, 3_000_000),
		log(out.Token, out.From, collector, 5000),
		log(out.Token, collector, out.From, 1000),
		log(collector, out.From, collector, 7),
	}}
	if got := paymasterTook(r, out); got.Int64() != 4000 {
		t.Errorf("took %v, want 4000", got)
	}
	r.Logs = append(r.Logs, log(out.Token, out.From, "0x00000000000000000000000000000000000000dd", 8000))
	if got := paymasterTook(r, out); got.Sign() != 0 {
		t.Errorf("took %v from outflows above the bound together, want 0", got)
	}
	r.Logs = r.Logs[1:4]
	if got := paymasterTook(r, out); got.Sign() != 0 {
		t.Errorf("took %v from a transaction without the send, want 0", got)
	}
}
