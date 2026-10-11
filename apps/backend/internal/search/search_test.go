package search

import (
	"errors"
	"strings"
	"testing"
)

func TestParse(t *testing.T) {
	for _, c := range []struct {
		text, like, amount string // amount "" is none
	}{
		{" Kettle ", "%Kettle%", ""},
		{"50%_a\\b", `%50\%\_a\\b%`, ""},
		{"1,250.50", "%1,250.50%", "1250.50"},
		{"12.", "%12.%", "12."},
		{".5", "%.5%", ".5"},
		{"1.2.3", "%1.2.3%", ""},
		{"-5", "%-5%", ""},
		{"0x12", "%0x12%", ""},
		{strings.Repeat("é", MaxLength), "%" + strings.Repeat("é", MaxLength) + "%", ""},
	} {
		q, err := Parse(c.text)
		if err != nil || *q.Like != c.like || (q.Amount == nil) != (c.amount == "") || (q.Amount != nil && *q.Amount != c.amount) {
			t.Fatalf("%q: %v %v %v", c.text, q.Like, q.Amount, err)
		}
	}
	for _, text := range []string{"", "  ", strings.Repeat("a", MaxLength+1)} {
		if _, err := Parse(text); !errors.Is(err, ErrInvalid) {
			t.Fatalf("%q: %v, want ErrInvalid", text, err)
		}
	}
}
