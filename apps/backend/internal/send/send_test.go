package send

import (
	"context"
	"errors"
	"math/big"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/ethclient"
	"github.com/forwend/forwend/apps/backend/internal/activity"
	"github.com/forwend/forwend/apps/backend/internal/chain"
	"github.com/forwend/forwend/apps/backend/internal/chaintest"
	"github.com/forwend/forwend/apps/backend/internal/database"
	"github.com/forwend/forwend/apps/backend/internal/database/databasetest"
	"github.com/forwend/forwend/apps/backend/internal/search"
	"github.com/forwend/forwend/apps/backend/internal/watcher"
	"github.com/jackc/pgx/v5/pgxpool"
)

const outsider = "0x00000000000000000000000000000000000000cc"

type env struct {
	anvil    *chaintest.Anvil
	pool     *pgxpool.Pool
	sends    *Service
	token    string
	profile  string // Alice's personal profile; its wallet is Anvil's sender
	merchant string // Alice's merchant profile
	bob      string // Bob's profile
	watch    *watcher.Chain
}

// newEnv: Alice's wallet holds 100 tokens on a sponsored Anvil chain.
func newEnv(t *testing.T) env {
	t.Helper()
	ctx := context.Background()
	e := env{anvil: chaintest.Start(t)}
	e.token = e.anvil.DeployToken()
	pool, err := database.Open(ctx, databasetest.Migrated(t, database.Migrate))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	e.pool = pool
	err = pool.QueryRow(ctx, `
		WITH c AS (INSERT INTO chains (chain_id, chain_family, name, enabled, gas_sponsored)
		           VALUES ($1, 'evm', 'anvil', true, true)),
		     tk AS (INSERT INTO tokens (chain_id, chain_family, contract, symbol, decimals, enabled)
		            VALUES ($1, 'evm', $2, 'USDC', 6, true)),
		     a AS (INSERT INTO users (privy_user_id) VALUES ('did:privy:alice') RETURNING id),
		     b AS (INSERT INTO users (privy_user_id) VALUES ('did:privy:bob') RETURNING id),
		     ap AS (INSERT INTO profiles (user_id, kind) SELECT id, 'personal' FROM a RETURNING id),
		     am AS (INSERT INTO profiles (user_id, kind) SELECT id, 'merchant' FROM a RETURNING id),
		     bp AS (INSERT INTO profiles (user_id, kind) SELECT id, 'personal' FROM b RETURNING id),
		     w AS (INSERT INTO profile_wallets (profile_id, provider, provider_wallet_id, chain_family, address)
		           SELECT id, 'privy', 'w1', 'evm', $3 FROM ap
		           UNION ALL SELECT id, 'privy', 'w2', 'evm', '0x00000000000000000000000000000000000000aa' FROM am
		           UNION ALL SELECT id, 'privy', 'w3', 'evm', '0x00000000000000000000000000000000000000bb' FROM bp)
		SELECT (SELECT id::text FROM ap), (SELECT id::text FROM am), (SELECT id::text FROM bp)`,
		chaintest.ChainID, e.token, chaintest.Sender).Scan(&e.profile, &e.merchant, &e.bob)
	if err != nil {
		t.Fatal(err)
	}
	e.anvil.Mint(e.token, "100000000")
	client := ethclient.NewClient(e.anvil.RPC)
	e.sends = NewService(pool, func(uint64) (*ethclient.Client, error) { return client, nil })
	e.watch = watcher.NewChain(pool, chaintest.ChainID, e.anvil.RPC)
	if err := e.watch.Scan(ctx); err != nil {
		t.Fatal(err)
	}
	return e
}

func (e env) prepare(t *testing.T, to, toProfile string, amount int64) (Send, error) {
	t.Helper()
	return e.sends.Prepare(context.Background(), e.profile, Request{ChainID: chaintest.ChainID, Token: e.token, To: to,
		ToProfileID: toProfile, Amount: big.NewInt(amount)})
}

// approve stands in for the owner's hold on Send: the browser signs only an approved send.
func (e env) approve(t *testing.T, s Send) {
	t.Helper()
	if _, err := e.sends.Approve(context.Background(), e.profile, s.ID); err != nil {
		t.Fatal(err)
	}
}

func TestPrepareRefusesWhatWouldLoseMoney(t *testing.T) {
	e := newEnv(t)
	checksummed := "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed"
	for name, to := range map[string]string{
		"not an address":  "0x1234",
		"zero address":    "0x0000000000000000000000000000000000000000",
		"own wallet":      chaintest.Sender,
		"token contract":  e.token,
		"wrong checksum":  strings.Replace(checksummed, "aA", "Aa", 1),
		"no 0x prefix":    strings.TrimPrefix(outsider, "0x"),
		"other's profile": "", // with Bob's profile id below
	} {
		toProfile := ""
		if to == "" {
			toProfile = e.bob
		}
		if _, err := e.prepare(t, to, toProfile, 1_000_000); !errors.Is(err, ErrInvalid) {
			t.Errorf("%s: err = %v, want ErrInvalid", name, err)
		}
	}
	if _, err := e.prepare(t, checksummed, "", 1_000_000); err != nil {
		t.Errorf("a valid checksum: %v", err)
	}
	if _, err := e.prepare(t, outsider, "", 100_000_001); !errors.Is(err, ErrInvalid) {
		t.Errorf("more than the balance: err = %v, want ErrInvalid", err)
	}
	if _, err := e.pool.Exec(context.Background(), "UPDATE chains SET gas_sponsored = false"); err != nil {
		t.Fatal(err)
	}
	if _, err := e.prepare(t, outsider, "", 1_000_000); !errors.Is(err, ErrInvalid) {
		t.Errorf("unsponsored chain: err = %v, want ErrInvalid", err)
	}
}

