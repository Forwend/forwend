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
		if c, ok := capitals[r]; ok {
			r = c
		}
		r = unicode.ToLower(r)
		if c, ok := lookalikes[r]; ok {
			r = c
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

// capitals look like a Latin capital whose lowercase differs from theirs (Greek Ν is N, but ν reads as v).
var capitals = map[rune]rune{'Ν': 'N', 'Η': 'H', 'Ρ': 'P', 'Β': 'B', 'Χ': 'X', 'Ϝ': 'F', 'Ꮃ': 'W', 'Ԝ': 'W'}

var lookalikes = map[rune]rune{
	'а': 'a', 'е': 'e', 'о': 'o', 'р': 'p', 'с': 'c', 'г': 'r', 'п': 'n', 'ԁ': 'd', 'ԝ': 'w', 'ѡ': 'w', 'ο': 'o',
	'ρ': 'p', 'ν': 'v', 'ω': 'w', 'ε': 'e', 'η': 'n', 'ɾ': 'r', 'ƒ': 'f', 'ꬵ': 'f', '0': 'o', '1': 'l',
	'ꜰ': 'f', 'ᴏ': 'o', 'ʀ': 'r', 'ᴡ': 'w', 'ᴇ': 'e', 'ɴ': 'n', 'ᴅ': 'd',
	'ꓝ': 'f', 'ꓳ': 'o', 'ꓣ': 'r', 'ꓪ': 'w', 'ꓰ': 'e', 'ꓠ': 'n', 'ꓓ': 'd',
}
