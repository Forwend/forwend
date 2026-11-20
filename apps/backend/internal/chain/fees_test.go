package chain

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/ethereum/go-ethereum/ethclient"
	"github.com/forwend/forwend/apps/backend/internal/chaintest"
	"github.com/forwend/forwend/apps/backend/internal/database"
	"github.com/forwend/forwend/apps/backend/internal/database/databasetest"
	"github.com/jackc/pgx/v5"
)

func TestFeesNeverExceedTheChainCeiling(t *testing.T) {
	ctx := context.Background()
	a := chaintest.Start(t)
	greedy := a.Proxy()
	greedy.Stale(func(c chaintest.Call) json.RawMessage {
		if c.Method == "eth_maxPriorityFeePerGas" {
			return json.RawMessage(`"0x38d7ea4c68000"`) // 1,000,000 gwei
		}
		return nil
	})
	client, err := ethclient.Dial(greedy.URL)
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()
	tip, feeCap, err := Fees(ctx, client, chaintest.ChainID)
	ceiling := FeeCeiling(chaintest.ChainID)
	if err != nil || feeCap.Cmp(ceiling) != 0 || tip.Cmp(feeCap) > 0 {
		t.Fatalf("tip %v, fee cap %v (%v); want both at most the %v ceiling", tip, feeCap, err, ceiling)
	}
	if _, _, err := Fees(ctx, ethclient.NewClient(a.RPC), 999); err == nil || !strings.Contains(err.Error(), "no fee ceiling") {
		t.Fatalf("a chain without a ceiling: %v, want refused", err)
	}
}

func TestEveryChainHasAFeeCeiling(t *testing.T) {
	ctx := t.Context()
	pool, err := database.Open(ctx, databasetest.Migrated(t, database.Migrate))
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	rows, err := pool.Query(ctx, `SELECT chain_id FROM chains`)
	if err != nil {
		t.Fatal(err)
	}
	ids, err := pgx.CollectRows(rows, pgx.RowTo[int64])
	if err != nil {
		t.Fatal(err)
	}
	for _, id := range ids {
		if FeeCeiling(uint64(id)) == nil {
			t.Errorf("chain %d has no fee ceiling: switched on, it would not be served", id)
		}
	}
}
