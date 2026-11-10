package main

import (
	"context"
	"fmt"
	"io"
	"math/big"
	"os/user"
	"strings"
	"testing"

	"github.com/ethereum/go-ethereum/common"
	"github.com/forwend/forwend/apps/backend/internal/database"
	"github.com/forwend/forwend/apps/backend/internal/database/databasetest"
	"github.com/forwend/forwend/apps/backend/internal/settlement"
)

// Every run names who ran it before it changes anything, a failing one too.
func TestEveryRunRecordsItsOperator(t *testing.T) {
	ctx := context.Background()
	url := databasetest.Migrated(t, database.Migrate)
	t.Setenv("DATABASE_URL", url)
	t.Setenv("POLL_INTERVAL", "1s")
	t.Setenv("RPC_RATE_PER_SECOND", "10")
	who, err := user.Current()
	if err != nil {
		t.Fatal(err)
	}
	args := []string{"release", "0x" + strings.Repeat("ab", 32)}
	if err := run(ctx, args, io.Discard); err == nil {
		t.Fatal("released a transaction no case has")
	}
	pool, err := database.Open(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	var operator string
	var got []string
	if err := pool.QueryRow(ctx, "SELECT operator, args FROM ops_runs").Scan(&operator, &got); err != nil {
		t.Fatal(err)
	}
	if operator != who.Username || strings.Join(got, " ") != strings.Join(args, " ") {
		t.Fatalf("recorded %s running %v; want %s running %v", operator, got, who.Username, args)
	}
}

func TestBaseUnitsReadsTokensExactly(t *testing.T) {
	for text, want := range map[string]string{"1": "1000000", "1.5": "1500000", "0.000001": "1", "12.345678": "12345678"} {
		if got, err := baseUnits(text, 6); err != nil || got.String() != want {
			t.Errorf("%s: %v, %v; want %s", text, got, err, want)
		}
	}
	for _, text := range []string{"", "0", "-1", "1/2", "1e3", "1.0000001", "1,5"} {
		if got, err := baseUnits(text, 6); err == nil {
			t.Errorf("%q read as %s", text, got)
		}
	}
}

func TestStrayWithoutOurContractsSaysPlainlyItCantComeBack(t *testing.T) {
	var out strings.Builder
	s := settlement.Stray{TxHash: "0xab", ChainID: 31339, Option: settlement.CaseOption{ID: "0x07", ChainID: 31337},
		Token: common.HexToAddress("0x01"), From: common.HexToAddress("0x02"), Amount: big.NewInt(2000000)}
	printStray(&out, s, settlement.Recovery{}, fmt.Errorf("%w: that chain has no Forwend factory", settlement.ErrCantReturn))
	text := out.String()
	if !strings.Contains(text, "this money can't be returned now: that chain has no Forwend factory") ||
		!strings.Contains(text, "promise nothing") || strings.Contains(text, "cast send") {
		t.Fatalf("printed %q", text)
	}
}
