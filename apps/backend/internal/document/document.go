// Package document renders invoices, receipts and income statements as PDFs (R-47, R-61, R-112, D-51). Nothing is
// read from the network or disk, and the same input always gives the same bytes.
package document

import (
	"bytes"
	_ "embed"
	"errors"
	"fmt"
	"math/big"
	"strconv"
	"strings"
	"time"

	"codeberg.org/go-pdf/fpdf"
	"github.com/boombuler/barcode/qr"

	"github.com/forwend/forwend/apps/backend/internal/invoice"
	"github.com/forwend/forwend/apps/backend/internal/ledger"
)

var ErrNotPaid = errors.New("invoice not paid")

// Noto Sans covers Latin with its accents, Greek and Cyrillic; the license is fonts/OFL.txt.
var (
	//go:embed fonts/NotoSans-Regular.ttf
	regular []byte
	//go:embed fonts/NotoSans-Bold.ttf
	bold []byte
	// The Forwend mark, a copy of packages/ui-web/src/icons/logo-data.ts (a test keeps them equal).
	//go:embed logo.path
	logoPath string
)

// A4 in mm.
const (
	pageHeight = 297.0
	margin     = 20.0
	width      = 170.0 // between the margins
	lineHeight = 5.0
	font       = "Noto"
	mono       = "Courier" // a core font: hashes and addresses are ASCII
)

// The product's light theme (packages/design-tokens/src/tokens.css).
var (
	ink     = [3]int{0x0f, 0x22, 0x19}
	muted   = [3]int{0x3a, 0x50, 0x47}
	subtle  = [3]int{0x56, 0x6a, 0x62}
	line    = [3]int{0xd3, 0xe0, 0xdc}
	surface = [3]int{0xea, 0xf2, 0xf0}
	accent  = [3]int{0x1f, 0x6a, 0x8c}
)

// network is a chain's name and block explorer, as apps/web/src/shared/constants/chains.ts has them (a test keeps them
// equal). Transactions are at <url>/tx/<hash>.
type network struct{ name, explorer, url string }

var networks = map[uint64]network{
	84532:   {"Base Sepolia", "Basescan", "https://sepolia.basescan.org"},
	421614:  {"Arbitrum Sepolia", "Arbiscan", "https://sepolia.arbiscan.io"},
	5042002: {"Arc Testnet", "ArcScan", "https://testnet.arcscan.app"},
	42431:   {"Tempo Moderato", "Tempo Explorer", "https://explore.testnet.tempo.xyz"},
}

// TxURL is the transaction's page on the network's explorer, or "" for a network without one.
func TxURL(chainID uint64, txHash string) string {
	if n, ok := networks[chainID]; ok && n.url != "" {
		return n.url + "/tx/" + txHash
	}
	return ""
}

func NetworkName(chainID uint64) string {
	if n, ok := networks[chainID]; ok {
		return n.name
	}
	return "Chain " + strconv.FormatUint(chainID, 10)
}

func networkOf(inv invoice.Invoice) network {
	if n, ok := networks[inv.ChainID]; ok {
		return n
	}
	return network{name: inv.Network}
}

// anyOption: the invoice accepts several tokens and networks, so it is priced in USD (R-56, R-70).
func anyOption(inv invoice.Invoice) bool {
	return len(inv.Options) > 1
}

func accepted(inv invoice.Invoice) []string {
	var symbols []string
	nets := map[string][]string{}
	for _, o := range inv.Options {
		name := o.Network
		if n, ok := networks[o.ChainID]; ok {
			name = n.name
		}
		if _, seen := nets[o.Symbol]; !seen {
			symbols = append(symbols, o.Symbol)
		}
		nets[o.Symbol] = append(nets[o.Symbol], name)
	}
	var out []string
	for _, s := range symbols {
		out = append(out, s+" on "+strings.Join(nets[s], ", "))
	}
	return out
}

// TestMode marks a test-mode invoice's PDFs (R-143).
const TestMode = "Test mode: testnet tokens have no value"

func Number(n int64) string {
	return fmt.Sprintf("INV-%04d", n)
}

// InvoiceNumber is "" for a link invoice before its first deposit (R-141).
func InvoiceNumber(inv invoice.Invoice) string {
	if inv.Number == nil {
		return ""
	}
	return Number(*inv.Number)
}

