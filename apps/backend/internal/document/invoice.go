package document

import (
	"errors"
	"math/big"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/forwend/forwend/apps/backend/internal/intents"
	"github.com/forwend/forwend/apps/backend/internal/invoice"
	"github.com/forwend/forwend/apps/backend/internal/ledger"
)

var ErrNotPaid = errors.New("invoice not paid")

// anyOption: several tokens and networks, so the invoice is priced in USD.
func anyOption(inv invoice.Invoice) bool {
	return len(inv.Options) > 1
}

// standing is the invoice's status in the app's words with the one amount that goes with it.
type standing struct {
	label, detail  string
	figure, amount string
	totals         [][2]string
	payable        bool     // only while the pay page shows the address
	closed         bool     // canceled or expired
	left           *big.Int // in the current option's token
}

func statusOf(inv invoice.Invoice, now time.Time) standing {
	total := Amount(inv.Amount, inv.Decimals, priced(inv))
	token := func(n *big.Int) string { return Amount(n, inv.Decimals, inv.Symbol) }
	closed := inv.Closed || inv.PaymentStatus == ledger.Expired || inv.PaymentStatus == ledger.ExpiredPartiallyPaid
	// As the pay page counts it: booked, plus confirming, or plus held once closed.
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
	s := standing{figure: "Amount due", amount: total, totals: [][2]string{{"Total", total}}, left: left}
	if f := inv.Fees; f.PaidBy == invoice.FeesPaidByClient && f.Net(inv.Amount).Cmp(inv.Amount) < 0 {
		unit := func(n *big.Int) string { return Amount(n, inv.Decimals, priced(inv)) }
		s.totals = [][2]string{{"Subtotal", unit(f.Net(inv.Amount))}}
		if f.Network.Sign() > 0 {
			s.totals = append(s.totals, [2]string{"Network fee", unit(f.Network)})
		}
		if f.Platform.Sign() > 0 {
			s.totals = append(s.totals, [2]string{"Platform fee", unit(f.Platform)})
		}
		s.totals = append(s.totals, [2]string{"Total", total})
	}
	switch {
	case inv.PaymentStatus == ledger.Paid:
		s.label, s.figure, s.amount = "Paid", "Amount paid", token(inv.Amount)
	case inv.PaymentStatus == ledger.Canceled:
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

// priced is the unit of the invoice's total: USD when the client chooses the token.
func priced(inv invoice.Invoice) string {
	if anyOption(inv) {
		return "USD"
	}
	return inv.Symbol
}

func payee(inv invoice.Invoice) string {
	switch {
	case inv.Issuer != nil:
		return inv.Issuer.Name
	case inv.SenderName != "":
		return inv.SenderName
	}
	return "the recipient"
}

// records mirrors the pay page: pending records matter only once money arrived.
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

// Invoice renders inv's PDF; logo is a PNG, nil for Forwend's mark; now decides Overdue.
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
	s := statusOf(inv, inv.PaidAt)
	d := start(inv, "Receipt", logo, s)
	d.facts([2]string{"Issued", day(inv.CreatedAt)}, [2]string{"Supply date", DateText(inv.SupplyDate)},
		[2]string{"Paid", stamp(inv.PaidAt)})
	d.fact("Paid with", paidWith(inv))
	d.items(inv, s.totals, "For reference only: the token amount above was paid.")
	d.payments(inv)
	d.code(payLink, "Check this receipt", "A PDF can be edited. The pay page shows what the chain recorded.")
	return d.output()
}

// paidWith is "" when 1Click didn't deliver, or the money was booked on another option first.
func paidWith(inv invoice.Invoice) string {
	c := inv.CrossChain
	if c == nil || c.Status != intents.Success || c.OptionID != inv.OptionID {
		return ""
	}
	sent := c.Deposited
	if sent == nil {
		sent = c.AmountIn
	}
	return PaidWith(sent, c.Decimals, c.Symbol, c.Blockchain)
}

// payments lists every transfer on any option with the part the ledger applied; the rest is held or returned.
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

	split := false
	for _, tr := range transfers {
		split = split || tr.Paid == nil || tr.Paid.Cmp(tr.Amount) != 0
	}
	// Per token and network: applied + held + returned = received.
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

// booked is all money booked to the option, wherever it went since: owed, held, settled, fees or returned.
func booked(a *ledger.Amounts) *big.Int {
	n := new(big.Int)
	if a != nil {
		n.Add(a.Payable, a.Held)
		n.Add(n, a.Settled)
		n.Add(n, a.Fees)
		n.Add(n, a.Refunded)
	}
	return n
}

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
	// Never cut: the client's accounts team matches the invoice by it.
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
	if !inv.Livemode {
		d.testnet()
	}
	d.summary(s)

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
	// Never the client's email: the PDF is public to anyone with the invoice id.
	// A business client's tax ID belongs on its invoice (VAT Directive art. 226).
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

func (d doc) summary(s standing) {
	const pad, mark, textW = 5.0, 2.4, 92.0
	textX := margin + pad + mark + 2.6
	amountW := margin + width - pad - (textX + textW + 6)
	d.SetFont(font, "", 9.5)
	detail := d.fit(s.detail, textW, 6)
	// A huge amount shrinks, then wraps; it is never cut.
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

// items is the line table, or one row without lines, then its totals; totals never start a page alone.
func (d doc) items(inv invoice.Invoice, totals [][2]string, agreedNote string) {
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

// lineUnit: lines are in the main option's base units, which can differ from the paid option's.
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
