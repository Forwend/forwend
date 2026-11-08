package document

import (
	"fmt"
	"math/big"
	"os"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/forwend/forwend/apps/backend/internal/chain"
	"github.com/forwend/forwend/apps/backend/internal/invoice"
	"github.com/forwend/forwend/apps/backend/internal/ledger"
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

// R-179, D-114: the invoice PDF names its status as the app does and asks for money only while the pay page would.
func TestStatusAsksForMoneyOnlyWhilePayable(t *testing.T) {
	now := time.Date(2026, 10, 28, 12, 0, 0, 0, time.UTC)
	usdc := chain.Asset{ChainID: 84532, Symbol: "USDC", Decimals: 6}
	with := func(status string, change func(*invoice.Invoice)) invoice.Invoice {
		inv := invoice.Invoice{Asset: usdc, Amount: big.NewInt(10_000000), PaymentStatus: status,
			ClosesAt: now.Add(time.Hour), Amounts: &ledger.Amounts{ReconciliationStatus: ledger.ReconciliationVerified,
				Payable: new(big.Int), Held: new(big.Int)}}
		if change != nil {
			change(&inv)
		}
		return inv
	}
	for _, c := range []struct {
		name                  string
		inv                   invoice.Invoice
		label, figure, amount string
		payable               bool
	}{
		{"open", with(ledger.Open, nil), "Waiting for payment", "Amount due", "10.00 USDC", true},
		// A new invoice reads pending until its first scan; with no money that is no reason to stop.
		{"before the first scan", with(ledger.Open, func(i *invoice.Invoice) {
			i.Amounts.Unreconciled, i.Amounts.ReconciliationStatus = true, ledger.ReconciliationPending
		}), "Waiting for payment", "Amount due", "10.00 USDC", true},
		{"past its due date", with(ledger.Open, func(i *invoice.Invoice) { i.DueDate = "2026-10-27" }),
			"Overdue", "Amount due", "10.00 USDC", true},
		{"due today", with(ledger.Open, func(i *invoice.Invoice) { i.DueDate = "2026-10-28" }),
			"Waiting for payment", "Amount due", "10.00 USDC", true},
		{"partially paid", with(ledger.PartiallyPaid, func(i *invoice.Invoice) { i.Amounts.Payable = big.NewInt(4_000000) }),
			"Partially paid", "Left to pay", "6.00 USDC", true},
		{"the rest confirming", with(ledger.PartiallyPaid, func(i *invoice.Invoice) {
			i.Confirming, i.Amounts.Payable = true, big.NewInt(4_000000)
			i.DepositSummary = &invoice.DepositSummary{PendingAmount: big.NewInt(6_000000)}
		}), "Confirming", "Left to pay", "0.00 USDC", false},
		{"paid", with(ledger.Paid, nil), "Paid", "Amount paid", "10.00 USDC", false},
		{"canceled", with(ledger.Canceled, nil), "Canceled", "Total", "10.00 USDC", false},
		{"checkout closed unpaid", with(ledger.Open, func(i *invoice.Invoice) { i.Closed = true }),
			"Expired", "Total", "10.00 USDC", false},
		{"expired partially paid", with(ledger.ExpiredPartiallyPaid, func(i *invoice.Invoice) {
			i.Amounts.Held = big.NewInt(4_000000)
		}), "Expired, partially paid", "Received", "4.00 USDC", false},
		{"records in review", with(ledger.Open, func(i *invoice.Invoice) {
			i.Amounts.HasPolicyException, i.Amounts.ReconciliationStatus = true, ledger.ReconciliationReview
		}), "Waiting for payment", "Amount due", "10.00 USDC", false},
	} {
		s := statusOf(c.inv, now)
		if s.label != c.label || s.figure != c.figure || s.amount != c.amount || s.payable != c.payable {
			t.Errorf("%s: %q %q %q payable %v; want %q %q %q payable %v", c.name, s.label, s.figure, s.amount, s.payable,
				c.label, c.figure, c.amount, c.payable)
		}
		// R-195: the dates row has the dates, and the totals give the panel's figure again only to finish the sum.
		if strings.Contains(s.detail, s.amount) || strings.Contains(s.detail, "2026") {
			t.Errorf("%s: the panel's line %q repeats its figure or a date", c.name, s.detail)
		}
		for _, row := range s.totals[1:] {
			if row[1] == s.amount && row[0] != "Left to pay" {
				t.Errorf("%s: the totals repeat the panel's %s as %s", c.name, s.amount, row[0])
			}
		}
	}
	// D-118: held money comes back through support, which the pay page's Need help names; the payee can't return it.
	held := statusOf(with(ledger.ExpiredPartiallyPaid, func(i *invoice.Invoice) { i.Amounts.Held = big.NewInt(4_000000) }), now)
	if !strings.Contains(held.detail, "Need help on the pay page") || strings.Contains(held.detail, " ask ") {
		t.Errorf("expired partially paid: %q; want the way to Need help and no ask-the-payee", held.detail)
	}
	partial := statusOf(with(ledger.PartiallyPaid, func(i *invoice.Invoice) { i.Amounts.Payable = big.NewInt(4_000000) }), now)
	if got := fmt.Sprint(partial.totals); got != "[[Total 10.00 USDC] [Received 4.00 USDC] [Left to pay 6.00 USDC]]" {
		t.Errorf("partially paid totals %s; want Total, Received and Left to pay", got)
	}
}

// R-228: when the client pays the fees, the PDF shows the price and each fee above 0 before the total; when the owner
// pays, the client sees only the total.
func TestFeesShowWhenTheClientPaysThem(t *testing.T) {
	now := time.Date(2026, 10, 28, 12, 0, 0, 0, time.UTC)
	inv := func(paidBy string) invoice.Invoice {
		return invoice.Invoice{Asset: chain.Asset{ChainID: 84532, Symbol: "USDC", Decimals: 6}, Amount: big.NewInt(10_050000),
			Fees:     invoice.Fees{Network: big.NewInt(50000), Platform: new(big.Int), PaidBy: paidBy},
			ClosesAt: now.Add(time.Hour), PaymentStatus: ledger.Open,
			Amounts: &ledger.Amounts{ReconciliationStatus: ledger.ReconciliationVerified, Payable: new(big.Int), Held: new(big.Int)}}
	}
	if got := fmt.Sprint(statusOf(inv(invoice.FeesPaidByClient), now).totals); got != "[[Subtotal 10.00 USDC] [Network fee 0.05 USDC] [Total 10.05 USDC]]" {
		t.Errorf("client pays: %s", got)
	}
	if got := fmt.Sprint(statusOf(inv(invoice.FeesPaidByOwner), now).totals); got != "[[Total 10.05 USDC]]" {
		t.Errorf("owner pays: %s", got)
	}
}

// R-195: one transfer applied whole says it all in its row, with no Applied column and no totals under it.
func TestReceiptOfOneWholeTransfer(t *testing.T) {
	paidAt := time.Date(2026, 10, 28, 12, 0, 0, 0, time.UTC)
	ten := big.NewInt(10_000000)
	usdc := chain.Asset{ChainID: 84532, Symbol: "USDC", Decimals: 6}
	amounts := &ledger.Amounts{ReconciliationStatus: ledger.ReconciliationVerified, Payable: ten, Held: new(big.Int),
		Settled: new(big.Int), Fees: new(big.Int), Refunded: new(big.Int)}
	tx := "0x" + strings.Repeat("ab", 32)
	inv := invoice.Invoice{Asset: usdc, Amount: ten, PaymentStatus: ledger.Paid, PaidAt: paidAt, CreatedAt: paidAt,
		ClosesAt: paidAt.Add(time.Hour), OptionID: "o", Amounts: amounts, Options: []invoice.Option{{ID: "o",
			Asset: usdc, Amount: ten, Amounts: amounts,
			Deposits: []invoice.Deposit{{TxHash: tx, Amount: ten, Paid: ten, BlockTime: paidAt, Status: "confirmed"}}}}}
	pdf, err := Receipt(inv, "https://example.com/pay/x", nil)
	if err != nil {
		t.Fatal(err)
	}
	text := strings.Join(pages(t, pdf), "\n")
	if !strings.Contains(text, "Payment received\nDate (UTC)\nNetwork\nAmount\n28 Oct 2026, 12:00\nBase Sepolia\n10.00 USDC\n"+tx) ||
		strings.Contains(text, "Applied") || strings.Contains(text, "\nReceived\n") {
		t.Fatalf("one whole transfer: want its row alone, without Applied or totals:\n%s", text)
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

// R-88: the most lines an invoice may have continue across pages, the last one included.
func TestInvoiceWithTheMostLinesSpansPages(t *testing.T) {
	now := time.Date(2026, 10, 28, 12, 0, 0, 0, time.UTC)
	lines := make([]invoice.Line, invoice.MaxLines)
	for i := range lines {
		lines[i] = invoice.Line{Description: fmt.Sprintf("Item %d with a longer description that wraps onto a second line in the table", i+1),
			Quantity: "1.00", UnitPrice: big.NewInt(1_000000), Amount: big.NewInt(1_000000)}
	}
	inv := invoice.Invoice{Asset: chain.Asset{ChainID: 84532, Symbol: "USDC", Decimals: 6},
		Amount: big.NewInt(int64(invoice.MaxLines) * 1_000000), PaymentStatus: ledger.Open,
		ClosesAt: now.Add(time.Hour), Lines: lines,
		Amounts: &ledger.Amounts{ReconciliationStatus: ledger.ReconciliationVerified, Payable: new(big.Int), Held: new(big.Int)}}
	pdf, err := Invoice(inv, "https://example.com/pay/x", nil, now)
	if err != nil {
		t.Fatal(err)
	}
	drawn := pages(t, pdf)
	if len(drawn) < 2 {
		t.Fatalf("%d lines on %d page(s); want them to continue on a second page", invoice.MaxLines, len(drawn))
	}
	all := strings.Join(drawn, "\n")
	for _, want := range []string{"Item 1 with", fmt.Sprintf("Item %d with", invoice.MaxLines)} {
		if !strings.Contains(all, want) {
			t.Errorf("%q is missing from the PDF", want)
		}
	}
}
