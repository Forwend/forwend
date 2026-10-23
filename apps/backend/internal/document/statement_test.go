package document

import (
	"bytes"
	"compress/zlib"
	"fmt"
	"io"
	"math/big"
	"strings"
	"testing"
	"time"
	"unicode/utf16"

	"github.com/ensp1re/forwend/apps/backend/internal/profile"
)

func statement(n int) Statement {
	s := Statement{Holder: profile.Issuer{Name: "Alice", Address: "Main St 1", Country: "DE", Email: "a@x.example"},
		From: time.Date(2026, 10, 1, 0, 0, 0, 0, time.UTC), To: time.Date(2026, 10, 31, 0, 0, 0, 0, time.UTC),
		Issued: time.Date(2026, 11, 1, 9, 0, 0, 0, time.UTC), Currency: "IDR", Decimals: 2}
	for i := range n {
		s.Lines = append(s.Lines, StatementLine{At: time.Date(2026, 10, 9, 10, i, 0, 0, time.UTC), What: "Income",
			ChainID: 84532, Amount: "100,000.00 USDC", USDCents: big.NewInt(10_000_000),
			Other: big.NewInt(160_000_000_000), TxHash: fmt.Sprintf("0x%064x", i)})
	}
	return s
}

// pages returns the text each page draws (see pdfText in the API tests): one entry per page content stream.
func pages(t *testing.T, pdf []byte) []string {
	t.Helper()
	var out []string
	for rest := pdf; ; {
		start := bytes.Index(rest, []byte("stream\n"))
		if start < 0 {
			return out
		}
		rest = rest[start+len("stream\n"):]
		end := bytes.Index(rest, []byte("\nendstream"))
		stream := rest[:end]
		rest = rest[end+len("\nendstream"):]
		zr, err := zlib.NewReader(bytes.NewReader(stream))
		if err != nil {
			continue
		}
		content, err := io.ReadAll(zr)
		if err != nil || !bytes.Contains(content, []byte("BT ")) {
			continue
		}
		var lines []string
		for i := 0; i < len(content); i++ {
			if content[i] != '(' {
				continue
			}
			var s []byte
			for i++; content[i] != ')'; i++ {
				if content[i] == '\\' {
					i++
				}
				s = append(s, content[i])
			}
			if !bytes.ContainsFunc(s, func(r rune) bool { return r < 0x20 || r > 0x7e }) {
				lines = append(lines, string(s))
				continue
			}
			units := make([]uint16, len(s)/2)
			for j := range units {
				units[j] = uint16(s[2*j])<<8 | uint16(s[2*j+1])
			}
			lines = append(lines, string(utf16.Decode(units)))
		}
		out = append(out, strings.Join(lines, "\n"))
	}
}

// R-112: a copy can be compared with the original.
func TestStatementIsTheSameEachTime(t *testing.T) {
	first, err := StatementPDF(statement(3))
	if err != nil {
		t.Fatal(err)
	}
	again, err := StatementPDF(statement(3))
	if err != nil || !bytes.Equal(first, again) {
		t.Fatalf("two renders differ: %v", err)
	}
}

// R-112.
func TestStatementPagesKeepTheTableTogether(t *testing.T) {
	// Lines of every count over several pages, under holder blocks of 1 to 4 address lines: the table then starts at
	// different heights, so the total meets the end of the first page too.
	for n := 1; n <= 40; n++ {
		for extra := range 4 {
			s := statement(n)
			s.Holder.Address += strings.Repeat("\nMore", extra)
			checkStatementPages(t, n, s)
		}
	}
}

func checkStatementPages(t *testing.T, n int, s Statement) {
	t.Helper()
	pdf, err := StatementPDF(s)
	if err != nil {
		t.Fatal(err)
	}
	listed, totals := 0, 0
	for i, page := range pages(t, pdf) {
		hashes := strings.Count(page, "0x0000")
		listed += hashes
		if hashes > 0 && !strings.Contains(page, "Date (UTC)") {
			t.Fatalf("%d lines: page %d lists payments without the header:\n%s", n, i+1, page)
		}
		if strings.Contains(page, "Total") {
			totals++
			if !strings.Contains(page, "Date (UTC)") {
				t.Fatalf("%d lines: page %d has the total without the header:\n%s", n, i+1, page)
			}
			usd := plain(new(big.Int).Mul(big.NewInt(10_000_000), big.NewInt(int64(n))), 2)
			idr := plain(new(big.Int).Mul(big.NewInt(160_000_000_000), big.NewInt(int64(n))), 2)
			if !strings.Contains(page, usd) || !strings.Contains(page, idr) {
				t.Fatalf("%d lines: page %d has Total without %s and %s:\n%s", n, i+1, usd, idr, page)
			}
		}
	}
	if listed != n || totals != 1 {
		t.Fatalf("%d lines: %d listed, %d totals", n, listed, totals)
	}
	for i, page := range pages(t, pdf) {
		if strings.HasSuffix(strings.TrimSpace(page[:strings.LastIndex(page, "Statement ")]), "NOTES") {
			t.Fatalf("%d lines: page %d ends with the notes' heading alone:\n%s", n, i+1, page)
		}
	}
}
