package chain

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"testing"

	"github.com/forwend/forwend/apps/backend/internal/chaintest"
	"github.com/forwend/forwend/apps/backend/internal/database"
	"github.com/forwend/forwend/apps/backend/internal/database/databasetest"
)

// D-71: a mistake stops the process; a chain whose hosts don't answer is logged and skipped.
func TestCheckEnabled(t *testing.T) {
	ctx := context.Background()
	a := chaintest.Start(t)
	url := databasetest.New(t)
	if err := database.Migrate(ctx, url); err != nil {
		t.Fatal(err)
	}
	db, err := database.Open(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if _, err := db.Exec(ctx, `INSERT INTO chains (chain_id, chain_family, name, enabled)
		VALUES ($1, 'evm', 'anvil', true), (1, 'evm', 'off', false)`, chaintest.ChainID); err != nil {
		t.Fatal(err)
	}
	down := a.Proxy()
	down.Fail(func(chaintest.Call) chaintest.Fault { return chaintest.HTTP503 })
	pair := []string{a.URL, localhost(a.URL)}
	other := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"jsonrpc":"2.0","id":1,"result":"0x1"}`)) // chain 1
	}))
	defer other.Close()
	for name, tc := range map[string]struct {
		public  []string
		further error
		want    string // the error that stops the process; "" when it starts
		checked bool
	}{
		"working pair":     {public: pair, checked: true},
		"not listed":       {want: "chain 31337 is enabled in the database but not in the chain list"},
		"one host":         {public: []string{a.URL}, want: "chain 31337 lists 1 RPC host(s)"},
		"second host down": {public: []string{a.URL, down.URL}},
		"second host on another chain": {public: []string{a.URL, other.URL},
			want: "chain 31337: 1 of 2 RPC hosts answered"},
		"primary down, second host on another chain": {public: []string{down.URL, other.URL},
			want: "chain 31337: 0 of 2 RPC hosts answered"},
		"further check fails": {public: pair, checked: true, further: errors.New("chain 31337: no factory at 0x1"),
			want: "chain 31337: no factory at 0x1"},
	} {
		t.Run(name, func(t *testing.T) {
			specs := map[uint64]Spec{}
			if tc.public != nil {
				specs[chaintest.ChainID] = Spec{ChainID: chaintest.ChainID, Public: tc.public}
			}
			var checked []uint64
			err := CheckEnabled(ctx, db, specs, nil, 1000, func(_ context.Context, id uint64, _ RPCs) error {
				checked = append(checked, id)
				return tc.further
			})
			if tc.want == "" && err != nil || tc.want != "" && (err == nil || !strings.Contains(err.Error(), tc.want)) {
				t.Fatalf("got %v; want %q", err, tc.want)
			}
			if ran := slices.Equal(checked, []uint64{chaintest.ChainID}); ran != tc.checked {
				t.Fatalf("further check ran on %v; want it to run: %v", checked, tc.checked)
			}
		})
	}

	t.Run("a further check's error has no key", func(t *testing.T) {
		specs := map[uint64]Spec{chaintest.ChainID: {ChainID: chaintest.ChainID, Public: []string{a.URL, localhost(a.URL)}}}
		err := CheckEnabled(ctx, db, specs, nil, 1000, func(context.Context, uint64, RPCs) error {
			return errors.New(`Post "https://base-sepolia.infura.io/v3/SECRETKEY": context deadline exceeded`)
		})
		if err == nil || strings.Contains(err.Error(), "SECRETKEY") {
			t.Fatalf("got %v; want an error without the key", err)
		}
	})

	// Last: it enables a second chain. Chain 2 is checked first and skipped; the anvil chain is still checked after it.
	t.Run("an unreachable chain skips only itself", func(t *testing.T) {
		if _, err := db.Exec(ctx, "INSERT INTO chains (chain_id, chain_family, name, enabled) VALUES (2, 'evm', 'two', true)"); err != nil {
			t.Fatal(err)
		}
		specs := map[uint64]Spec{2: {ChainID: 2, Public: []string{down.URL, localhost(down.URL)}},
			chaintest.ChainID: {ChainID: chaintest.ChainID, Public: pair}}
		var checked []uint64
		err := CheckEnabled(ctx, db, specs, nil, 1000, func(_ context.Context, id uint64, _ RPCs) error {
			checked = append(checked, id)
			return nil
		})
		if err != nil || !slices.Equal(checked, []uint64{chaintest.ChainID}) {
			t.Fatalf("got %v, checked %v; want chain 2 skipped and the anvil chain checked", err, checked)
		}
	})
}
