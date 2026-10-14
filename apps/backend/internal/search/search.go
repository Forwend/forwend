// Package search reads the search text of the owner's invoice, activity and transaction lists.
package search

import (
	"errors"
	"fmt"
	"regexp"
	"strings"
	"unicode/utf8"
)

// MaxLength is the longest search in characters.
const MaxLength = 100

// ErrInvalid wraps a search that is blank, too long or not text.
var ErrInvalid = errors.New("invalid search")

// Query is a parsed search; the zero Query matches every row.
type Query struct {
	// Like is the trimmed text between two %, LIKE's wildcards escaped, for ILIKE (contains, any letter case).
	Like *string
	// Amount is the text as a decimal number in whole tokens, thousands commas dropped ("1,250.5" is "1250.5"), or nil.
	// An amount matches when amount = Amount * 10^decimals exactly, in Postgres numeric: never a float.
	Amount *string
}

var decimal = regexp.MustCompile(`^([0-9]+\.?[0-9]*|\.[0-9]+)$`)

// Parse reads the q parameter.
func Parse(text string) (Query, error) {
	text = strings.TrimSpace(text)
	if text == "" || utf8.RuneCountInString(text) > MaxLength {
		return Query{}, fmt.Errorf("%w: q must be 1 to %d characters", ErrInvalid, MaxLength)
	}
	// Postgres text can't hold a NUL byte.
	if !utf8.ValidString(text) || strings.ContainsRune(text, 0) {
		return Query{}, fmt.Errorf("%w: q must be UTF-8 text", ErrInvalid)
	}
	like := "%" + strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`).Replace(text) + "%"
	q := Query{Like: &like}
	if n := strings.ReplaceAll(text, ",", ""); decimal.MatchString(n) {
		q.Amount = &n
	}
	return q, nil
}
