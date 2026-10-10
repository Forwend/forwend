// Package document renders an invoice and its receipt as PDF files with a fixed layout (R-47, D-51). Only the stored
// invoice goes in, nothing is read from the network or disk, and the same invoice always gives the same bytes.
package document

import (
	"bytes"
	_ "embed"
	"errors"
	"fmt"
	"math/big"
	"strings"
	"time"

	"codeberg.org/go-pdf/fpdf"

	"github.com/ensp1re/forwend/apps/backend/internal/invoice"
	"github.com/ensp1re/forwend/apps/backend/internal/ledger"
)

var ErrNotPaid = errors.New("invoice not paid")

// Noto Sans covers Latin with its accents, Greek and Cyrillic; the license is fonts/OFL.txt.
var (
	//go:embed fonts/NotoSans-Regular.ttf
	regular []byte
	//go:embed fonts/NotoSans-Bold.ttf
	bold []byte
)

// A4 in mm.
const (
	pageHeight = 297.0
	margin     = 20.0
	width      = 170.0 // between the margins
	labelWidth = 38.0
	valueWidth = width - labelWidth
	lineHeight = 5.0
	font       = "Noto"
)

func Number(n int64) string {
	return fmt.Sprintf("INV-%04d", n)
}

func Invoice(inv invoice.Invoice, payLink string) ([]byte, error) {
	d := start(inv, "Invoice", inv.CreatedAt)
	d.row("Amount", amount(inv.Amount, inv.Decimals, inv.Symbol), 3)
	d.row("Network", fmt.Sprintf("%s (chain %d)", inv.Network, inv.ChainID), 2)
	d.row("Due date", inv.DueDate, 1)
	d.row("Checkout closes", stamp(inv.ExpiresAt), 1)
	d.row("Issued", stamp(inv.CreatedAt), 1)
	d.row("Invoice ID", inv.ID, 2)
	if inv.Note != "" {
		d.Ln(lineHeight)
		d.row("Note", inv.Note, 30)
	}
	d.Ln(lineHeight)
	d.link("Pay this invoice at", payLink)
	return d.output()
}

func Receipt(inv invoice.Invoice, payLink string) ([]byte, error) {
	if inv.PaymentStatus != ledger.Paid {
		return nil, ErrNotPaid
	}
	d := start(inv, "Receipt", inv.PaidAt)
	d.row("Amount paid", amount(inv.Amount, inv.Decimals, inv.Symbol), 3)
	d.row("Network", fmt.Sprintf("%s (chain %d)", inv.Network, inv.ChainID), 2)
	d.row("Paid", stamp(inv.PaidAt), 1)
	label := "Deposits"
	for _, dep := range inv.Deposits {
		if dep.Status == "confirmed" && !dep.Late { // late money is held for the payer, not paid (D-26)
			d.row(label, dep.TxHash+"\n"+amount(dep.Amount, inv.Decimals, inv.Symbol), 4)
			label = ""
		}
	}
	d.row("Settlement", settlement[inv.SettlementStatus], 1)
	d.row("Settlement tx", inv.SettlementTxHash, 2)
	d.row("Invoice ID", inv.ID, 2)
	d.Ln(lineHeight)
	d.link("A PDF can be edited. Check this receipt at", payLink)
	return d.output()
}

var settlement = map[string]string{"none": "Not started", "pending": "Pending", "settled": "Settled"}

type doc struct{ *fpdf.Fpdf }

func start(inv invoice.Invoice, kind string, date time.Time) doc {
	d := doc{fpdf.New("P", "mm", "A4", "")}
	d.SetMargins(margin, margin, margin)
	d.SetAutoPageBreak(true, margin)
	d.SetCellMargin(0)
	d.AddUTF8FontFromBytes(font, "", regular)
	d.AddUTF8FontFromBytes(font, "B", bold)
	author := "Forwend"
	if inv.Issuer != nil {
		author = bmp(inv.Issuer.Name)
	}
	d.SetTitle(kind+" "+Number(inv.Number), true)
	d.SetAuthor(author, true)
	d.SetCreator("Forwend", true)
	d.SetLang("en")
	d.SetCreationDate(date)
	d.SetModificationDate(date)
	d.SetCatalogSort(true)
	d.AddPage()

	d.SetFont(font, "B", 22)
	d.CellFormat(width/2, 10, kind, "", 0, "L", false, 0, "")
	d.SetFont(font, "", 12)
	d.CellFormat(width/2, 10, Number(inv.Number), "", 1, "R", false, 0, "")
	if inv.Title != "" {
		d.SetFont(font, "B", 13)
		for _, l := range d.fit(inv.Title, width, 3) {
			d.CellFormat(width, 6.5, l, "", 1, "L", false, 0, "")
		}
	}
	d.Ln(lineHeight)

	// Side by side. Each block is cut to fit, so neither reaches the end of the page.
	top, bottom, x := d.GetY(), d.GetY(), margin
	if i := inv.Issuer; i != nil {
		tax := ""
		if i.TaxID != "" {
			tax = "Tax ID " + i.TaxID
		}
		bottom = max(bottom, d.party(x, top, "From", i.Name, i.Address, i.Country, tax, i.Email))
		x += width / 2
	}
	// Never the client's email: the PDF is public to anyone with the invoice id.
	if inv.ClientName != "" || inv.ClientAddress != "" {
		bottom = max(bottom, d.party(x, top, "Bill to", inv.ClientName, inv.ClientAddress))
	}
	d.SetY(bottom + lineHeight)
	return d
}