func TestPrepareWarnsOfANewRecipientAndAContract(t *testing.T) {
	e := newEnv(t)
	s, err := e.prepare(t, outsider, "", 1_000_000)
	if err != nil {
		t.Fatal(err)
	}
	if want := []Warning{WarnNewRecipient}; !slices.Equal(s.Warnings, want) {
		t.Errorf("new address: warnings = %v, want %v", s.Warnings, want)
	}
	other := e.anvil.DeployToken() // any contract that isn't in tokens
	if s, err = e.prepare(t, other, "", 1_000_000); err != nil {
		t.Fatal(err)
	}
	if want := []Warning{WarnContract, WarnNewRecipient}; !slices.Equal(s.Warnings, want) {
		t.Errorf("contract: warnings = %v, want %v", s.Warnings, want)
	}
	// A wallet with an EIP-7702 delegation is a wallet, as a Privy-sponsored profile wallet is.
	delegated := "0x00000000000000000000000000000000000000dd"
	if err := e.anvil.RPC.Call(nil, "anvil_setCode", delegated, "0xef0100"+strings.Repeat("11", 20)); err != nil {
		t.Fatal(err)
	}
	if s, err = e.prepare(t, delegated, "", 1_000_000); err != nil {
		t.Fatal(err)
	}
	if want := []Warning{WarnNewRecipient}; !slices.Equal(s.Warnings, want) {
		t.Errorf("delegated wallet: warnings = %v, want %v", s.Warnings, want)
	}
	// Once the wallet has sent there, it's no longer new.
	e.anvil.Transfer(e.token, outsider, "1")
	if err := e.watch.Scan(context.Background()); err != nil {
		t.Fatal(err)
	}
	if s, err = e.prepare(t, outsider, "", 1_000_000); err != nil {
		t.Fatal(err)
	}
	if len(s.Warnings) != 0 {
		t.Errorf("known address: warnings = %v, want none", s.Warnings)
	}
}

func TestPrepareTransfersToTheOwnersOtherProfile(t *testing.T) {
	e := newEnv(t)
	s, err := e.prepare(t, "", e.merchant, 1_000_000)
	if err != nil {
		t.Fatal(err)
	}
	if s.To != "0x00000000000000000000000000000000000000aa" || s.ToProfileID == nil || *s.ToProfileID != e.merchant ||
		len(s.Warnings) != 0 {
		t.Errorf("transfer = to %s profile %v warnings %v", s.To, s.ToProfileID, s.Warnings)
	}
	// Its address pasted as an outside address is the same transfer.
	if s, err = e.prepare(t, "0x00000000000000000000000000000000000000AA", "", 1_000_000); err != nil {
		t.Fatal(err)
	}
	if s.ToProfileID == nil || *s.ToProfileID != e.merchant || len(s.Warnings) != 0 {
		t.Errorf("pasted own address = profile %v warnings %v", s.ToProfileID, s.Warnings)
	}
}

func TestPrepareRefusesWhenTheTokenRefuses(t *testing.T) {
	e := newEnv(t)
	// The token now reverts every call, as a paused token or a blocked address does.
	if err := e.anvil.RPC.Call(nil, "anvil_setCode", e.token, "0x60006000fd"); err != nil {
		t.Fatal(err)
	}
	if _, err := e.prepare(t, outsider, "", 1_000_000); !errors.Is(err, ErrRefused) {
		t.Errorf("err = %v, want ErrRefused", err)
	}
}

func TestOneOpenSendPerWalletAndChain(t *testing.T) {
	e := newEnv(t)
	ctx := context.Background()
	first, err := e.prepare(t, outsider, "", 1_000_000)
	if err != nil {
		t.Fatal(err)
	}
	second, err := e.prepare(t, outsider, "", 2_000_000)
	if err != nil {
		t.Fatal(err)
	}
	if got, _ := e.sends.Get(ctx, e.profile, first.ID); got.Status != Canceled {
		t.Errorf("the replaced unsigned send is %s, want canceled", got.Status)
	}
	e.approve(t, second)
	hash := e.anvil.Transfer(e.token, outsider, "2000000")
	if _, err := e.sends.Submit(ctx, e.profile, second.ID, hash); err != nil {
		t.Fatal(err)
	}
	if _, err := e.prepare(t, outsider, "", 1_000_000); !errors.Is(err, ErrBusy) {
		t.Errorf("while one is on its way: err = %v, want ErrBusy", err)
	}
	if _, err := e.sends.Submit(ctx, e.profile, first.ID, hash); !errors.Is(err, ErrInvalid) {
		t.Errorf("a second send takes the same hash: err = %v", err)
	}
	// The replaced send was never approved, so nothing signed it: it takes no hash, which could hide another transfer.
	if _, err := e.sends.Submit(ctx, e.profile, first.ID, "0x"+strings.Repeat("cd", 32)); !errors.Is(err, ErrInvalid) {
		t.Errorf("a send never approved takes a hash: err = %v", err)
	}
	if again, err := e.sends.Submit(ctx, e.profile, second.ID, hash); err != nil || again.Status != Submitted {
		t.Errorf("the same hash again = %v, %v", again.Status, err)
	}
	// Once it's final the wallet takes the next one.
	e.anvil.Mine(2)
	if err := e.watch.Scan(ctx); err != nil {
		t.Fatal(err)
	}
	if _, err := e.prepare(t, outsider, "", 1_000_000); err != nil {
		t.Errorf("after the first is sent: %v", err)
	}
}

