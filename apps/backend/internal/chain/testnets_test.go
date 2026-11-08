package chain

import (
	"context"
	"slices"
	"testing"

	"github.com/forwend/forwend/apps/backend/internal/database"
	"github.com/forwend/forwend/apps/backend/internal/database/databasetest"
	"github.com/jackc/pgx/v5"
)

func TestEnableTestnetTokens(t *testing.T) {
	for _, existingBase := range []bool{false, true} {
		name := "missing Base"
		if existingBase {
			name = "existing disabled Base"
		}
		t.Run(name, func(t *testing.T) {
			ctx := context.Background()
			url := databasetest.Migrated(t, database.Migrate)
			db, err := database.Open(ctx, url)
			if err != nil {
				t.Fatal(err)
			}
			defer db.Close()
			if !existingBase {
				if _, err := db.Exec(ctx, `DELETE FROM rpc_endpoints WHERE chain_id=84532; DELETE FROM chains WHERE chain_id=84532`); err != nil {
					t.Fatal(err)
				}
			}
			if existingBase {
				if _, err := db.Exec(ctx, `
					INSERT INTO chains (chain_id, chain_family, name) VALUES (84532, 'evm', 'base-sepolia') ON CONFLICT (chain_id) DO NOTHING;
					INSERT INTO tokens (chain_id, chain_family, contract, symbol, decimals)
					VALUES (84532, 'evm', '0x036cbd53842c5426634e7929541ec2318f3dcf7e', 'USDC', 6);
					UPDATE chains SET enabled = true WHERE chain_id = 42431;
					UPDATE tokens SET enabled = true WHERE chain_id = 42431`); err != nil {
					t.Fatal(err)
				}
			}
			if _, err := db.Exec(ctx, `INSERT INTO tokens (chain_id, chain_family, contract, symbol, decimals)
				VALUES (5042002, 'evm', '0x0000000000000000000000000000000000000001', 'USDC', 6)`); err != nil {
				t.Fatal(err)
			}
			for range 2 {
				if err := EnableTestnetTokens(ctx, db); err != nil {
					t.Fatal(err)
				}
			}
			rows, err := db.Query(ctx, `SELECT t.chain_id, t.contract, t.symbol, t.decimals
				FROM tokens t JOIN chains c ON c.chain_id = t.chain_id
				WHERE t.enabled AND c.enabled AND t.symbol = 'USDC' ORDER BY t.chain_id, t.contract`)
			if err != nil {
				t.Fatal(err)
			}
			got, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (Asset, error) {
				var a Asset
				err := row.Scan(&a.ChainID, &a.Token, &a.Symbol, &a.Decimals)
				return a, err
			})
			want := []Asset{
				{84532, "0x036cbd53842c5426634e7929541ec2318f3dcf7e", "USDC", 6},
				{421614, "0x75faf114eafb1bdbe2f0316df893fd58ce46aa4d", "USDC", 6},
				{5042002, "0x3600000000000000000000000000000000000000", "USDC", 6},
			}
			if err != nil || !slices.Equal(got, want) {
				t.Fatalf("enabled assets: %v, %v; want %v", got, err, want)
			}
			var chainEnabled, tokenEnabled bool
			if err := db.QueryRow(ctx, `SELECT c.enabled, t.enabled FROM chains c
				JOIN tokens t ON t.chain_id = c.chain_id WHERE c.chain_id = 42431`).Scan(&chainEnabled, &tokenEnabled); err != nil || !chainEnabled || !tokenEnabled {
				t.Fatalf("Tempo settings: chain %v, token %v, %v; want %v", chainEnabled, tokenEnabled, err, true)
			}
		})
	}
}

// R-222: ENABLE_MAINNETS switches on the named live chains, and refuses a testnet or an unknown chain.
func TestEnableMainnets(t *testing.T) {
	ctx := context.Background()
	db, err := database.Open(ctx, databasetest.Migrated(t, database.Migrate))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if err := EnableMainnets(ctx, db, []uint64{8453, 4217}); err != nil {
		t.Fatal(err)
	}
	rows, err := db.Query(ctx, `SELECT chain_id FROM chains WHERE enabled AND livemode ORDER BY chain_id`)
	if err != nil {
		t.Fatal(err)
	}
	if on, err := pgx.CollectRows(rows, pgx.RowTo[int64]); err != nil || !slices.Equal(on, []int64{4217, 8453}) {
		t.Fatalf("live chains on: %v, %v; want Tempo and Base", on, err)
	}
	for _, id := range []uint64{84532, 1} {
		if err := EnableMainnets(ctx, db, []uint64{42161, id}); err == nil {
			t.Errorf("chain %d switched on as a mainnet", id)
		}
	}
	var arbitrum bool
	if err := db.QueryRow(ctx, `SELECT enabled FROM chains WHERE chain_id = 42161`).Scan(&arbitrum); err != nil || arbitrum {
		t.Fatalf("Arbitrum on after a refused list: %v, %v; want all or none", arbitrum, err)
	}
}
