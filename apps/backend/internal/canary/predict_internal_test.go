package canary

import (
	"encoding/hex"
	"testing"
)

// The canary encodes factory.predict itself (R-51): seven fields for a v1.1 factory, nine for v2 (R-226). cast wrote
// both expected calldatas.
func TestPredictCallMatchesEachFactorysTerms(t *testing.T) {
	line := terms{ID: "0x" + repeat("05", 32), Recipient: "0x1a2B3c4D5e6F708192a3B4c5D6e7F80912A3b4C5",
		Token: "0x00000000000000000000000000000000000000bb", Amount: "5000000", ExpiresAt: 1800000000,
		SettleDeadline: 1800086400, ChainID: 31337}
	words := repeat("05", 32) +
		"0000000000000000000000001a2b3c4d5e6f708192a3b4c5d6e7f80912a3b4c5" +
		"00000000000000000000000000000000000000000000000000000000000000bb" +
		"00000000000000000000000000000000000000000000000000000000004c4b40" +
		"000000000000000000000000000000000000000000000000000000006b49d200" +
		"000000000000000000000000000000000000000000000000000000006b4b2380" +
		"0000000000000000000000000000000000000000000000000000000000007a69"
	if got := hex.EncodeToString(line.predictCall(false)); got != "6dc51d39"+words {
		t.Errorf("v1.1 predict\n got %s\nwant %s", got, "6dc51d39"+words)
	}
	if got := hex.EncodeToString(line.predictCall(true)); got != "ab97e44a"+words+repeat("0", 128) {
		t.Errorf("v2 predict\n got %s", got)
	}
}

func repeat(s string, n int) string {
	out := ""
	for range n {
		out += s
	}
	return out
}
