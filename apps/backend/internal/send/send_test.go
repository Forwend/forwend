package send

import (
	"context"
	"errors"
	"math/big"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/ethereum/go-ethereum/ethclient"
	"github.com/forwend/forwend/apps/backend/internal/chaintest"
	"github.com/forwend/forwend/apps/backend/internal/database"
	"github.com/forwend/forwend/apps/backend/internal/database/databasetest"
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
	// The replaced send was signed in another tab after all: it still takes its own hash, so its money is followed.
	other := e.anvil.Transfer(e.token, outsider, "1000000")
	if got, err := e.sends.Submit(ctx, e.profile, first.ID, other); err != nil || got.Status != Submitted {
		t.Errorf("the replaced send's own hash = %v, %v", got.Status, err)
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
	hash := e.anvil.Transfer(e.token, outsider, "1")
	if _, err = e.sends.Submit(ctx, e.profile, s.ID, hash); err != nil {
		t.Fatal(err)
	}
	e.sends.now = func() time.Time { return time.Now().Add(receiptAfter) }
	if s, _ = e.sends.Get(ctx, e.profile, s.ID); s.Status != Failed || s.Failure == nil || *s.Failure != "reverted" {
		t.Errorf("status = %s failure %v, want failed reverted", s.Status, s.Failure)
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
