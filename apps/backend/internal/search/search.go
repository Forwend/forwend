// Package search reads the search text of the owner's invoice, activity and transaction lists.
package search

import (
	"errors"
	"fmt"
	"regexp"
	"strings"
	"unicode/utf8"
)

const MaxLength = 100 // characters

var ErrInvalid = errors.New("invalid search")

// The zero Query matches every row.
type Query struct {
	Like   *string // ILIKE pattern, wildcards escaped
	Amount *string // whole tokens; compare in numeric, never float
}

var decimal = regexp.MustCompile(`^([0-9]+\.?[0-9]*|\.[0-9]+)$`)

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
