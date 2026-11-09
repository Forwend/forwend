package main

import (
	"fmt"
	"math/big"
	"strings"
	"testing"

	"github.com/ethereum/go-ethereum/common"
	"github.com/forwend/forwend/apps/backend/internal/settlement"
)

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

func TestCrossChainPaymentNamesThePayersQuote(t *testing.T) {
	var out strings.Builder
	zero := new(big.Int)
	printHeld(&out, settlement.Held{ChainID: 8453, Decimals: 6, Symbol: "USDC", Held: zero, Balance: zero, Refundable: zero,
		Payments: []settlement.Payment{{TxHash: "0xab", From: "0x02", Amount: big.NewInt(1000000), Quote: "q-1",
			OriginChain: "tron", OriginTx: "0xcd", RefundTo: "TPayer"}}})
	if text := out.String(); !strings.Contains(text, "Sent by NEAR Intents, not the payer: quote q-1; the payer paid on tron in 0xcd, refund address there TPayer") ||
		!strings.Contains(text, "only with -to, an address on chain 8453") {
		t.Fatalf("printed %q", text)
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
