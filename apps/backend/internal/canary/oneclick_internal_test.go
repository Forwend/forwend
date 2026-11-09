package canary

import (
	"context"
	"math/big"
	"strings"
	"testing"
	"time"

	"github.com/forwend/forwend/apps/backend/internal/config"
	"github.com/forwend/forwend/apps/backend/internal/intents"
	"github.com/forwend/forwend/apps/backend/internal/intents/intentstest"
)

// R-235: a quote passes only when 1Click's own record of it, signed by 1Click's key, pays exactly the amount into the
// address the factory predicts for the option.
func TestCheckQuoteAgainst1ClicksOwnRecord(t *testing.T) {
	fake := intentstest.New(t)
	receive := "0x5e4b7c9a1f3d2e6b8a0c4d7f9e1b3a5c7d9e0f12"
	q, err := fake.Client().Quote(context.Background(), intents.Ask{Origin: "nep141:eth.omft.near", Amount: big.NewInt(100000000),
		Recipient: receive, RefundTo: "0x6fd1c6b3f0b7a5b4e5d6a3c2b1a0f9e8d7c6b5a4", Deadline: time.Now().Add(time.Hour)}, false)
	if err != nil {
		t.Fatal(err)
	}
	line := "quote 0x" + strings.Repeat("01", 32) + " " + q.DepositAddress + " 100000000"
	parsed, err := parseQuote(line)
	if err != nil {
		t.Fatal(err)
	}
	cfg := config.Canary{AllowLoopback: true, OneClickURL: fake.URL, OneClickKey: fake.Key}
	base := terms{ChainID: 8453, Token: intents.BaseUSDC}
	if err := checkQuote(context.Background(), cfg, base, receive, parsed); err != nil {
		t.Fatal(err)
	}
	for name, c := range map[string]struct {
		cfg     config.Canary
		t       terms
		receive string
		q       quote
		alert   string
	}{
		"another receive address": {cfg, base, "0x0000000000000000000000000000000000000bad", parsed, "recipient"},
		"another amount":          {cfg, base, receive, quote{parsed.OptionID, parsed.DepositAddress, "99000000"}, "amount"},
		"another key":             {config.Canary{AllowLoopback: true, OneClickURL: fake.URL, OneClickKey: config.CanaryOneClickKey}, base, receive, parsed, "signature"},
		"another token":           {cfg, terms{ChainID: 8453, Token: "0x0000000000000000000000000000000000000001"}, receive, parsed, "destinationAsset"},
		"not Base":                {cfg, terms{ChainID: 42161, Token: intents.BaseUSDC}, receive, parsed, "only Base"},
		"unknown address":         {cfg, base, receive, quote{parsed.OptionID, "0xnothing", "100000000"}, "no quote"},
	} {
		if err := checkQuote(context.Background(), c.cfg, c.t, c.receive, c.q); err == nil || !strings.Contains(err.Error(), c.alert) {
			t.Fatalf("%s: %v, want %q", name, err, c.alert)
		}
	}
	for _, bad := range []string{"quote 0x01 0xabc 1", "quote " + parsed.OptionID + " 0xabc 0", "quote " + parsed.OptionID + " 0xabc"} {
		if _, err := parseQuote(bad); err == nil {
			t.Fatalf("%q parsed", bad)
		}
	}
}