func TestASendIsSentOnlyWhenTheChainShowsIt(t *testing.T) {
	e := newEnv(t)
	ctx := context.Background()
	s, err := e.prepare(t, outsider, "", 3_000_000)
	if err != nil {
		t.Fatal(err)
	}
	e.approve(t, s)
	hash := e.anvil.Transfer(e.token, outsider, "3000000")
	if s, err = e.sends.Submit(ctx, e.profile, s.ID, hash); err != nil || s.Status != Submitted || s.OnChain {
		t.Fatalf("submitted = %s on chain %v, %v", s.Status, s.OnChain, err)
	}
	// A receipt alone isn't the watcher's record.
	e.sends.now = func() time.Time { return time.Now().Add(receiptAfter) }
	if s, _ = e.sends.Get(ctx, e.profile, s.ID); s.Status != Submitted || s.OnChain {
		t.Errorf("mined, not recorded = %s on chain %v, want submitted", s.Status, s.OnChain)
	}
	if err := e.watch.Scan(ctx); err != nil {
		t.Fatal(err)
	}
	if s, _ = e.sends.Get(ctx, e.profile, s.ID); s.Status != Submitted || !s.OnChain {
		t.Errorf("in a block = %s on chain %v, want submitted on chain", s.Status, s.OnChain)
	}
	e.anvil.Mine(2)
	if err := e.watch.Scan(ctx); err != nil {
		t.Fatal(err)
	}
	if s, _ = e.sends.Get(ctx, e.profile, s.ID); s.Status != Sent {
		t.Errorf("final = %s, want sent", s.Status)
	}
}

func TestAReorgedSendWaitsAndIsDroppedIfNeverMinedAgain(t *testing.T) {
	e := newEnv(t)
	ctx := context.Background()
	s, err := e.prepare(t, outsider, "", 3_000_000)
	if err != nil {
		t.Fatal(err)
	}
	e.approve(t, s)
	hash := e.anvil.Transfer(e.token, outsider, "3000000")
	if _, err = e.sends.Submit(ctx, e.profile, s.ID, hash); err != nil {
		t.Fatal(err)
	}
	if err := e.watch.Scan(ctx); err != nil {
		t.Fatal(err)
	}
	if s, _ = e.sends.Get(ctx, e.profile, s.ID); !s.OnChain {
		t.Fatalf("before the reorg = %s on chain %v", s.Status, s.OnChain)
	}
	e.anvil.Reorg(1) // its block is replaced and its transaction dropped
	if err := e.watch.Scan(ctx); err != nil {
		t.Fatal(err)
	}
	e.sends.now = func() time.Time { return time.Now().Add(receiptAfter) }
	if s, _ = e.sends.Get(ctx, e.profile, s.ID); s.Status != Submitted || s.OnChain {
		t.Errorf("after the reorg = %s on chain %v, want submitted, waiting", s.Status, s.OnChain)
	}
	e.sends.now = func() time.Time { return time.Now().Add(DropAfter) }
	if s, _ = e.sends.Get(ctx, e.profile, s.ID); s.Status != Failed || *s.Failure != "dropped" {
		t.Errorf("never mined again = %s, want failed dropped", s.Status)
	}
}

func TestASendFailsWhenItsTransactionMovesSomethingElse(t *testing.T) {
	e := newEnv(t)
	ctx := context.Background()
	s, err := e.prepare(t, outsider, "", 3_000_000)
	if err != nil {
		t.Fatal(err)
	}
	// The reported hash is of a transaction without this transfer, as when the wallet's call inside it reverted.
	e.approve(t, s)
	hash := e.anvil.Transfer(e.token, outsider, "1")
	if _, err = e.sends.Submit(ctx, e.profile, s.ID, hash); err != nil {
		t.Fatal(err)
	}
	e.sends.now = func() time.Time { return time.Now().Add(receiptAfter) }
	if s, _ = e.sends.Get(ctx, e.profile, s.ID); s.Status != Failed || s.Failure == nil || *s.Failure != "reverted" {
		t.Errorf("status = %s failure %v, want failed reverted", s.Status, s.Failure)
	}
	if s.FeePaid == nil || s.FeePaid.Sign() != 0 {
		t.Errorf("a sponsored reverted send paid %v, want 0", s.FeePaid)
	}

	// A wallet-paid one still paid for its gas, and keeps that fee (R-224).
	if _, err := e.pool.Exec(ctx, "UPDATE chains SET gas_sponsored = false; UPDATE tokens SET native_gas = true"); err != nil {
		t.Fatal(err)
	}
	s, err = e.prepare(t, outsider, "", 3_000_000)
	if err != nil {
		t.Fatal(err)
	}
	e.approve(t, s)
	if _, err = e.sends.Submit(ctx, e.profile, s.ID, e.anvil.Transfer(e.token, outsider, "1")); err != nil {
		t.Fatal(err)
	}
	if s, _ = e.sends.Get(ctx, e.profile, s.ID); s.Status != Failed || s.FeePaid == nil || s.FeePaid.Sign() <= 0 {
		t.Errorf("a wallet-paid reverted send = %s, fee %v; want failed with its fee", s.Status, s.FeePaid)
	}
}

