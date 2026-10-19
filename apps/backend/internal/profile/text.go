package profile

import (
	"regexp"
	"strings"
	"unicode"

	"golang.org/x/text/unicode/norm"
)

// PlainText refuses control, invisible format and separator characters and blank fillers: they can hide or reorder
// what a payer reads. Zero-width joiners stay: Persian names and emoji need them. lines allows \n, for addresses and
// notes.
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

var fillers = map[rune]bool{'\u115f': true, '\u1160': true, '\u2800': true, '\u3164': true, '\uffa0': true}

// Impersonates reports a name shown to payers that reads as Forwend, also with accents, spaces or look-alike letters.
// Split across words it counts only when it ends a word: "For wend" reads as Forwend, "Gifts for Wendy" does not.
func Impersonates(name string) bool {
	var b strings.Builder
	gap := false
	for _, r := range norm.NFKD.String(name) {
		r = latin(r)
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

// latin is the lower-case ASCII letter r reads as, by itself or in lower case, else r in lower case.
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

// moreLookalikes read as a Latin letter in a name, though Unicode's confusables (lookalikes.go) don't list them:
// lower-case Greek and Cyrillic letters and small capitals.
var moreLookalikes = map[rune]byte{'п': 'n', 'ω': 'w', 'ε': 'e', 'η': 'n', 'ɾ': 'r', 'ꜰ': 'f', 'ʀ': 'r', 'ᴇ': 'e', 'ɴ': 'n',
	'ᴅ': 'd'}
