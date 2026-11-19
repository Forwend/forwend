// Package document renders invoices, receipts and income statements as PDFs, and writes the amounts, dates, numbers
// and network names they share with emails and exports. Nothing is read from the network or disk, and the same input
// always gives the same bytes.
package document

import (
	"bytes"
	_ "embed"
	"fmt"
	"strconv"
	"strings"
	"time"

	"codeberg.org/go-pdf/fpdf"
	"github.com/boombuler/barcode/qr"
)

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

type doc struct{ *fpdf.Fpdf }

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

// fact is one label and value across the page, for a value too long for a facts column; none when value is "".
func (d doc) fact(label, value string) {
	if value == "" {
		return
	}
	d.text(subtle)
	d.SetFont(font, "", 8)
	d.CellFormat(width, lineHeight, label, "", 2, "L", false, 0, "")
	d.text(ink)
	d.SetFont(font, "", 9.5)
	for _, l := range d.fit(value, width, 3) {
		d.CellFormat(width, lineHeight, l, "", 2, "L", false, 0, "")
	}
	d.Ln(6)
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

// testnet is the band under the header of a test-mode PDF: a forwarded one must not pass testnet tokens off as money
// (D-87).
func (d doc) testnet() {
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
