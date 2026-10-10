package document

import (
	"math/big"
	"testing"
)

// Amounts are exact: no rounding, trailing zeros trimmed down to 2 decimals.
func TestAmount(t *testing.T) {
	for _, c := range []struct {
		units    string
		decimals int
		want     string
	}{
		{"5000000", 6, "5.00 USDC"},
		{"1234567", 6, "1.234567 USDC"},
		{"1", 6, "0.000001 USDC"},
		{"5500000", 6, "5.50 USDC"},
		{"42", 0, "42 USDC"},
		{"15", 1, "1.5 USDC"},
		{"115792089237316195423570985008687907853269984665640564039457584007913129639935", 18,
			"115792089237316195423570985008687907853269984665640564039457.584007913129639935 USDC"},
	} {
		n, _ := new(big.Int).SetString(c.units, 10)
		if got := amount(n, c.decimals, "USDC"); got != c.want {
			t.Errorf("amount(%s, %d) = %q, want %q", c.units, c.decimals, got, c.want)
		}
	}
}
