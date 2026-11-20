package document

import (
	"fmt"
	"math/big"
	"strconv"
	"strings"
	"time"

	"github.com/forwend/forwend/apps/backend/internal/intents"
	"github.com/forwend/forwend/apps/backend/internal/invoice"
)

// network mirrors apps/web/src/shared/constants/chains.ts; a test keeps them equal.
type network struct{ name, explorer, url string }

var networks = map[uint64]network{
	8453:    {"Base", "Basescan", "https://basescan.org"},
	42161:   {"Arbitrum", "Arbiscan", "https://arbiscan.io"},
	5042:    {"Arc", "Arc Explorer", "https://explorer.arc.io"},
	4217:    {"Tempo", "Tempo Explorer", "https://explore.tempo.xyz"},
	84532:   {"Base Sepolia", "Basescan", "https://sepolia.basescan.org"},
	421614:  {"Arbitrum Sepolia", "Arbiscan", "https://sepolia.arbiscan.io"},
	5042002: {"Arc Testnet", "ArcScan", "https://testnet.arcscan.app"},
	42431:   {"Tempo Moderato", "Tempo Explorer", "https://explore.testnet.tempo.xyz"},
}

// TxURL is "" for a network without an explorer.
func TxURL(chainID uint64, txHash string) string {
	if n, ok := networks[chainID]; ok && n.url != "" {
		return n.url + "/tx/" + txHash
	}
	return ""
}

// NetworkName is "Chain <id>" for a chain the app doesn't name.
func NetworkName(chainID uint64) string {
	if n, ok := networks[chainID]; ok {
		return n.name
	}
	return "Chain " + strconv.FormatUint(chainID, 10)
}

const TestMode = "Test mode: testnet tokens have no value"

func Number(n int64) string {
	return fmt.Sprintf("INV-%04d", n)
}

// InvoiceNumber is "" for a link invoice before its first deposit.
func InvoiceNumber(inv invoice.Invoice) string {
	if inv.Number == nil {
		return ""
	}
	return Number(*inv.Number)
}

// PaidWith is what the payer sent through NEAR Intents: "1,263.00 USDT on Tron through NEAR Intents".
func PaidWith(sent *big.Int, decimals int, symbol, blockchain string) string {
	return Amount(sent, decimals, symbol) + " on " + intents.ChainName(blockchain) + " through NEAR Intents"
}

// Decimal writes base units exactly, with every decimal: 1250000 at 6 decimals is 1.250000.
func Decimal(n *big.Int, decimals int) string {
	return new(big.Rat).SetFrac(n, new(big.Int).Exp(big.NewInt(10), big.NewInt(int64(decimals)), nil)).FloatString(decimals)
}

// Amount writes base units exactly, with at least 2 decimals when the token has them: 1,250.00 USDC.
func Amount(n *big.Int, decimals int, symbol string) string {
	s := Decimal(n, decimals)
	whole, frac, ok := strings.Cut(s, ".")
	for i := len(whole) - 3; i > 0; i -= 3 {
		whole = whole[:i] + "," + whole[i:]
	}
	if ok {
		frac = strings.TrimRight(frac, "0")
		frac += strings.Repeat("0", max(0, min(2, decimals)-len(frac)))
		return whole + "." + frac + " " + symbol
	}
	return whole + " " + symbol
}

// Day before month name, so 03/04 can't be read as March or April.
func stamp(t time.Time) string {
	return t.UTC().Format("2 Jan 2006, 15:04 UTC")
}

func day(t time.Time) string {
	return t.UTC().Format("2 Jan 2006")
}

// DateText writes a stored YYYY-MM-DD like day(); "" stays "".
func DateText(s string) string {
	t, err := time.Parse(time.DateOnly, s)
	if err != nil {
		return s
	}
	return day(t)
}