func TestUnreportedAndDroppedSendsAreGivenUp(t *testing.T) {
	e := newEnv(t)
	ctx := context.Background()
	unsigned, err := e.prepare(t, outsider, "", 1_000_000)
	if err != nil {
		t.Fatal(err)
	}
	e.sends.now = func() time.Time { return time.Now().Add(PrepareTTL) }
	if got, _ := e.sends.Get(ctx, e.profile, unsigned.ID); got.Status != Expired {
		t.Errorf("unreported = %s, want expired", got.Status)
	}
	e.sends.now = time.Now
	s, err := e.prepare(t, outsider, "", 1_000_000)
	if err != nil {
		t.Fatal(err)
	}
	e.approve(t, s)
	unknown := "0x" + strings.Repeat("ab", 32)
	if _, err = e.sends.Submit(ctx, e.profile, s.ID, unknown); err != nil {
		t.Fatal(err)
	}
	e.sends.now = func() time.Time { return time.Now().Add(receiptAfter) }
	if got, _ := e.sends.Get(ctx, e.profile, s.ID); got.Status != Submitted {
		t.Errorf("not on the chain yet = %s, want submitted", got.Status)
	}
	e.sends.now = func() time.Time { return time.Now().Add(DropAfter) }
	if got, _ := e.sends.Get(ctx, e.profile, s.ID); got.Status != Failed || *got.Failure != "dropped" {
		t.Errorf("never on the chain = %s, want failed dropped", got.Status)
	}
	// Another profile can't read it.
	if _, err := e.sends.Get(ctx, e.bob, s.ID); !errors.Is(err, ErrNotFound) {
		t.Errorf("Bob reads Alice's send: err = %v", err)
	}
}

func TestPendingListsSignedSendsUntilTheWatcherRecordsThem(t *testing.T) {
	e := newEnv(t)
	ctx := context.Background()
	unsigned, err := e.prepare(t, outsider, "", 1_000_000)
	if err != nil {
		t.Fatal(err)
	}
	if list, err := e.sends.Pending(ctx, e.profile); err != nil || len(list) != 0 {
		t.Fatalf("an unsigned send is pending: %v %v", list, err)
	}
	e.approve(t, unsigned)
	hash := e.anvil.Transfer(e.token, outsider, "1000000")
	if _, err := e.sends.Submit(ctx, e.profile, unsigned.ID, hash); err != nil {
		t.Fatal(err)
	}
	list, err := e.sends.Pending(ctx, e.profile)
	if err != nil || len(list) != 1 || list[0].ID != unsigned.ID {
		t.Fatalf("signed, not recorded = %v %v", list, err)
	}
	if other, _ := e.sends.Pending(ctx, e.bob); len(other) != 0 {
		t.Errorf("Bob sees Alice's send: %v", other)
	}
	if err := e.watch.Scan(ctx); err != nil {
		t.Fatal(err)
	}
	if list, _ = e.sends.Pending(ctx, e.profile); len(list) != 0 {
		t.Errorf("recorded by the watcher, still pending: %v", list)
	}
}

// R-216: where nobody sponsors gas and the token is the chain's gas coin (here Anvil's ether stands in for Arc's
// USDC), the wallet pays: the send carries the fee and the gas caps it was estimated at.
func TestAWalletPaysItsOwnGasWhereNotSponsored(t *testing.T) {
	e := newEnv(t)
	ctx := context.Background()
	if fee, err := e.sends.Fee(ctx, e.profile, chaintest.ChainID, e.token, ""); err != nil || fee.Sign() != 0 {
		t.Fatalf("sponsored fee = %v, %v, want 0", fee, err)
	}
	if _, err := e.pool.Exec(ctx, "UPDATE chains SET gas_sponsored = false"); err != nil {
		t.Fatal(err)
	}
	if _, err := e.prepare(t, outsider, "", 1_000_000); !errors.Is(err, ErrInvalid) {
		t.Errorf("gas in another coin: err = %v, want ErrInvalid", err)
	}
	if _, err := e.pool.Exec(ctx, "UPDATE tokens SET native_gas = true"); err != nil {
		t.Fatal(err)
	}
	fee, err := e.sends.Fee(ctx, e.profile, chaintest.ChainID, e.token, outsider)
	if err != nil || fee.Sign() <= 0 {
		t.Fatalf("self-paid fee = %v, %v", fee, err)
	}
	s, err := e.prepare(t, outsider, "", 1_000_000)
	if err != nil {
		t.Fatal(err)
	}
	if s.Gas == nil || s.Gas.Limit < 21_000 || s.NetworkFee.Sign() <= 0 ||
		new(big.Int).Mul(new(big.Int).SetUint64(s.Gas.Limit), s.Gas.MaxFeePerGas).Cmp(
			new(big.Int).Mul(s.NetworkFee, big.NewInt(1e12))) > 0 {
		t.Fatalf("gas %+v fee %v: the caps must cost at most the fee", s.Gas, s.NetworkFee)
	}
	if got, _ := e.sends.Get(ctx, e.profile, s.ID); got.Gas == nil || got.Gas.Limit != s.Gas.Limit ||
		got.NetworkFee.Cmp(s.NetworkFee) != 0 {
		t.Errorf("kept gas %+v fee %v, want %+v %v", got.Gas, got.NetworkFee, s.Gas, s.NetworkFee)
	}
	// The amount alone fits the gas coin, but not with the fee.
	if err := e.anvil.RPC.Call(nil, "anvil_setBalance", chaintest.Sender, "0xDE0B6B3A7640000"); err != nil { // 1 ether
		t.Fatal(err)
	}
	if _, err := e.prepare(t, outsider, "", 1_000_000); !errors.Is(err, ErrInvalid) {
		t.Errorf("amount plus fee above the balance: err = %v, want ErrInvalid", err)
	}
}