// logo is the invoice's store logo, a PNG the API encoded (R-135); nil shows Forwend's.
func Invoice(inv invoice.Invoice, payLink string, logo []byte) ([]byte, error) {
	d := start(inv, "Invoice", logo)
	canceled := inv.PaymentStatus == ledger.Canceled
	if canceled {
		// A canceled invoice keeps its number and PDF as a record (D-79), and never asks for money again: no total
		// due, no pay link or code.
		d.facts([2]string{"Issued", stamp(inv.CreatedAt)}, [2]string{"Supply date", inv.SupplyDate},
			[2]string{"Canceled", stamp(inv.CanceledAt)})
		d.lines(inv, "Total, canceled", anyOption(inv))
		d.heading("Canceled")
		d.SetFont(font, "B", 10)
		d.CellFormat(width, lineHeight, "This invoice was canceled. Do not pay it.", "", 1, "L", false, 0, "")
		d.Ln(6)
		d.note(inv.Note)
		d.footer(inv)
		return d.output()
	}
	d.facts([2]string{"Issued", stamp(inv.CreatedAt)}, [2]string{"Supply date", inv.SupplyDate},
		[2]string{"Due date", inv.DueDate}, [2]string{"Checkout closes", stamp(inv.ClosesAt)})
	d.lines(inv, "Total due", anyOption(inv))
	help := "Scan the code or open the link. Send only " + inv.Symbol + " on " + networkOf(inv).name + "."
	if anyOption(inv) {
		d.heading("Pay with")
		d.SetFont(font, "", 10)
		for _, l := range accepted(inv) {
			d.CellFormat(width, lineHeight, l, "", 1, "L", false, 0, "")
		}
		d.text(muted)
		d.CellFormat(width, lineHeight, "Send only on these networks, 1 USD per token.", "", 1, "L", false, 0, "")
		d.text(ink)
		d.Ln(6)
		help = "Scan the code or open the link, then pick the token and network."
	}
	d.note(inv.Note)
	d.code(payLink, "Pay this invoice", help)
	d.footer(inv)
	return d.output()
}

func Receipt(inv invoice.Invoice, payLink string, logo []byte) ([]byte, error) {
	if inv.PaymentStatus != ledger.Paid {
		return nil, ErrNotPaid
	}
	// The payer's proof of payment: when and how they paid. Settling is the creator's business (R-61).
	d := start(inv, "Receipt", logo)
	d.facts([2]string{"Issued", stamp(inv.CreatedAt)}, [2]string{"Supply date", inv.SupplyDate},
		[2]string{"Paid", stamp(inv.PaidAt)})
	d.lines(inv, "Amount paid", false)

	net := networkOf(inv)
	d.heading("Payments")
	for _, dep := range inv.Deposits {
		// Only what was paid to the creator: late money and money over the amount are held for the payer (D-26, R-121).
		if dep.Paid != nil && dep.Paid.Sign() > 0 {
			d.transaction(net, Amount(dep.Paid, inv.Decimals, inv.Symbol)+" · "+stamp(dep.BlockTime), dep.TxHash)
		}
	}
	if inv.Amounts != nil && inv.Amounts.ObservedRefunded.Sign() > 0 {
		d.heading("Recorded returns")
		d.note(Amount(inv.Amounts.ObservedRefunded, inv.Decimals, inv.Symbol))
		if inv.Amounts.LastReturnTxHash != "" {
			d.transaction(net, "Latest return transaction", inv.Amounts.LastReturnTxHash)
		}
	}
	if inv.Amounts != nil && (inv.Amounts.Unreconciled || inv.Amounts.HasPolicyException) {
		d.note("Payment records need review.")
	}
	d.code(payLink, "Check this receipt", "A PDF can be edited. The pay page shows what the chain recorded.")
	d.footer(inv)
	return d.output()
}

type doc struct{ *fpdf.Fpdf }

