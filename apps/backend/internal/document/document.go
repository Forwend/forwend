// Package document renders invoices, receipts and income statements as PDFs (R-47, R-61, R-112, D-51). Nothing is
// read from the network or disk, and the same input always gives the same bytes.
package document

import (
	"bytes"
	_ "embed"
	"errors"
	"fmt"
	"math/big"
	"slices"
	"strconv"
	"strings"
	"time"

	"codeberg.org/go-pdf/fpdf"
	"github.com/boombuler/barcode/qr"

	"github.com/forwend/forwend/apps/backend/internal/invoice"
	"github.com/forwend/forwend/apps/backend/internal/ledger"
)

var ErrNotPaid = errors.New("invoice not paid")

// Noto Sans covers Latin with its accents, Greek and Cyrillic, and its digits share one width, so amounts line up;
// the license is fonts/OFL.txt.
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
	rowLine    = 4.6 // a table line, set in 9.5 pt
	rowPad     = 2.2
	gutter     = 4.0 // between table columns
	font       = "Noto"
	mono       = "Courier" // a core font: hashes and addresses are ASCII
)

// The product's light theme (packages/design-tokens/src/tokens.css): near-black ink and neutral greys, so a page
// prints the same in black and white. Lime only marks the status.
var (
	ink      = [3]int{0x0e, 0x0f, 0x0e}
	muted    = [3]int{0x5b, 0x5e, 0x5a}
	subtle   = [3]int{0x67, 0x6a, 0x66}
	line     = [3]int{0xcb, 0xcd, 0xc8}
	faint    = [3]int{0xe8, 0xe9, 0xe6}
	surface  = [3]int{0xf6, 0xf7, 0xf5}
	accent   = [3]int{0x4f, 0x6a, 0x07}
	lime     = [3]int{0xc9, 0xef, 0x5f}
	limeEdge = [3]int{0xa9, 0xcf, 0x3c}
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

// NetworkName is the chain's name as the app shows it, "Chain <id>" for one the app doesn't name either.
func NetworkName(chainID uint64) string {
	if n, ok := networks[chainID]; ok {
		return n.name
	}
	return "Chain " + strconv.FormatUint(chainID, 10)
}

// anyOption: the invoice accepts several tokens and networks, so it is priced in USD (R-56, R-70).
func anyOption(inv invoice.Invoice) bool {
	return len(inv.Options) > 1
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

// standing is the invoice's status in the app's words (D-114) with the one amount that goes with it. payable is true
// only while the pay page would still show the address, so a PDF never asks for money that can't be paid.
type standing struct {
	label, detail  string
	figure, amount string
	totals         [][2]string // under the line table
	payable        bool
	closed         bool     // canceled or expired: the status mark is grey
	left           *big.Int // in the current option's token
}

func statusOf(inv invoice.Invoice, now time.Time) standing {
	total := Amount(inv.Amount, inv.Decimals, priced(inv))
	token := func(n *big.Int) string { return Amount(n, inv.Decimals, inv.Symbol) }
	closed := inv.Closed || inv.PaymentStatus == ledger.Expired || inv.PaymentStatus == ledger.ExpiredPartiallyPaid
	// As the pay page counts it: booked to the creator, plus money still confirming, or held once the checkout closed.
	received := new(big.Int)
	if a := inv.Amounts; a != nil {
		received.Set(a.Payable)
		if closed {
			received.Add(received, a.Held)
		} else if inv.DepositSummary != nil {
			received.Add(received, inv.DepositSummary.PendingAmount)
		}
	}
	left := new(big.Int).Sub(inv.Amount, received)
	if left.Sign() < 0 {
		left.SetInt64(0)
	}
	// Each fact once: the dates row has the dates, so the box never repeats them; the totals grow only once money arrived.
	s := standing{figure: "Amount due", amount: total, totals: [][2]string{{"Total", total}}, left: left}
	switch {
	case inv.PaymentStatus == ledger.Paid:
		s.label, s.figure, s.amount = "Paid", "Amount paid", token(inv.Amount)
	case inv.PaymentStatus == ledger.Canceled:
		// A canceled invoice keeps its number and PDF as a record (D-79), and never asks for money again.
		s.label, s.figure, s.closed = "Canceled", "Total", true
		s.detail = payee(inv) + " canceled this invoice. Do not send money."
	case closed && received.Sign() > 0:
		s.label, s.figure, s.amount, s.closed = "Expired, partially paid", "Received", token(received), true
		s.detail = "The payment window closed before the full amount arrived. The money sent is held for the payer, " +
			"not paid out. Need help on the pay page says how to get it back."
	case closed:
		s.label, s.figure, s.closed = "Expired", "Total", true
		s.detail = "The payment window closed without payment. Do not pay this invoice."
	default:
		s.label = "Waiting for payment"
		switch {
		case inv.Confirming || inv.PaymentStatus == ledger.Detected:
			s.label, s.detail = "Confirming", "A payment arrived and is waiting for network confirmation."
		case inv.PaymentStatus == ledger.PartiallyPaid:
			s.label = "Partially paid"
		case inv.DueDate != "" && inv.DueDate < now.UTC().Format(time.DateOnly):
			s.label = "Overdue"
		}
		if received.Sign() > 0 {
			s.figure, s.amount = "Left to pay", token(left)
			s.totals = append(s.totals, [2]string{"Received", token(received)}, [2]string{"Left to pay", s.amount})
		}
		s.payable = left.Sign() > 0 && records(inv) == ""
		if note := records(inv); note != "" {
			s.detail = strings.TrimSpace(s.detail + " " + note + " Send nothing more until the pay page shows what is left.")
		}
	}
	return s
}

// priced is the unit of the invoice's total: USD when the client chooses the token (D-75).
func priced(inv invoice.Invoice) string {
	if anyOption(inv) {
		return "USD"
	}
	return inv.Symbol
}

// payee is who asked for the money, as the pay page names them.
func payee(inv invoice.Invoice) string {
	switch {
	case inv.Issuer != nil:
		return inv.Issuer.Name
	case inv.SenderName != "":
		return inv.SenderName
	}
	return "the recipient"
}

// records is "" unless the payment records need checking, as the pay page decides it: an invoice is pending until
// its first scan, which matters only once money arrived.
func records(inv invoice.Invoice) string {
	switch a := inv.Amounts; {
	case a == nil:
		return ""
	case a.ReconciliationStatus == ledger.ReconciliationReview:
		return "Payment records need review."
	case a.ReconciliationStatus == ledger.ReconciliationPending && len(inv.Deposits) > 0:
		return "Payment history verification is pending."
	}
	return ""
}

// logo is the invoice's store logo, a PNG the API encoded (R-135); nil shows Forwend's. now decides Overdue.
func Invoice(inv invoice.Invoice, payLink string, logo []byte, now time.Time) ([]byte, error) {
	s := statusOf(inv, now)
	d := start(inv, "Invoice", logo, s)
	due, last := [2]string{"Due date", DateText(inv.DueDate)}, [2]string{"Payment window closes", stamp(inv.ClosesAt)}
	switch {
	case inv.PaymentStatus == ledger.Canceled:
		due, last = [2]string{}, [2]string{"Canceled", stamp(inv.CanceledAt)}
	case inv.PaymentStatus == ledger.Paid:
		last = [2]string{"Paid", stamp(inv.PaidAt)}
	case s.closed:
		last[0] = "Payment window closed"
	}
	d.facts([2]string{"Issued", day(inv.CreatedAt)}, [2]string{"Supply date", DateText(inv.SupplyDate)}, due, last)
	agreed := "For reference only: the invoice is in the token amount above."
	if s.payable {
		agreed = "For reference only: pay the token amount above."
	}
	d.items(inv, s.totals, agreed)
	d.note(inv.Note)
	if s.payable {
		d.code(payLink, "Pay this invoice", payment(inv, s)...)
	}
	return d.output()
}

func payment(inv invoice.Invoice, s standing) []string {
	if anyOption(inv) && !inv.OptionLocked {
		return []string{
			"Pay " + s.amount + " in one of the available options.",
			"Scan the code or open the link, then pick the token and network.",
		}
	}
	net := NetworkName(inv.ChainID)
	return []string{
		"Send exactly " + Amount(s.left, inv.Decimals, inv.Symbol) + " on " + net + " (chain ID " +
			strconv.FormatUint(inv.ChainID, 10) + ").",
		inv.Symbol + " contract " + inv.Token,
		"Scan the code or open the link. Send only " + inv.Symbol + " on " + net + ".",
	}
}

func Receipt(inv invoice.Invoice, payLink string, logo []byte) ([]byte, error) {
	if inv.PaymentStatus != ledger.Paid {
		return nil, ErrNotPaid
	}
	// The payer's proof of payment: when and how they paid. Settling is the creator's business (R-61).
	s := statusOf(inv, inv.PaidAt)
	d := start(inv, "Receipt", logo, s)
	d.facts([2]string{"Issued", day(inv.CreatedAt)}, [2]string{"Supply date", DateText(inv.SupplyDate)},
		[2]string{"Paid", stamp(inv.PaidAt)})
	d.items(inv, s.totals, "For reference only: the token amount above was paid.")
	d.payments(inv)
	d.code(payLink, "Check this receipt", "A PDF can be edited. The pay page shows what the chain recorded.")
	return d.output()
}

// payments lists every transfer on any option of the invoice, with the part the ledger applied to it (R-121); the
// rest is held for the payer or returned to them (D-26).
func (d doc) payments(inv invoice.Invoice) {
	type transfer struct {
		invoice.Deposit
		option invoice.Option
	}
	var transfers []transfer
	var received []invoice.Option
	preview := false
	for _, o := range inv.Options {
		for _, dep := range o.Deposits {
			transfers = append(transfers, transfer{dep, o})
		}
		if o.DepositSummary != nil && o.DepositSummary.Count > int64(len(o.Deposits)) {
			preview = true
		}
		if booked(o.Amounts).Sign() > 0 {
			received = append(received, o)
		}
	}
	slices.SortStableFunc(transfers, func(a, b transfer) int { return a.BlockTime.Compare(b.BlockTime) })

	// A transfer's Applied column only says something when it differs from what the transfer brought.
	split := false
	for _, tr := range transfers {
		split = split || tr.Paid == nil || tr.Paid.Cmp(tr.Amount) != 0
	}
	// What the ledger did with the money, per token and network: applied, held or returned add up to received.
	// Transfers applied whole need none of it: their rows say it all.
	var totals [][2]string
	var returns []invoice.Option
	for _, o := range received {
		suffix := ""
		if len(received) > 1 {
			suffix = " · " + o.Symbol + " on " + NetworkName(o.ChainID)
		}
		money := func(n *big.Int) string { return Amount(n, o.Decimals, o.Symbol) }
		if split {
			totals = append(totals, [2]string{"Received" + suffix, money(booked(o.Amounts))})
			if o.ID == inv.OptionID {
				totals = append(totals, [2]string{"Applied to this invoice" + suffix, money(inv.Amount)})
			}
		}
		if o.Amounts.Held.Sign() > 0 {
			totals = append(totals, [2]string{"Held for payer" + suffix, money(o.Amounts.Held)})
		}
		if o.Amounts.Refunded.Sign() > 0 {
			totals = append(totals, [2]string{"Returned to payer" + suffix, money(o.Amounts.Refunded)})
			if o.Amounts.LastReturnTxHash != "" {
				returns = append(returns, o)
			}
		}
	}

	t := table{d: d, cols: []float64{34, 46, 45, 45}, heads: []string{"Date (UTC)", "Network", "Received", "Applied"},
		right: 2}
	if !split {
		t.cols, t.heads = []float64{34, 91, 45}, []string{"Date (UTC)", "Network", "Amount"}
	}
	d.SetFont(font, "", 9.5)
	cells := func(tr transfer) [][]string {
		row := [][]string{{tr.BlockTime.UTC().Format("2 Jan 2006, 15:04")}, d.fit(NetworkName(tr.option.ChainID), t.w(1), 2),
			d.fit(Amount(tr.Amount, tr.option.Decimals, tr.option.Symbol), t.w(2), 12)}
		if !split {
			return row
		}
		applied := "Pending"
		if tr.Paid != nil {
			applied = Amount(tr.Paid, tr.option.Decimals, tr.option.Symbol)
		}
		return append(row, d.fit(applied, t.w(3), 12))
	}
	// The totals and returns stay with the last transfer, like a line table's totals.
	end := 2 + d.totalsHeight(totals) + float64(len(returns))*(2*rowLine+2)
	first := end
	if len(transfers) > 0 {
		first = height(cells(transfers[0])) + rowLine
	}
	if len(transfers) == 1 {
		first += end
	}
	d.pageFor(lineHeight + 1 + headerHeight + first)
	heading := "Payments received"
	if len(transfers) == 1 {
		heading = "Payment received"
	}
	d.heading(heading)
	t.header()
	for i, tr := range transfers {
		row := cells(tr)
		need := height(row) + rowLine
		if i == len(transfers)-1 {
			need += end
		}
		t.room(need)
		d.text(ink)
		d.SetFont(font, "", 9.5)
		under := t.row(row, rowLine)
		next := d.GetY()
		d.hash(under, tr.option.ChainID, tr.TxHash)
		d.SetY(next)
		if i < len(transfers)-1 {
			d.hairline(faint)
		}
	}
	d.hairline(line)
	if len(totals) > 0 {
		d.Ln(2)
		d.totals(totals, 90, false)
	}
	for _, o := range returns {
		d.Ln(2)
		d.SetFont(font, "", 8.5)
		d.text(muted)
		d.CellFormat(width, rowLine, "Latest return to the payer, on "+NetworkName(o.ChainID), "", 1, "L", false, 0, "")
		y := d.GetY()
		d.hash(y, o.ChainID, o.Amounts.LastReturnTxHash)
		d.SetY(y + rowLine)
	}
	d.Ln(6)
	if preview {
		d.note("Selected payment transactions are shown. The amount paid includes all credited transfers.")
	}
	d.note(records(inv))
}

// booked is every transfer the ledger booked to the option, wherever the money went since: still owed, held,
// settled or returned. Payments counts received money the same way.
func booked(a *ledger.Amounts) *big.Int {
	n := new(big.Int)
	if a != nil {
		n.Add(a.Payable, a.Held)
		n.Add(n, a.Settled)
		n.Add(n, a.Refunded)
	}
	return n
}

type doc struct{ *fpdf.Fpdf }

func start(inv invoice.Invoice, kind string, logo []byte, s standing) doc {
	author := bmp(inv.SenderName)
	if inv.Issuer != nil {
		author = bmp(inv.Issuer.Name)
	}
	date := inv.CreatedAt
	if kind == "Receipt" {
		date = inv.PaidAt
	}
	d := open(kind, InvoiceNumber(inv), author, date, logo, !inv.Livemode, inv.ID)
	// The client's accounts team matches the invoice by it (R-90). Never cut: each line holds at least one byte.
	d.SetFont(font, "", 9)
	d.text(muted)
	if text := "Reference " + inv.Reference; inv.Reference != "" {
		for _, l := range d.fit(text, width/2, len(text)) {
			d.SetX(margin + width/2)
			d.CellFormat(width/2, lineHeight, l, "", 1, "R", false, 0, "")
		}
	}
	d.text(ink)
	d.SetY(max(d.GetY(), margin+10) + 5)
	if c, ok := hexColor(inv.BrandColor); ok {
		d.SetDrawColor(c[0], c[1], c[2])
		d.SetLineWidth(0.6)
		d.Line(margin, d.GetY(), margin+width, d.GetY())
	} else {
		d.rule()
	}
	d.Ln(7)
	// A forwarded PDF must not pass testnet tokens off as money (D-87).
	if !inv.Livemode {
		y := d.GetY()
		d.color(surface)
		d.Rect(margin, y, width, 9, "F")
		d.SetXY(margin+5, y+2)
		d.SetFont(font, "B", 8)
		d.CellFormat(18, lineHeight, "Testnet", "", 0, "L", false, 0, "")
		d.SetFont(font, "", 9)
		d.CellFormat(width-28, lineHeight, TestMode, "", 0, "L", false, 0, "")
		d.SetY(y + 9 + 5)
	}
	d.summary(s)

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
		bottom = max(bottom, d.party(x, top, "From", inv.SenderName))
		x += width / 2
	}
	// Never the client's email: the PDF is public to anyone with the invoice id. A business client's tax ID belongs
	// on its invoice (VAT Directive art. 226).
	if inv.ClientName != "" || inv.ClientAddress != "" || inv.ClientCountry != "" || inv.ClientTaxID != "" {
		tax := ""
		if inv.ClientTaxID != "" {
			tax = "Tax ID " + inv.ClientTaxID
		}
		bottom = max(bottom, d.party(x, top, "Billed to", inv.ClientName, inv.ClientAddress, inv.ClientCountry, tax))
	}
	if bottom > top {
		bottom += 6
	}
	d.SetXY(margin, bottom)
	return d
}

// label is an invoice's number, if it has one, or a statement's period; logo replaces Forwend's mark and name when set.
// Every page's footer says test mode when test, and the invoice id when id is set.
func open(kind, label, author string, date time.Time, logo []byte, test bool, id string) doc {
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
	foot := name
	if test {
		foot += " · Test mode"
	}
	d.SetFooterFunc(func() {
		d.SetY(-margin + 6)
		d.SetFont(font, "", 7.5)
		d.text(subtle)
		// Left-aligned: fpdf measures the alias, not the page count that replaces it, so right-aligned text would drift.
		d.CellFormat(width/2, lineHeight, fmt.Sprintf("%s · Page %d of {pages}", foot, d.PageNo()), "", 0, "L", false, 0, "")
		if id != "" {
			d.SetFont(mono, "", 6.5)
			d.CellFormat(width/2, lineHeight, "ID "+id, "", 0, "R", false, 0, "")
		}
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
		d.logo(margin, margin+0.5, 7.5)
		d.SetXY(margin+10, margin+0.25)
		d.SetFont(font, "B", 13)
		d.text(ink)
		d.CellFormat(40, 8, "Forwend", "", 0, "L", false, 0, "")
	}
	d.SetXY(margin+width/2, margin-1.5)
	d.SetFont(font, "B", 22)
	d.text(ink)
	d.CellFormat(width/2, 10, kind, "", 2, "R", false, 0, "")
	d.SetFont(font, "", 10)
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

func (d doc) rule() { d.hairline(line) }

func (d doc) hairline(c [3]int) {
	d.SetDrawColor(c[0], c[1], c[2])
	d.SetLineWidth(0.2)
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

// summary is the status panel under the header: the invoice's state and the amount that matters now.
func (d doc) summary(s standing) {
	const pad, mark, textW = 5.0, 2.4, 92.0
	textX := margin + pad + mark + 2.6
	amountW := margin + width - pad - (textX + textW + 6)
	d.SetFont(font, "", 9.5)
	detail := d.fit(s.detail, textW, 6)
	// A huge amount gets a smaller size, then wraps; it is never cut.
	size := 17.0
	d.SetFont(font, "B", size)
	for size > 10 && d.GetStringWidth(s.amount) > amountW {
		size--
		d.SetFontSize(size)
	}
	amount := d.fit(s.amount, amountW, 12)
	step := size * 0.3528 * 1.2
	h := 2*pad + max(6.5+float64(len(detail))*rowLine, 5+float64(len(amount))*step) - 1

	d.pageFor(h)
	y := d.GetY()
	d.SetDrawColor(line[0], line[1], line[2])
	d.SetLineWidth(0.2)
	d.RoundedRect(margin, y, width, h, 2.5, "1234", "D")
	fill, edge := lime, limeEdge
	if s.closed {
		fill, edge = faint, line
	}
	d.color(fill)
	d.SetDrawColor(edge[0], edge[1], edge[2])
	d.Rect(margin+pad, y+pad+1.6, mark, mark, "FD")
	d.text(ink)
	d.SetFont(font, "B", 12)
	d.SetXY(textX, y+pad-0.2)
	d.CellFormat(textW, 6, s.label, "", 2, "L", false, 0, "")
	d.SetFont(font, "", 9.5)
	d.text(muted)
	d.SetY(y + pad + 6.5)
	for _, l := range detail {
		d.SetX(textX)
		d.CellFormat(textW, rowLine, l, "", 2, "L", false, 0, "")
	}
	right := margin + width - pad - amountW
	d.SetXY(right, y+pad-0.5)
	d.SetFont(font, "B", 7.5)
	d.text(subtle)
	d.CellFormat(amountW, lineHeight, s.figure, "", 2, "R", false, 0, "")
	d.SetFont(font, "B", size)
	d.text(ink)
	d.SetY(y + pad + 5)
	for _, l := range amount {
		d.SetX(right)
		d.CellFormat(amountW, step, l, "", 2, "R", false, 0, "")
	}
	d.SetXY(margin, y+h+6)
}

// party is a From or Billed to block; empty details are left out, so no label stands alone.
func (d doc) party(x, y float64, heading, name string, details ...string) float64 {
	w := width/2 - 5
	d.SetXY(x, y)
	d.text(subtle)
	d.SetFont(font, "B", 7.5)
	d.CellFormat(w, lineHeight, heading, "", 2, "L", false, 0, "")
	d.SetY(d.GetY() + 0.5)
	d.text(ink)
	d.SetFont(font, "B", 10)
	for _, l := range d.fit(name, w, 4) {
		d.SetX(x)
		d.CellFormat(w, lineHeight, l, "", 2, "L", false, 0, "")
	}
	d.SetFont(font, "", 9.5)
	d.text(muted)
	for _, text := range details {
		for _, l := range d.fit(text, w, 8) {
			d.SetX(x)
			d.CellFormat(w, rowLine, l, "", 2, "L", false, 0, "")
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
		d.SetFont(font, "", 8)
		d.CellFormat(w, lineHeight, p[0], "", 2, "L", false, 0, "")
		d.text(ink)
		d.SetFont(font, "", 9.5)
		d.CellFormat(w, lineHeight, p[1], "", 2, "L", false, 0, "")
		x += w
	}
	d.SetXY(margin, y+2*lineHeight+6)
}

// table draws rows under a header that repeats on every page the table continues on. Columns from right on are
// right-aligned.
type table struct {
	d     doc
	cols  []float64
	heads []string
	right int
}

const headerHeight = lineHeight + 1

func (t table) align(i int) string {
	if i >= t.right {
		return "R"
	}
	return "L"
}

// x is where column i's text starts: a gutter separates columns, none sits at the page's edges.
func (t table) x(i int) float64 {
	x := margin
	for _, c := range t.cols[:i] {
		x += c
	}
	if i > 0 {
		x += gutter / 2
	}
	return x
}

func (t table) w(i int) float64 {
	w := t.cols[i]
	if i > 0 {
		w -= gutter / 2
	}
	if i < len(t.cols)-1 {
		w -= gutter / 2
	}
	return w
}

func (t table) header() {
	d := t.d
	y := d.GetY()
	d.SetFont(font, "B", 7.5)
	d.text(subtle)
	for i, h := range t.heads {
		d.SetXY(t.x(i), y)
		d.CellFormat(t.w(i), lineHeight, h, "", 0, t.align(i), false, 0, "")
	}
	d.SetY(y + headerHeight)
	d.hairline(line)
	d.text(ink)
}

// room starts a new page, under the header again, unless h more mm fit on this one.
func (t table) room(h float64) {
	if t.d.GetY()+h > pageHeight-margin {
		t.d.AddPage()
		t.header()
	}
}

func height(cells [][]string) float64 {
	n := 0
	for _, c := range cells {
		n = max(n, len(c))
	}
	return float64(n)*rowLine + 2*rowPad
}

// row writes each column's lines from the row's top and leaves extra mm under them; it returns where that space
// starts.
func (t table) row(cells [][]string, extra float64) float64 {
	d := t.d
	top := d.GetY() + rowPad
	n := 0
	for i, c := range cells {
		for j, l := range c {
			d.SetXY(t.x(i), top+float64(j)*rowLine)
			d.CellFormat(t.w(i), rowLine, l, "", 0, t.align(i), false, 0, "")
		}
		n = max(n, len(c))
	}
	under := top + float64(n)*rowLine
	d.SetY(under + extra + rowPad)
	return under
}

func (d doc) hash(y float64, chainID uint64, txHash string) {
	link := TxURL(chainID, txHash)
	d.SetXY(margin, y)
	d.SetFont(mono, "", 7)
	d.text(muted)
	d.CellFormat(width-30, rowLine, txHash, "", 0, "L", false, 0, link)
	if n := networks[chainID]; link != "" {
		d.SetFont(font, "", 8)
		d.text(accent)
		d.SetXY(margin+width-30, y)
		d.CellFormat(30, rowLine, "View on "+n.explorer, "", 0, "R", false, 0, link)
	}
	d.text(ink)
}

// items is the line table (R-88), or one row without lines, then its totals; the last row moves to the totals' page,
// so they never start a page alone.
func (d doc) items(inv invoice.Invoice, totals [][2]string, agreedNote string) {
	// With items the title no longer names the one line, so it heads the table.
	var heading []string
	if len(inv.Lines) > 0 && inv.Title != "" {
		d.SetFont(font, "B", 11)
		heading = d.fit(inv.Title, width, 3)
	}
	d.SetFont(font, "", 9.5)
	var t table
	var rows [][][]string
	if len(inv.Lines) == 0 {
		t = table{d: d, cols: []float64{125, 45}, heads: []string{"Description", "Amount"}, right: 1}
		title := inv.Title
		if title == "" {
			title = "Payment"
		}
		rows = [][][]string{{d.fit(title, t.w(0), 3), d.fit(totals[0][1], t.w(1), 12)}}
	} else {
		t = table{d: d, cols: []float64{87, 19, 32, 32}, heads: []string{"Description", "Qty", "Unit price", "Amount"},
			right: 1}
		decimals, symbol := lineUnit(inv)
		for _, l := range inv.Lines {
			qty := strings.TrimSuffix(strings.TrimSuffix(l.Quantity, "0"), ".0")
			// Never cut: each printed line holds at least one character.
			rows = append(rows, [][]string{d.fit(l.Description, t.w(0), invoice.MaxLineDescription), d.fit(qty, t.w(1), 3),
				d.fit(Amount(l.UnitPrice, decimals, symbol), t.w(2), 12), d.fit(Amount(l.Amount, decimals, symbol), t.w(3), 12)})
		}
	}
	end := d.totalsHeight(totals) + 1
	if inv.Agreed != nil {
		end += 3 + 2*4.2
	}
	// The title and header start a page only with the first row, and with the totals when that row is the last.
	first := height(rows[0])
	if len(rows) == 1 {
		first += end
	}
	d.pageFor(float64(len(heading))*6 + 2 + headerHeight + first)
	d.text(ink)
	d.SetFont(font, "B", 11)
	for _, l := range heading {
		d.CellFormat(width, 6, l, "", 1, "L", false, 0, "")
	}
	if heading != nil {
		d.Ln(2)
	}
	t.header()
	for i, r := range rows {
		need := height(r)
		if i == len(rows)-1 {
			need += end
		}
		t.room(need)
		d.text(ink)
		d.SetFont(font, "", 9.5)
		t.row(r, 0)
		if i < len(rows)-1 {
			d.hairline(faint)
		}
	}
	d.hairline(line)
	d.Ln(1)
	d.totals(totals, 84, true)
	// The price agreed with the client in fiat (R-93), quietly under the total the invoice asks for.
	if a := inv.Agreed; a != nil {
		d.Ln(2)
		d.text(muted)
		d.SetFont(font, "", 8.5)
		text := "Agreed value " + Amount(big.NewInt(a.Amount), a.Decimals, a.Currency) + " on " + a.Date
		d.CellFormat(width, 4.2, text, "", 1, "R", false, 0, "")
		d.text(subtle)
		d.CellFormat(width, 4.2, agreedNote, "", 1, "R", false, 0, "")
		d.text(ink)
	}
	d.Ln(6)
}

func (d doc) totalsHeight(rows [][2]string) float64 {
	h := 0.0
	d.SetFont(font, "B", 10.5)
	for _, r := range rows {
		h += float64(len(d.fit(r[1], 44, 12)))*lineHeight + 1.2
	}
	return h
}

// totals are label and amount rows in the right w mm, amounts on the right edge; with strong the last one is bold.
func (d doc) totals(rows [][2]string, w float64, strong bool) {
	x := margin + width - w
	for i, r := range rows {
		style, size := "", 9.5
		if strong && i == len(rows)-1 {
			style, size = "B", 10.5
		}
		d.SetFont(font, style, size)
		value := d.fit(r[1], 44, 12) // never cut
		d.pageFor(float64(len(value)) * lineHeight)
		y := d.GetY() + 0.6
		d.text(muted)
		if style == "B" {
			d.text(ink)
		}
		d.SetXY(x, y)
		d.CellFormat(w-46, lineHeight, r[0], "", 0, "L", false, 0, "")
		d.text(ink)
		for j, l := range value {
			d.SetXY(margin+width-44, y+float64(j)*lineHeight)
			d.CellFormat(44, lineHeight, l, "", 0, "R", false, 0, "")
		}
		d.SetY(y + float64(len(value))*lineHeight + 0.6)
	}
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
	d.SetFont(font, "B", 7.5)
	d.CellFormat(width, lineHeight, text, "", 1, "L", false, 0, "")
	d.text(ink)
	d.Ln(1)
}

func (d doc) note(text string) {
	if text == "" {
		return
	}
	d.heading("Note")
	d.SetFont(font, "", 9.5)
	d.text(muted)
	for _, l := range d.fit(text, width, 30) {
		d.pageFor(lineHeight)
		d.CellFormat(width, lineHeight, l, "", 1, "L", false, 0, "")
	}
	d.text(ink)
	d.Ln(6)
}

// code is a box with the link's QR code, the title and lines beside it, the first line in ink, then the link.
func (d doc) code(link, title string, lines ...string) {
	const size, pad, gap = 28.0, 4.5, 7.0
	x, w := margin+pad+size+gap, width-2*pad-size-gap
	d.SetFont(font, "", 9.5)
	var text [][]string
	n := 0
	for _, l := range lines {
		text = append(text, d.fit(l, w, 6))
		n += len(text[len(text)-1])
	}
	d.SetFont(font, "", 8.5)
	url := d.fit(link, w, 3)
	h := 2*pad + max(size, 6.5+float64(n)*rowLine+1.5+float64(len(url))*4.2)
	d.pageFor(h)
	y := d.GetY()
	d.SetDrawColor(line[0], line[1], line[2])
	d.SetLineWidth(0.2)
	d.RoundedRect(margin, y, width, h, 2.5, "1234", "D")
	d.qr(link, margin+pad, y+pad, size)
	d.SetXY(x, y+pad-0.5)
	d.SetFont(font, "B", 11)
	d.text(ink)
	d.CellFormat(w, 6.5, title, "", 2, "L", false, 0, "")
	d.SetFont(font, "", 9.5)
	for i, ls := range text {
		d.text(muted)
		if i == 0 {
			d.text(ink)
		}
		for _, l := range ls {
			d.SetX(x)
			d.CellFormat(w, rowLine, l, "", 2, "L", false, 0, "")
		}
	}
	d.SetXY(x, d.GetY()+1.5)
	d.SetFont(font, "", 8.5)
	d.text(accent)
	for _, l := range url {
		d.SetX(x)
		d.CellFormat(w, 4.2, l, "", 2, "L", false, 0, link)
	}
	d.text(ink)
	d.SetXY(margin, y+h+6)
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

// Day before month name, so no reader confuses 03/04 for March or April.
func stamp(t time.Time) string {
	return t.UTC().Format("2 Jan 2006, 15:04 UTC")
}

func day(t time.Time) string {
	return t.UTC().Format("2 Jan 2006")
}

// DateText writes a stored YYYY-MM-DD as day() does; "" stays "" so its fact is left out.
func DateText(s string) string {
	t, err := time.Parse(time.DateOnly, s)
	if err != nil {
		return s
	}
	return day(t)
}
