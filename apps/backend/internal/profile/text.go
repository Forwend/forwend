package profile

import (
	"regexp"
	"strings"
	"unicode"
	"unicode/utf8"

	"golang.org/x/text/unicode/norm"
)

// PlainText refuses characters that can hide or reorder what a payer reads; ZWJ stays for Persian and emoji.
func PlainText(s string, lines bool) bool {
	for _, r := range s {
		switch {
		case r == '\n' && lines, r == '\u200c', r == '\u200d':
		case unicode.In(r, unicode.Cc, unicode.Cf, unicode.Zl, unicode.Zp), fillers[r]:
			return false
		}
	}
	return true
}

// ValidText: valid UTF-8, at most max characters, and PlainText.
func ValidText(s string, max int, lines bool) bool {
	return utf8.ValidString(s) && utf8.RuneCountInString(s) <= max && PlainText(s, lines)
}

var fillers = map[rune]bool{'\u115f': true, '\u1160': true, '\u2800': true, '\u3164': true, '\uffa0': true}

// Impersonates reports a name that reads as Forwend, also with accents, spaces or look-alike letters.
func Impersonates(name string) bool {
	return readsAsForwend(name, true) || readsAsForwend(name, false)
}

// symbols: a letter-like symbol counts as that letter, else as a gap.
func readsAsForwend(name string, symbols bool) bool {
	var b strings.Builder
	gap := false
	for _, r := range norm.NFKD.String(name) {
		if symbols || unicode.IsLetter(r) || unicode.IsDigit(r) {
			r = latin(r)
		}
		switch {
		case r >= 'a' && r <= 'z':
			if gap && b.Len() > 0 {
				b.WriteByte(' ')
			}
			gap = false
			b.WriteRune(r)
		case !unicode.IsMark(r):
			gap = true
		}
	}
	text := strings.ReplaceAll(b.String(), "vv", "w")
	for _, m := range forwend.FindAllStringIndex(text, -1) {
		if !strings.Contains(text[m[0]:m[1]], " ") || m[1] == len(text) || text[m[1]] == ' ' {
			return true
		}
	}
	return false
}

var forwend = regexp.MustCompile("f ?o ?r ?w ?e ?n ?d")

func latin(r rune) rune {
	for _, c := range []rune{r, unicode.ToLower(r)} {
		if l, ok := lookalikes[c]; ok {
			return rune(l)
		}
		if l, ok := moreLookalikes[c]; ok {
			return rune(l)
		}
	}
	return unicode.ToLower(r)
}

// Letters Unicode's confusables don't list: lower-case Greek and Cyrillic, and small capitals.
var moreLookalikes = map[rune]byte{'п': 'n', 'ω': 'w', 'ε': 'e', 'η': 'n', 'ɾ': 'r', 'ꜰ': 'f', 'ʀ': 'r', 'ᴇ': 'e', 'ɴ': 'n',
	'ᴅ': 'd'}