func start(inv invoice.Invoice, kind string, logo []byte) doc {
	author := bmp(inv.SenderName)
	if inv.Issuer != nil {
		author = bmp(inv.Issuer.Name)
	}
	date := inv.CreatedAt
	if kind == "Receipt" {
		date = inv.PaidAt
	}
	d := open(kind, InvoiceNumber(inv), author, date, logo)
	// A forwarded PDF must not pass testnet tokens off as money (D-87).
	if !inv.Livemode {
		d.SetX(margin + width/2)
		d.SetFont(font, "B", 10)
		d.text(ink)
		d.CellFormat(width/2, lineHeight, TestMode, "", 1, "R", false, 0, "")
		d.SetFont(font, "", 10)
		d.text(subtle)
	}
	// The client's accounts team matches the invoice by it (R-90). Never cut: each line holds at least one byte.
	if text := "Reference " + inv.Reference; inv.Reference != "" {
		for _, l := range d.fit(text, width/2, len(text)) {
			d.SetX(margin + width/2)
			d.CellFormat(width/2, lineHeight, l, "", 1, "R", false, 0, "")
		}
	}
	d.Ln(4)
	if c, ok := hexColor(inv.BrandColor); ok {
		d.SetDrawColor(c[0], c[1], c[2])
		d.SetLineWidth(0.6)
		d.Line(margin, d.GetY(), margin+width, d.GetY())
	} else {
		d.rule()
	}
	d.Ln(6)

	// Side by side. Each block is cut to fit, so neither reaches the end of the page.
	top, bottom, x := d.GetY(), d.GetY(), margin
	if i := inv.Issuer; i != nil {
		tax := ""
		if i.TaxID != "" {
			tax = "Tax ID " + i.TaxID
		}
		bottom = max(bottom, d.party(x, top, "From", i.Name, i.Address, i.Country, tax, i.Email))
		x += width / 2
	} else if inv.SenderName != "" {
		bottom = max(bottom, d.party(x, top, "From", inv.SenderName, "Name not checked by Forwend"))
		x += width / 2
	}
	// Never the client's email: the PDF is public to anyone with the invoice id. A business client's tax ID belongs
	// on its invoice (VAT Directive art. 226).
	if inv.ClientName != "" || inv.ClientAddress != "" || inv.ClientCountry != "" || inv.ClientTaxID != "" {
		tax := ""
		if inv.ClientTaxID != "" {
			tax = "Tax ID " + inv.ClientTaxID
		}
		bottom = max(bottom, d.party(x, top, "Bill to", inv.ClientName, inv.ClientAddress, inv.ClientCountry, tax))
	}
	d.SetXY(margin, bottom+6)
	return d
}

// label is an invoice's number, if it has one, or a statement's period; logo replaces Forwend's mark and name when set.
func open(kind, label, author string, date time.Time, logo []byte) doc {
	name := strings.TrimSpace(kind + " " + label)
	d := doc{fpdf.New("P", "mm", "A4", "")}
	d.SetMargins(margin, margin, margin)
	d.SetAutoPageBreak(true, margin)
	d.SetCellMargin(0)
	d.AddUTF8FontFromBytes(font, "", regular)
	d.AddUTF8FontFromBytes(font, "B", bold)
	d.SetTitle(name, true)
	d.SetAuthor(author, true)
	d.SetCreator("Forwend", true)
	d.SetLang("en")
	d.SetCreationDate(date)
	d.SetModificationDate(date)
	d.SetCatalogSort(true)
	// Every page names the document and its place, so a printed page that comes loose is still traceable.
	d.AliasNbPages("{pages}")
	d.SetFooterFunc(func() {
		d.SetY(-margin + 6)
		d.SetFont(font, "", 8)
		d.text(subtle)
		d.CellFormat(width/2, lineHeight, name, "", 0, "L", false, 0, "")
		d.CellFormat(width/2, lineHeight, fmt.Sprintf("Page %d of {pages}", d.PageNo()), "", 0, "R", false, 0, "")
		d.text(ink)
	})
	d.AddPage()

	if logo != nil {
		// Fitted into the space Forwend's mark and name take, keeping its shape.
		opts := fpdf.ImageOptions{ImageType: "PNG"}
		info := d.RegisterImageOptionsReader("logo", opts, bytes.NewReader(logo))
		w, h := 50.0, 10.0
		if info != nil && info.Width()*h > info.Height()*w {
			h = w * info.Height() / info.Width()
		} else if info != nil {
			w = h * info.Width() / info.Height()
		}
		d.ImageOptions("logo", margin, margin, w, h, false, opts, 0, "")
	} else {
		d.color(ink)
		d.logo(margin, margin, 8)
		d.SetXY(margin+10.5, margin)
		d.SetFont(font, "B", 14)
		d.CellFormat(40, 8, "Forwend", "", 0, "L", false, 0, "")
	}
	d.SetXY(margin+width/2, margin-1)
	d.SetFont(font, "B", 20)
	d.CellFormat(width/2, 9, kind, "", 2, "R", false, 0, "")
	d.SetFont(font, "", 10)
	d.text(subtle)
	d.CellFormat(width/2, lineHeight, label, "", 1, "R", false, 0, "")
	return d
}