// R-216: Max sends the balance less the fee shown, so that fee covers the gas of any amount the wallet holds.
func TestMaxFitsTheFeeShown(t *testing.T) {
	e := newEnv(t)
	ctx := context.Background()
	if _, err := e.pool.Exec(ctx, "UPDATE chains SET gas_sponsored = false"); err != nil {
		t.Fatal(err)
	}
	if _, err := e.pool.Exec(ctx, "UPDATE tokens SET native_gas = true"); err != nil {
		t.Fatal(err)
	}
	// A busy chain makes each calldata byte dear; the gas coin is exactly the 100 tokens held, as on Arc.
	for _, call := range [][]any{{"anvil_setNextBlockBaseFeePerGas", "0x2E90EDD000"}, {"evm_mine"},
		{"anvil_setBalance", chaintest.Sender, "0x56BC75E2D63100000"}} {
		if err := e.anvil.RPC.Call(nil, call[0].(string), call[1:]...); err != nil {
			t.Fatal(err)
		}
	}
	fee, err := e.sends.Fee(ctx, e.profile, chaintest.ChainID, e.token, outsider)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := e.prepare(t, outsider, "", 100_000_000-fee.Int64()); err != nil {
		t.Errorf("Max (100 tokens less the fee %v): %v", fee, err)
	}
}

// R-211: a summary is signed at most once. When the browser loses the answer of a signature that went out, a second
// approve is refused and the wallet waits until the watcher finds the transfer, which becomes the send's hash, so the
// owner can't send the same money twice. With no transfer, the approval ends after ApproveHold.
func TestAnApprovedSendIsSignedOnceAndAnUnreportedOneIsFound(t *testing.T) {
	e := newEnv(t)
	ctx := context.Background()
	s, err := e.prepare(t, outsider, "", 2_000_000)
	if err != nil {
		t.Fatal(err)
	}
	if s, err = e.sends.Approve(ctx, e.profile, s.ID); err != nil || s.Status != Approved {
		t.Fatalf("approve = %s, %v", s.Status, err)
	}
	if _, err := e.sends.Approve(ctx, e.profile, s.ID); !errors.Is(err, ErrApproved) {
		t.Errorf("a second approve: err = %v, want ErrApproved", err)
	}
	// Signed, but the browser never got the hash back.
	hash := e.anvil.Transfer(e.token, outsider, "2000000")
	if _, err := e.prepare(t, outsider, "", 2_000_000); !errors.Is(err, ErrBusy) {
		t.Errorf("a new send while the approved one may be on its way: err = %v, want ErrBusy", err)
	}
	// Mined, but the watcher hasn't read it: the hold lasts until it has read the chain past the hold.
	e.sends.now = func() time.Time { return time.Now().Add(ApproveHold) }
	if got, _ := e.sends.Get(ctx, e.profile, s.ID); got.Status != Approved {
		t.Errorf("mined, not read by the watcher after the hold = %s, want approved", got.Status)
	}
	e.sends.now = time.Now
	if err := e.watch.Scan(ctx); err != nil {
		t.Fatal(err)
	}
	got, err := e.sends.Get(ctx, e.profile, s.ID)
	if err != nil || got.Status != Submitted || got.TxHash == nil || *got.TxHash != strings.ToLower(hash) {
		t.Errorf("the watcher's transfer = %s %v, %v; want submitted with %s", got.Status, got.TxHash, err, hash)
	}

	e.anvil.Mine(2)
	if err := e.watch.Scan(ctx); err != nil {
		t.Fatal(err)
	}
	other, err := e.prepare(t, outsider, "", 1_000_000)
	if err != nil {
		t.Fatal(err)
	}
	if other, err = e.sends.Approve(ctx, e.profile, other.ID); err != nil {
		t.Fatal(err)
	}
	e.anvil.Wait(int64(ApproveHold.Seconds()))
	e.anvil.Mine(1)
	if err := e.watch.Scan(ctx); err != nil {
		t.Fatal(err)
	}
	e.sends.now = func() time.Time { return time.Now().Add(ApproveHold) }
	if got, _ := e.sends.Get(ctx, e.profile, other.ID); got.Status != Expired {
		t.Errorf("approved, never signed = %s, want expired after the hold", got.Status)
	}
	if _, err := e.prepare(t, outsider, "", 1_000_000); err != nil {
		t.Errorf("after the hold: %v", err)
	}
}

// R-211: an approved send whose signature still waits in the mempool holds the wallet past ApproveHold, so a new send
// can't be signed behind it; once mined, its transfer becomes its hash.
func TestAnApprovedSendStillWaitingHoldsTheWallet(t *testing.T) {
	e := newEnv(t)
	ctx := context.Background()
	s, err := e.prepare(t, outsider, "", 2_000_000)
	if err != nil {
		t.Fatal(err)
	}
	e.approve(t, s)
	hash := e.anvil.Transfer(e.token, outsider, "2000000")
	raw := e.anvil.RawTx(hash)
	e.anvil.Reorg(1) // the transaction leaves the chain and the mempool
	// The watcher has read the chain past the hold, so only the waiting transaction holds the wallet.
	e.anvil.Wait(int64(ApproveHold.Seconds()))
	e.anvil.Mine(1)
	if err := e.watch.Scan(ctx); err != nil {
		t.Fatal(err)
	}
	if err := e.anvil.RPC.Call(nil, "evm_setAutomine", false); err != nil {
		t.Fatal(err)
	}
	var sent string
	if err := e.anvil.RPC.Call(&sent, "eth_sendRawTransaction", raw); err != nil {
		t.Fatal(err)
	}
	e.sends.now = func() time.Time { return time.Now().Add(ApproveHold) }
	if got, _ := e.sends.Get(ctx, e.profile, s.ID); got.Status != Approved {
		t.Errorf("signed, waiting, answer lost = %s after the hold, want approved", got.Status)
	}
	if _, err := e.prepare(t, outsider, "", 1_000_000); !errors.Is(err, ErrBusy) {
		t.Errorf("a new send while the signature waits: err = %v, want ErrBusy", err)
	}
	e.anvil.Mine(1)
	if err := e.watch.Scan(ctx); err != nil {
		t.Fatal(err)
	}
	if got, _ := e.sends.Get(ctx, e.profile, s.ID); got.Status != Submitted || got.TxHash == nil ||
		*got.TxHash != strings.ToLower(hash) {
		t.Errorf("once mined = %s %v, want submitted with %s", got.Status, got.TxHash, hash)
	}
}

