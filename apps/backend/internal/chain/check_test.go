package chain

import (
	"context"
	"errors"
	"slices"
	"strings"
	"testing"

	"github.com/ensp1re/forwend/apps/backend/internal/chaintest"
	"github.com/ensp1re/forwend/apps/backend/internal/database"
	"github.com/ensp1re/forwend/apps/backend/internal/database/databasetest"
)

// The startup check passes an enabled chain whose primary and second answer from different hosts, then runs the
// further check on it. It stops on an enabled chain missing from the chain list, listing one host, or whose second
// host does not answer, naming the chain and how many hosts answered. A disabled chain is not checked.
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
	for name, tc := range map[string]struct {
		public []string
		want   string
	}{
		"working pair":     {public: []string{a.URL, localhost(a.URL)}},
		"not listed":       {want: "chain 31337 is enabled in the database but not in the chain list"},
		"one host":         {public: []string{a.URL}, want: "chain 31337 lists 1 RPC host(s)"},
		"second host down": {public: []string{a.URL, down.URL}, want: "chain 31337: 1 of 2 RPC hosts answered"},
	} {
		t.Run(name, func(t *testing.T) {
			specs := map[uint64]Spec{}
			if tc.public != nil {
				specs[chaintest.ChainID] = Spec{ChainID: chaintest.ChainID, Public: tc.public}
			}
			var checked []uint64
			err := CheckEnabled(ctx, db, specs, nil, 1000, func(_ context.Context, id uint64, _ RPCs) error {
				checked = append(checked, id)
				return nil
			})
			if tc.want == "" {
				if err != nil || !slices.Equal(checked, []uint64{chaintest.ChainID}) {
					t.Fatalf("got %v, checked %v; want the anvil chain checked", err, checked)
				}
				return
			}
			if err == nil || !strings.Contains(err.Error(), tc.want) || len(checked) != 0 {
				t.Fatalf("got %v, checked %v; want %q", err, checked, tc.want)
			}
			t.Log(err)
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
}