func (d doc) color(c [3]int) { d.SetFillColor(c[0], c[1], c[2]) }
func (d doc) text(c [3]int)  { d.SetTextColor(c[0], c[1], c[2]) }

// hexColor reads a store's "#rrggbb" (R-135).
func hexColor(s string) ([3]int, bool) {
	var c [3]int
	_, err := fmt.Sscanf(s, "#%02x%02x%02x", &c[0], &c[1], &c[2])
	return c, err == nil && len(s) == 7
}

func (d doc) rule() {
	d.SetDrawColor(line[0], line[1], line[2])
	d.SetLineWidth(0.3)
	d.Line(margin, d.GetY(), margin+width, d.GetY())
}

// logo draws the mark, size mm square, from its SVG path (only M and C commands, absolute).
func (d doc) logo(x, y, size float64) {
	const minX, minY, box = 117.2, 11.5, 1812.6
	f := strings.FieldsFunc(logoPath, func(r rune) bool { return r == ' ' || r == ',' || r == '\n' })
	num := func(i int) float64 { v, _ := strconv.ParseFloat(f[i], 64); return v }
	px := func(i int) (float64, float64) {
		return x + (num(i)-minX)*size/box, y + (num(i+1)-minY)*size/box
	}
	for i := 0; i < len(f); {
		switch f[i] {
		case "M":
			if i > 0 {
				d.ClosePath()
			}
			d.MoveTo(px(i + 1))
			i += 3
		case "C":
			i++
			for i+5 < len(f) && f[i] != "M" && f[i] != "C" {
				x1, y1 := px(i)
				x2, y2 := px(i + 2)
				x3, y3 := px(i + 4)
				d.CurveBezierCubicTo(x1, y1, x2, y2, x3, y3)
				i += 6
			}
		default:
			i++
		}
	}
	d.ClosePath()
	d.DrawPath("F")
}

func (d doc) party(x, y float64, heading, name string, details ...string) float64 {
	w := width/2 - 5
	d.SetXY(x, y)
	d.text(subtle)
	d.SetFont(font, "B", 8)
	d.CellFormat(w, lineHeight, strings.ToUpper(heading), "", 2, "L", false, 0, "")
	d.text(ink)
	d.SetFont(font, "B", 10)
	for _, l := range d.fit(name, w, 4) {
		d.CellFormat(w, lineHeight, l, "", 2, "L", false, 0, "")
	}
	d.SetFont(font, "", 10)
	d.text(muted)
	for _, text := range details {
		for _, l := range d.fit(text, w, 8) {
			d.CellFormat(w, lineHeight, l, "", 2, "L", false, 0, "")
		}
	}
	d.text(ink)
	return d.GetY()
}

// facts writes up to four label and value pairs in one row; an empty value leaves its pair out.
func (d doc) facts(pairs ...[2]string) {
	y, x, w := d.GetY(), margin, width/4
	for _, p := range pairs {
		if p[1] == "" {
			continue
		}
		d.SetXY(x, y)
		d.text(subtle)
		d.SetFont(font, "", 8.5)
		d.CellFormat(w, lineHeight, p[0], "", 2, "L", false, 0, "")
		d.text(ink)
		d.SetFont(font, "", 10)
		d.CellFormat(w, lineHeight, p[1], "", 2, "L", false, 0, "")
		x += w
	}
	d.SetXY(margin, y+2*lineHeight+6)
}