// R-212: a transaction still waiting in the mempool after DropAfter is not given up, and one given up as dropped that
// is mined after all becomes sent once the watcher records it.
func TestAWaitingSendIsNotDroppedAndADroppedOneMinedLaterIsSent(t *testing.T) {
	e := newEnv(t)
	ctx := context.Background()
	s, err := e.prepare(t, outsider, "", 3_000_000)
	if err != nil {
		t.Fatal(err)
	}
	e.approve(t, s)
	hash := e.anvil.Transfer(e.token, outsider, "3000000")
	raw := e.anvil.RawTx(hash)
	e.anvil.Reorg(1) // the transaction leaves the chain and the mempool
	if _, err = e.sends.Submit(ctx, e.profile, s.ID, hash); err != nil {
		t.Fatal(err)
	}
	// Back in the mempool, waiting: no block takes it.
	if err := e.anvil.RPC.Call(nil, "evm_setAutomine", false); err != nil {
		t.Fatal(err)
	}
	var sent string
	if err := e.anvil.RPC.Call(&sent, "eth_sendRawTransaction", raw); err != nil {
		t.Fatal(err)
	}
	e.sends.now = func() time.Time { return time.Now().Add(DropAfter) }
	if got, _ := e.sends.Get(ctx, e.profile, s.ID); got.Status != Submitted {
		t.Errorf("waiting in the mempool after DropAfter = %s, want submitted", got.Status)
	}

	// The node forgets it, so it is given up; then it is mined after all.
	e.sends.now = time.Now
	if err := e.anvil.RPC.Call(nil, "anvil_dropTransaction", hash); err != nil {
		t.Fatal(err)
	}
	e.sends.now = func() time.Time { return time.Now().Add(DropAfter) }
	if got, _ := e.sends.Get(ctx, e.profile, s.ID); got.Status != Failed {
		t.Fatalf("forgotten by the node = %s, want failed dropped", got.Status)
	}
	if err := e.anvil.RPC.Call(nil, "evm_setAutomine", true); err != nil {
		t.Fatal(err)
	}
	e.anvil.SendRaw(raw)
	e.anvil.Mine(2)
	if err := e.watch.Scan(ctx); err != nil {
		t.Fatal(err)
	}
	if got, _ := e.sends.Get(ctx, e.profile, s.ID); got.Status != Sent || got.Failure != nil {
		t.Errorf("mined after it was given up = %s %v, want sent", got.Status, got.Failure)
	}
}

// D-49: money that leaves a profile wallet without a send its owner approved in Forwend tells the owner, once it is
// final: a stolen session can sign through Privy without Forwend's screens. Reporting the theft's hash on a send never
// approved, or on one for another amount, hides nothing; the owner's own approved send tells nobody.
func TestMoneyLeavingAWalletWithoutASendTellsItsOwner(t *testing.T) {
	e := newEnv(t)
	ctx := context.Background()
	outflows := func() int {
		t.Helper()
		var n int
		if err := e.pool.QueryRow(ctx, "SELECT count(*) FROM outbox_events WHERE kind = 'wallet.outflow'").Scan(&n); err != nil {
			t.Fatal(err)
		}
		return n
	}
	small, err := e.prepare(t, outsider, "", 1_000_000)
	if err != nil {
		t.Fatal(err)
	}
	theft := e.anvil.Transfer(e.token, outsider, "2000000") // signed through Privy, never through Forwend
	if _, err := e.sends.Submit(ctx, e.profile, small.ID, theft); !errors.Is(err, ErrInvalid) {
		t.Errorf("a send never approved takes the theft's hash: err = %v", err)
	}
	e.approve(t, small)
	if _, err := e.sends.Submit(ctx, e.profile, small.ID, theft); err != nil {
		t.Fatal(err)
	}
	if err := e.watch.Scan(ctx); err != nil {
		t.Fatal(err)
	}
	if n := outflows(); n != 0 {
		t.Fatalf("before the transfer is final: %d notices", n)
	}
	e.anvil.Mine(2)
	if err := e.watch.Scan(ctx); err != nil {
		t.Fatal(err)
	}
	if n := outflows(); n != 1 {
		t.Errorf("a transfer whose hash an approved send of another amount claims: %d notices, want 1", n)
	}
	// Its receipt holds no transfer of its amount, so it fails and frees the wallet.
	e.sends.now = func() time.Time { return time.Now().Add(receiptAfter) }
	if got, _ := e.sends.Get(ctx, e.profile, small.ID); got.Status != Failed {
		t.Fatalf("the send that claimed the theft = %s, want failed", got.Status)
	}
	e.sends.now = time.Now

	s, err := e.prepare(t, outsider, "", 1_000_000)
	if err != nil {
		t.Fatal(err)
	}
	e.approve(t, s)
	hash := e.anvil.Transfer(e.token, outsider, "1000000")
	if _, err := e.sends.Submit(ctx, e.profile, s.ID, hash); err != nil {
		t.Fatal(err)
	}
	e.anvil.Mine(2)
	if err := e.watch.Scan(ctx); err != nil {
		t.Fatal(err)
	}
	if n := outflows(); n != 1 {
		t.Errorf("after the owner's approved send: %d notices, want still 1", n)
	}

	// Signed after its approval ended, and the answer lost: still the owner's send.
	late, err := e.prepare(t, outsider, "", 1_000_000)
	if err != nil {
		t.Fatal(err)
	}
	e.approve(t, late)
	e.anvil.Wait(int64(ApproveHold.Seconds()))
	e.anvil.Mine(1)
	if err := e.watch.Scan(ctx); err != nil {
		t.Fatal(err)
	}
	e.sends.now = func() time.Time { return time.Now().Add(ApproveHold) }
	if got, _ := e.sends.Get(ctx, e.profile, late.ID); got.Status != Expired {
		t.Fatalf("approved, unsigned after the hold = %s, want expired", got.Status)
	}
	e.sends.now = time.Now
	e.anvil.Transfer(e.token, outsider, "1000000")
	e.anvil.Mine(2)
	if err := e.watch.Scan(ctx); err != nil {
		t.Fatal(err)
	}
	if n := outflows(); n != 1 {
		t.Errorf("after a send signed once its approval ended: %d notices, want still 1", n)
	}
	// An approval that ended long ago explains nothing.
	if _, err := e.pool.Exec(ctx, `UPDATE sends SET approved_at = approved_at - interval '2 hours',
		finished_at = finished_at - interval '2 hours' WHERE id = $1`, late.ID); err != nil {
		t.Fatal(err)
	}
	e.anvil.Transfer(e.token, outsider, "1000000")
	e.anvil.Mine(2)
	if err := e.watch.Scan(ctx); err != nil {
		t.Fatal(err)
	}
	if n := outflows(); n != 2 {
		t.Errorf("a transfer matching an approval that ended 2 hours ago: %d notices, want 2", n)
	}
}

