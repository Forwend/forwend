package document

import (
	"math/big"
	"strconv"
	"strings"
	"time"

	"github.com/ensp1re/forwend/apps/backend/internal/profile"
)

// USDCents is the USD value in cents; Other the records-currency value in minor units, nil without a rate (R-112).
type StatementLine struct {
	At       time.Time
	What     string // the invoice's number and client, or Income
	ChainID  uint64
	Amount   string // in its token, such as 1,250.00 USDC
	USDCents *big.Int
	Other    *big.Int
	TxHash   string
}

// Statement is a profile's income (R-112) for the UTC days From to To, both included, oldest first. Unclassified
// counts the money in it leaves out; Currency is the records currency ("" for none) with Decimals minor digits.
type Statement struct {
	Holder       profile.Issuer
	From, To     time.Time
	Issued       time.Time
	Currency     string
	Decimals     int
	Lines        []StatementLine
	Unclassified int
}

func StatementPDF(s Statement) ([]byte, error) {
	period := s.From.Format(time.DateOnly) + " to " + s.To.Format(time.DateOnly)
	d := open("Statement", period, bmp(s.Holder.Name), s.Issued)
	d.Ln(4)
	d.rule()
	d.Ln(6)
	tax := ""
	if s.Holder.TaxID != "" {
		tax = "Tax ID " + s.Holder.TaxID
	}
	bottom := d.party(margin, d.GetY(), "Account holder", s.Holder.Name, s.Holder.Address, s.Holder.Country, tax,
		s.Holder.Email)
	d.SetXY(margin, bottom+6)
	// The period heads the page, so the facts leave it out: it is wider than a fact's column.
	d.facts([2]string{"Issued", stamp(s.Issued)}, [2]string{"Payments", strconv.Itoa(len(s.Lines))},
		[2]string{"Records currency", s.Currency})

	d.heading("Income")
	other := s.Currency != ""
	cols := []float64{32, 104, 34}
	heads := []string{"Date (UTC)", "Description", "USD"}
	if other {
		cols = []float64{32, 70, 34, 34}
		heads = append(heads, s.Currency)
	}
	const pad, rowHeight = 2.0, 3*lineHeight + 3
	// A number too wide for its column gets a smaller size, never a cut.
	row := func(cells []string, style string, y float64) {
		x := margin
		for i, c := range cells {
			align, w := "L", cols[i]-2*pad
			if i >= 2 {
				align = "R"
			}
			d.SetFont(font, style, 9.5)
			for size := 9.0; d.GetStringWidth(c) > w && size >= 6; size -= 0.5 {
				d.SetFontSize(size)
			}
			d.SetXY(x+pad, y)
			d.CellFormat(w, lineHeight, c, "", 0, align, false, 0, "")
			x += cols[i]
		}
	}
	header := func() {
		d.color(surface)
		d.text(muted)
		y := d.GetY()
		d.Rect(margin, y, width, 7, "F")
		d.SetFont(font, "B", 8.5)
		x := margin
		for i, h := range heads {
			align := "L"
			if i >= 2 {
				align = "R"
			}
			d.SetXY(x+pad, y+1)
			d.CellFormat(cols[i]-2*pad, lineHeight, h, "", 0, align, false, 0, "")
			x += cols[i]
		}
		d.SetY(y + 9)
	}
	d.pageFor(9 + rowHeight)
	header()

	usd, total := new(big.Int), new(big.Int)
	complete := true
	for _, l := range s.Lines {
		// Three lines that stay together: what and its values, the amount on its network, the transaction.
		if d.GetY()+rowHeight > pageHeight-margin {
			d.AddPage()
			header()
		}
		y := d.GetY()
		d.text(ink)
		cells := []string{l.At.UTC().Format("2006-01-02 15:04"), d.fit(l.What, cols[1]-2*pad, 1)[0],
			plain(l.USDCents, 2)}
		usd.Add(usd, l.USDCents)
		if other {
			value := "no rate"
			if l.Other != nil {
				value = plain(l.Other, s.Decimals)
				total.Add(total, l.Other)
			} else {
				complete = false
			}
			cells = append(cells, value)
		}
		row(cells, "", y)
		d.text(muted)
		d.SetFont(font, "", 8.5)
		d.SetXY(margin+cols[0]+pad, y+lineHeight)
		d.CellFormat(width-cols[0]-2*pad, lineHeight, l.Amount+" on "+NetworkName(l.ChainID), "", 0, "L", false, 0, "")
		d.SetFont(mono, "", 7)
		d.SetXY(margin+cols[0]+pad, y+2*lineHeight)
		link := TxURL(l.ChainID, l.TxHash)
		if link != "" {
			d.text(accent)
		}
		d.CellFormat(width-cols[0]-2*pad, lineHeight, l.TxHash, "", 0, "L", false, 0, link)
		d.SetY(y + rowHeight)
	}
	// The rule and the total stay on one page, under the header that names their columns.
	if d.GetY()+2+lineHeight+2 > pageHeight-margin {
		d.AddPage()
		header()
	}
	d.rule()
	d.Ln(2)
	cells := []string{"", "Total", plain(usd, 2)}
	if other {
		value := "—"
		if complete {
			value = plain(total, s.Decimals)
		}
		cells = append(cells, value)
	}
	d.text(ink)
	row(cells, "B", d.GetY())
	d.Ln(lineHeight + 6)

	var notes []string
	if other && !complete {
		notes = append(notes, "A payment without an ECB rate for its day has no "+s.Currency+" value, so the "+
			s.Currency+" total is left out.")
	}
	switch {
	case s.Unclassified == 1:
		notes = append(notes, "1 payment in is unclassified and not listed: label it on Transactions to include it.")
	case s.Unclassified > 1:
		notes = append(notes, strconv.Itoa(s.Unclassified)+" payments in are unclassified and not listed: label "+
			"them on Transactions to include them.")
	}
	notes = append(notes, "Income is confirmed money in that paid an invoice or that the account holder labelled "+
		"income. A PDF can be edited: each transaction can be checked on its network's explorer.")
	// The heading never ends a page alone: it moves with its first note.
	d.SetFont(font, "", 9.5)
	d.pageFor(3*lineHeight + float64(len(d.fit(notes[0], width, 6)))*lineHeight)
	d.heading("Notes")
	d.SetFont(font, "", 9.5)
	d.text(muted)
	for _, n := range notes {
		lines := d.fit(n, width, 6)
		d.pageFor(float64(len(lines)) * lineHeight) // a note stays on one page
		for _, l := range lines {
			d.CellFormat(width, lineHeight, l, "", 1, "L", false, 0, "")
		}
		d.Ln(1)
	}
	d.text(ink)
	return d.output()
}

// plain is minor units as a grouped decimal without a currency, for a column the header names.
func plain(minor *big.Int, decimals int) string {
	return strings.TrimSuffix(Amount(minor, decimals, ""), " ")
}