// lines is the invoice's line table (R-88), then the total.
func (d doc) lines(inv invoice.Invoice, total string, any bool) {
	cols := [3]float64{88, 42, 40}
	const pad = 3.0
	// With items the title no longer names the one line, so it heads the table.
	if len(inv.Lines) > 0 && inv.Title != "" {
		d.text(ink)
		d.SetFont(font, "B", 11)
		for _, l := range d.fit(inv.Title, width, 3) {
			d.CellFormat(width, 6, l, "", 1, "L", false, 0, "")
		}
		d.Ln(2)
	}
	d.color(surface)
	d.text(muted)
	d.SetFont(font, "B", 8.5)
	y := d.GetY()
	d.Rect(margin, y, width, 7, "F")
	x := margin
	for i, h := range []string{"Description", "Network", "Amount"} {
		align := "L"
		if i == 2 {
			align = "R"
		}
		d.SetXY(x+pad, y+1)
		d.CellFormat(cols[i]-2*pad, lineHeight, h, "", 0, align, false, 0, "")
		x += cols[i]
	}
	d.SetY(y + 7 + 2)

	d.SetFont(font, "", 10)
	net := networkOf(inv)
	network := append(d.fit(net.name, cols[1]-2*pad, 2), "Chain "+strconv.FormatUint(inv.ChainID, 10))
	symbol, decimals := inv.Symbol, inv.Decimals
	if any {
		// Every option is the same USD amount at 1 USD per stablecoin (D-75).
		network = []string{"Any"}
		symbol = "USD"
	}
	price := Amount(inv.Amount, decimals, symbol)
	type row struct {
		what  []string
		price string
	}
	title := inv.Title
	if title == "" {
		title = "Payment"
	}
	rows := []row{{d.fit(title, cols[0]-2*pad, 3), price}}
	if len(inv.Lines) > 0 {
		decimals, symbol := lineUnit(inv)
		rows = rows[:0]
		for _, l := range inv.Lines {
			// Never cut: each printed line holds at least one character.
			what := append(d.fit(l.Description, cols[0]-2*pad, invoice.MaxLineDescription),
				strings.TrimSuffix(strings.TrimSuffix(l.Quantity, "0"), ".0")+" × "+Amount(l.UnitPrice, decimals, symbol))
			rows = append(rows, row{what, Amount(l.Amount, decimals, symbol)})
		}
	}
	for r, item := range rows {
		cells := [3][]string{item.what, nil, d.fit(item.price, cols[2]-2*pad, 12)}
		if r == 0 {
			cells[1] = network
		}
		lines := max(len(cells[0]), len(cells[1]), len(cells[2]))
		d.pageFor(float64(lines)*lineHeight + 2)
		y, x = d.GetY(), margin
		for i, c := range cells {
			align := "L"
			if i == 2 {
				align = "R"
			}
			for j, l := range c {
				d.text(ink)
				d.SetFont(font, "", 10)
				// The chain id under the network, and the quantity under an item, are quieter.
				if (i == 1 && j == len(c)-1 && !any) || (i == 0 && len(inv.Lines) > 0 && j == len(c)-1) {
					d.text(subtle)
					d.SetFont(font, "", 8.5)
				}
				d.SetXY(x+pad, y+float64(j)*lineHeight)
				d.CellFormat(cols[i]-2*pad, lineHeight, l, "", 0, align, false, 0, "")
			}
			x += cols[i]
		}
		d.SetY(y + float64(lines)*lineHeight + 2)
	}
	d.rule()
	d.Ln(2)

	d.SetFont(font, "B", 11)
	d.text(ink)
	y = d.GetY()
	d.SetXY(margin+cols[0]+pad, y)
	d.CellFormat(cols[1]-2*pad, 6, total, "", 0, "L", false, 0, "")
	for _, l := range d.fit(price, cols[2]-2*pad, 12) { // never cut
		d.SetX(margin + cols[0] + cols[1] + pad)
		d.CellFormat(cols[2]-2*pad, 6, l, "", 1, "R", false, 0, "")
	}
	// The price agreed with the client in fiat (R-93), quietly under the total the invoice asks for, on its edge.
	if a := inv.Agreed; a != nil {
		d.Ln(2)
		d.text(muted)
		d.SetFont(font, "", 9)
		text := "Agreed value " + Amount(big.NewInt(a.Amount), a.Decimals, a.Currency) + " on " + a.Date
		d.CellFormat(width-pad, lineHeight, text, "", 1, "R", false, 0, "")
		d.text(ink)
	}
	d.Ln(6)
}

// lineUnit is what an invoice's lines (R-88) are in: the main option's base units, which can differ from the paid
// one's, named USD when the client chooses (D-75), on the receipt too.
func lineUnit(inv invoice.Invoice) (int, string) {
	for _, o := range inv.Options {
		if o.ID == inv.ID && anyOption(inv) {
			return o.Decimals, "USD"
		} else if o.ID == inv.ID {
			return o.Decimals, o.Symbol
		}
	}
	return inv.Decimals, inv.Symbol
}