func (d doc) party(x, y float64, heading, name string, details ...string) float64 {
	w := width/2 - 5
	d.SetXY(x, y)
	d.SetTextColor(110, 110, 110)
	d.SetFont(font, "B", 8)
	d.CellFormat(w, lineHeight, strings.ToUpper(heading), "", 2, "L", false, 0, "")
	d.SetTextColor(0, 0, 0)
	d.SetFont(font, "B", 10)
	for _, l := range d.fit(name, w, 4) {
		d.CellFormat(w, lineHeight, l, "", 2, "L", false, 0, "")
	}
	d.SetFont(font, "", 10)
	for _, text := range details {
		for _, l := range d.fit(text, w, 8) {
			d.CellFormat(w, lineHeight, l, "", 2, "L", false, 0, "")
		}
	}
	return d.GetY()
}

func (d doc) row(label, value string, maxLines int) {
	if value == "" {
		return
	}
	d.SetFont(font, "", 9.5)
	lines := d.fit(value, valueWidth, maxLines)
	if d.GetY()+float64(len(lines))*lineHeight > pageHeight-margin {
		d.AddPage() // the label stays with its value
	}
	d.SetTextColor(110, 110, 110)
	d.CellFormat(labelWidth, lineHeight, label, "", 0, "L", false, 0, "")
	d.SetTextColor(0, 0, 0)
	for _, l := range lines {
		d.SetX(margin + labelWidth)
		d.CellFormat(valueWidth, lineHeight, l, "", 1, "L", false, 0, "")
	}
	d.Ln(1.5)
}

func (d doc) link(text, url string) {
	d.SetFont(font, "", 9.5)
	d.CellFormat(width, lineHeight, text, "", 1, "L", false, 0, "")
	d.SetFont(font, "", 9)
	d.SetTextColor(20, 80, 200)
	for _, l := range d.fit(url, width, 3) {
		d.CellFormat(width, lineHeight, l, "", 1, "L", false, 0, url)
	}
	d.SetTextColor(0, 0, 0)
}

func (d doc) fit(text string, w float64, maxLines int) []string {
	lines := d.SplitText(strings.ReplaceAll(bmp(text), "\r", ""), w)
	if len(lines) <= maxLines {
		return lines
	}
	lines = lines[:maxLines]
	last := []rune(lines[maxLines-1])
	for len(last) > 0 && d.GetStringWidth(string(last)+"…") > w {
		last = last[:len(last)-1]
	}
	lines[maxLines-1] = string(last) + "…"
	return lines
}

// fpdf panics on characters above U+FFFF, such as emoji.
func bmp(s string) string {
	return strings.Map(func(r rune) rune {
		if r > 0xFFFF {
			return '?'
		}
		return r
	}, s)
}

func (d doc) output() ([]byte, error) {
	var b bytes.Buffer
	if err := d.Output(&b); err != nil {
		return nil, fmt.Errorf("render PDF: %w", err)
	}
	return b.Bytes(), nil
}

// amount writes base units exactly in whole tokens, with at least 2 decimals when the token has them.
func amount(n *big.Int, decimals int, symbol string) string {
	s := new(big.Rat).SetFrac(n, new(big.Int).Exp(big.NewInt(10), big.NewInt(int64(decimals)), nil)).FloatString(decimals)
	if whole, frac, ok := strings.Cut(s, "."); ok {
		frac = strings.TrimRight(frac, "0")
		frac += strings.Repeat("0", max(0, min(2, decimals)-len(frac)))
		s = whole + "." + frac
	}
	return s + " " + symbol
}

func stamp(t time.Time) string {
	return t.UTC().Format("2006-01-02 15:04 UTC")
}
