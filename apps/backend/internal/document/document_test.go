package document

import (
	"fmt"
	"math/big"
	"os"
	"regexp"
	"strings"
	"testing"

	"github.com/forwend/forwend/apps/backend/internal/chain"
	"github.com/forwend/forwend/apps/backend/internal/invoice"
)

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
			"115,792,089,237,316,195,423,570,985,008,687,907,853,269,984,665,640,564,039,457.584007913129639935 USDC"},
		{"1250000000", 6, "1,250.00 USDC"},
		{"999000000", 6, "999.00 USDC"},
	} {
		n, _ := new(big.Int).SetString(c.units, 10)
		if got := Amount(n, c.decimals, "USDC"); got != c.want {
			t.Errorf("Amount(%s, %d) = %q, want %q", c.units, c.decimals, got, c.want)
		}
	}
}

func TestCopiesMatchTheWeb(t *testing.T) {
	logo, err := os.ReadFile("../../../../packages/ui-web/src/icons/logo-data.ts")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(logo), `viewBox: "117.2 11.5 1812.6 1812.6"`) ||
		!strings.Contains(string(logo), `d: "`+strings.TrimSpace(logoPath)+`"`) {
		t.Fatal("logo.path differs from packages/ui-web/src/icons/logo-data.ts")
	}
	chains, err := os.ReadFile("../../../web/src/shared/constants/chains.ts")
	if err != nil {
		t.Fatal(err)
	}
	for id, n := range networks {
		entry := regexp.MustCompile(fmt.Sprintf(`(?s)\b%d: \{\s*name: "%s",.*?explorer: \{ name: "%s", url: "%s" \}`,
			id, regexp.QuoteMeta(n.name), regexp.QuoteMeta(n.explorer), regexp.QuoteMeta(n.url)))
		if !entry.Match(chains) {
			t.Errorf("chain %d %+v differs from apps/web/src/shared/constants/chains.ts", id, n)
		}
	}
}

// R-88.
func TestLineUnit(t *testing.T) {
	usdc := invoice.Option{ID: "main", Asset: chain.Asset{Symbol: "USDC", Decimals: 6}}
	dai := invoice.Option{ID: "other", Asset: chain.Asset{Symbol: "DAI", Decimals: 18}}
	paidInDai := invoice.Invoice{ID: "main", OptionID: "other", Asset: dai.Asset, Options: []invoice.Option{usdc, dai}}
	if d, s := lineUnit(paidInDai); d != 6 || s != "USD" {
		t.Errorf("client chooses, paid in DAI: %d %s, want 6 USD", d, s)
	}
	fixed := invoice.Invoice{ID: "main", OptionID: "main", Asset: usdc.Asset, Options: []invoice.Option{usdc}}
	if d, s := lineUnit(fixed); d != 6 || s != "USDC" {
		t.Errorf("fixed: %d %s, want 6 USDC", d, s)
	}
}