// R-224: a sent send keeps what its wallet really paid for gas, from the receipt; 0 where Forwend pays.
func TestASentSendRecordsTheFeeItsWalletPaid(t *testing.T) {
	e := newEnv(t)
	ctx := context.Background()
	sent := func(amount string) Send {
		t.Helper()
		s, err := e.prepare(t, outsider, "", 1_000_000)
		if err != nil {
			t.Fatal(err)
		}
		e.approve(t, s)
		hash := e.anvil.Transfer(e.token, outsider, amount)
		if _, err := e.sends.Submit(ctx, e.profile, s.ID, hash); err != nil {
			t.Fatal(err)
		}
		e.anvil.Mine(3)
		if err := e.watch.Scan(ctx); err != nil {
			t.Fatal(err)
		}
		got, err := e.sends.Get(ctx, e.profile, s.ID)
		if err != nil || got.Status != Sent {
			t.Fatalf("send %s, %v; want sent", got.Status, err)
		}
		return got
	}
	if s := sent("1000000"); s.FeePaid == nil || s.FeePaid.Sign() != 0 {
		t.Errorf("sponsored send paid %v, want 0", s.FeePaid)
	}
	if _, err := e.pool.Exec(ctx, "UPDATE chains SET gas_sponsored = false; UPDATE tokens SET native_gas = true"); err != nil {
		t.Fatal(err)
	}
	s := sent("1000000")
	receipt, err := ethclient.NewClient(e.anvil.RPC).TransactionReceipt(ctx, common.HexToHash(*s.TxHash))
	if err != nil {
		t.Fatal(err)
	}
	wei := new(big.Int).Mul(receipt.EffectiveGasPrice, new(big.Int).SetUint64(receipt.GasUsed))
	want := new(big.Int).Div(new(big.Int).Add(wei, big.NewInt(1e12-1)), big.NewInt(1e12))
	if s.FeePaid == nil || s.FeePaid.Cmp(want) != 0 || s.FeePaid.Cmp(s.NetworkFee) > 0 {
		t.Errorf("wallet-paid send paid %v, want %v (at most the %v shown)", s.FeePaid, want, s.NetworkFee)
	}
	// Its transfer carries the fee in Transactions; an incoming transfer carries none.
	page, err := activity.NewService(e.pool).Transfers(ctx, e.profile, "", 10, "", search.Query{})
	if err != nil {
		t.Fatal(err)
	}
	for _, tr := range page.Items {
		switch {
		case tr.TxHash == *s.TxHash && (tr.FeePaid == nil || tr.FeePaid.Cmp(want) != 0):
			t.Errorf("the send's transfer shows fee %v, want %v", tr.FeePaid, want)
		case tr.Direction == "in" && tr.FeePaid != nil:
			t.Errorf("an incoming transfer shows fee %v", tr.FeePaid)
		}
	}
}