func (d doc) heading(text string) {
	d.pageFor(3 * lineHeight)
	d.text(subtle)
	d.SetFont(font, "B", 8)
	d.CellFormat(width, lineHeight, strings.ToUpper(text), "", 1, "L", false, 0, "")
	d.text(ink)
	d.Ln(1)
}

func (d doc) note(text string) {
	if text == "" {
		return
	}
	d.heading("Note")
	d.SetFont(font, "", 10)
	d.text(muted)
	for _, l := range d.fit(text, width, 30) {
		d.pageFor(lineHeight)
		d.CellFormat(width, lineHeight, l, "", 1, "L", false, 0, "")
	}
	d.text(ink)
	d.Ln(6)
}

func (d doc) transaction(net network, what, hash string) {
	d.pageFor(3 * lineHeight)
	d.SetFont(font, "", 10)
	d.CellFormat(width, lineHeight, what, "", 1, "L", false, 0, "")
	if hash != "" {
		d.SetFont(mono, "", 8.5)
		d.text(muted)
		d.CellFormat(width, lineHeight, hash, "", 1, "L", false, 0, "")
		if net.explorer != "" {
			d.SetFont(font, "", 9)
			d.text(accent)
			d.CellFormat(width, lineHeight, "View on "+net.explorer, "", 1, "L", false, 0, net.url+"/tx/"+hash)
		}
		d.text(ink)
	}
	d.Ln(3)
}

func (d doc) code(link, title, help string) {
	const size, gap = 30.0, 6.0
	d.Ln(2)
	d.pageFor(size + 4)
	y := d.GetY()
	d.SetDrawColor(line[0], line[1], line[2])
	d.SetLineWidth(0.3)
	d.Rect(margin, y, width, size+8, "D")
	d.qr(link, margin+4, y+4, size)
	x, w := margin+4+size+gap, width-size-gap-8
	d.SetXY(x, y+5)
	d.SetFont(font, "B", 11)
	d.CellFormat(w, 6, title, "", 2, "L", false, 0, "")
	d.SetFont(font, "", 9.5)
	d.text(muted)
	for _, l := range d.fit(help, w, 2) {
		d.CellFormat(w, lineHeight, l, "", 2, "L", false, 0, "")
	}
	d.SetXY(x, d.GetY()+1)
	d.SetFont(font, "", 9)
	d.text(accent)
	for _, l := range d.fit(link, w, 3) {
		d.CellFormat(w, lineHeight, l, "", 2, "L", false, 0, link)
	}
	d.text(ink)
	d.SetXY(margin, y+size+8+6)
}

// qr draws the code's dark modules as filled runs; a scanner reads dark on light, so it is always ink on white.
func (d doc) qr(text string, x, y, size float64) {
	code, err := qr.Encode(text, qr.M, qr.Auto)
	if err != nil {
		d.SetError(fmt.Errorf("QR code: %w", err)) // output returns it
		return
	}
	n := code.Bounds().Dx()
	m := size / float64(n)
	d.color(ink)
	for row := range n {
		for col := 0; col < n; {
			if r, _, _, _ := code.At(col, row).RGBA(); r != 0 {
				col++
				continue
			}
			run := col
			for run < n {
				if r, _, _, _ := code.At(run, row).RGBA(); r != 0 {
					break
				}
				run++
			}
			d.Rect(x+float64(col)*m, y+float64(row)*m, float64(run-col)*m, m, "F")
			col = run
		}
	}
}

func (d doc) footer(inv invoice.Invoice) {
	d.pageFor(2 * lineHeight)
	d.rule()
	d.Ln(3)
	d.SetFont(font, "", 8.5)
	d.text(subtle)
	d.CellFormat(22, lineHeight, "Invoice ID", "", 0, "L", false, 0, "")
	d.SetFont(mono, "", 8)
	d.CellFormat(width-22, lineHeight, inv.ID, "", 1, "L", false, 0, "")
	d.text(ink)
}

func (d doc) pageFor(h float64) {
	if d.GetY()+h > pageHeight-margin {
		d.AddPage()
	}
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

// Amount writes base units exactly, with at least 2 decimals when the token has them: 1,250.00 USDC.
func Amount(n *big.Int, decimals int, symbol string) string {
	s := new(big.Rat).SetFrac(n, new(big.Int).Exp(big.NewInt(10), big.NewInt(int64(decimals)), nil)).FloatString(decimals)
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

func stamp(t time.Time) string {
	return t.UTC().Format("2006-01-02 15:04 UTC")
}
