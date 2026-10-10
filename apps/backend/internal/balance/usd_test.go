package balance

import (
	"math/big"
	"testing"
)

func TestUSDIsCutToCentsNeverRoundedUp(t *testing.T) {
	for _, c := range []struct {
		base     int64
		decimals int
		want     string
	}{
		{0, 6, "0.00"},
		{9_000, 6, "0.00"},     // 0.009
		{1_999_999, 6, "1.99"}, // 1.999999
		{2_500_000, 6, "2.50"},
		{12_345_678_901, 6, "12345.67"},
	} {
		tokens := []TokenHistory{{Decimals: c.decimals}}
		got := usd(tokens, func(TokenHistory) *big.Int { return big.NewInt(c.base) })
		if got != c.want {
			t.Errorf("usd(%d at %d decimals) = %q, want %q", c.base, c.decimals, got, c.want)
		}
	}
}