// R-224: on Tempo, where the fee manager exists, a wallet pays a send's fee in the token it sends: its native balance is
// a placeholder, and a wallet that chose another fee token can't send.
func TestATempoWalletPaysItsFeeInTheTokenItSends(t *testing.T) {
	e := newEnv(t)
	ctx := context.Background()
	if _, err := e.pool.Exec(ctx, "UPDATE chains SET gas_sponsored = false; UPDATE tokens SET native_gas = true"); err != nil {
		t.Fatal(err)
	}
	// userTokens(address) answers this word whatever the account.
	feeManager := func(word string) {
		t.Helper()
		if err := e.anvil.RPC.Call(nil, "anvil_setCode", chain.TempoFeeManager.Hex(), "0x7f"+word+"60005260206000f3"); err != nil {
			t.Fatal(err)
		}
	}
	feeManager(strings.Repeat("00", 32))
	// No gas coin at all: only the token can pay.
	if err := e.anvil.RPC.Call(nil, "anvil_setBalance", chaintest.Sender, "0x0"); err != nil {
		t.Fatal(err)
	}
	s, err := e.prepare(t, outsider, "", 1_000_000)
	if err != nil || s.Gas == nil || s.NetworkFee.Sign() <= 0 {
		t.Fatalf("a Tempo send without a gas coin: %+v, %v", s, err)
	}
	if err := e.sends.Cancel(ctx, e.profile, s.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := e.prepare(t, outsider, "", 100_000_000); !errors.Is(err, ErrInvalid) {
		t.Errorf("all the tokens plus the fee: err = %v, want ErrInvalid", err)
	}
	feeManager(strings.Repeat("00", 12) + strings.Repeat("ab", 20))
	if _, err := e.prepare(t, outsider, "", 1_000_000); !errors.Is(err, ErrInvalid) {
		t.Errorf("a wallet paying fees in another token: err = %v, want ErrInvalid", err)
	}
}

// R-224, D-49: a Tempo wallet's fee leaves as a Transfer to the fee manager in its send's own transaction. Only that,
// within the fee the send was signed for, is the send's fee and not money sent. The fee manager also swaps and takes
// liquidity, so any other transfer to it, or a larger one in the send's transaction, shows in Transactions and tells
// the owner. The fee manager is refused as a send's recipient, since the send would never end.
func TestOnlyASendsOwnTempoFeeIsNotMoneySent(t *testing.T) {
	e := newEnv(t)
	ctx := context.Background()
	if _, err := e.pool.Exec(ctx, "UPDATE chains SET gas_sponsored = false; UPDATE tokens SET native_gas = true"); err != nil {
		t.Fatal(err)
	}
	feeManager := strings.ToLower(chain.TempoFeeManager.Hex())
	// send moves 1 token to outsider and, in the same transaction, the send's quoted fee plus extra to the fee manager.
	send := func(extra int64) Send {
		t.Helper()
		s, err := e.prepare(t, outsider, "", 1_000_000)
		if err != nil {
			t.Fatal(err)
		}
		e.approve(t, s)
		taken := new(big.Int).Add(s.NetworkFee, big.NewInt(extra))
		hash := e.anvil.TwoTransfers(e.token, outsider, "1000000", feeManager, taken.String())
		if _, err := e.sends.Submit(ctx, e.profile, s.ID, hash); err != nil {
			t.Fatal(err)
		}
		e.anvil.Mine(3)
		if err := e.watch.Scan(ctx); err != nil {
			t.Fatal(err)
		}
		if s, err = e.sends.Get(ctx, e.profile, s.ID); err != nil || s.Status != Sent {
			t.Fatalf("send %s, %v; want sent", s.Status, err)
		}
		return s
	}
	notices := func() int {
		t.Helper()
		var n int
		if err := e.pool.QueryRow(ctx, `SELECT count(*) FROM outbox_events o JOIN wallet_transfers w ON w.id = o.wallet_transfer_id
			WHERE o.kind = 'wallet.outflow' AND w.counterparty = $1`, feeManager).Scan(&n); err != nil {
			t.Fatal(err)
		}
		return n
	}
	shown := func() int {
		t.Helper()
		page, err := activity.NewService(e.pool).Transfers(ctx, e.profile, "", 20, "", search.Query{})
		if err != nil {
			t.Fatal(err)
		}
		n := 0
		for _, tr := range page.Items {
			if tr.Counterparty == feeManager {
				n++
			}
		}
		return n
	}
	send(0)
	if n, m := notices(), shown(); n != 0 || m != 0 {
		t.Fatalf("the send's own fee: %d notices, %d rows; want none", n, m)
	}
	// A swap through the fee manager, outside any send: money out.
	e.anvil.Transfer(e.token, feeManager, "3")
	e.anvil.Mine(3)
	if err := e.watch.Scan(ctx); err != nil {
		t.Fatal(err)
	}
	if n, m := notices(), shown(); n != 1 || m != 1 {
		t.Fatalf("a transfer to the fee manager outside a send: %d notices, %d rows; want 1 and 1", n, m)
	}
	// More than the send was signed for, in its own transaction: money out too.
	send(1)
	if n, m := notices(), shown(); n != 2 || m != 2 {
		t.Fatalf("one unit over the signed fee in a send's transaction: %d notices, %d rows; want 2 and 2", n, m)
	}
	// A TIP-20 token's transfer to the fee manager outside a send, as a swap through its Fee AMM: money out as well.
	const tip20 = "0x20c0000000000000000000000000000000000077" // the test token's code there stands in for OUSD
	var code string
	if err := e.anvil.RPC.Call(&code, "eth_getCode", e.token, "latest"); err != nil {
		t.Fatal(err)
	}
	if err := e.anvil.RPC.Call(nil, "anvil_setCode", tip20, code); err != nil {
		t.Fatal(err)
	}
	if _, err := e.pool.Exec(ctx, `INSERT INTO tokens (chain_id, chain_family, contract, symbol, decimals, enabled)
		VALUES ($1, 'evm', $2, 'OUSD', 6, true)`, chaintest.ChainID, tip20); err != nil {
		t.Fatal(err)
	}
	e.watch = watcher.NewChain(e.pool, chaintest.ChainID, e.anvil.RPC) // reads the token list anew
	e.anvil.Mint(tip20, "100")
	e.anvil.Transfer(tip20, feeManager, "27")
	e.anvil.Mine(3)
	if err := e.watch.Scan(ctx); err != nil {
		t.Fatal(err)
	}
	if n := notices(); n != 3 {
		t.Errorf("a TIP-20 transfer to the fee manager outside a send: %d notices in all, want 3", n)
	}
	if _, err := e.prepare(t, chain.TempoFeeManager.Hex(), "", 1_000_000); !errors.Is(err, ErrInvalid) {
		t.Errorf("a send to the fee manager: err = %v, want ErrInvalid", err)
	}
}
