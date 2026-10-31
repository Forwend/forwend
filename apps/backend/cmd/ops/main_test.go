package main

import "testing"

func TestBaseUnitsReadsTokensExactly(t *testing.T) {
	for text, want := range map[string]string{"1": "1000000", "1.5": "1500000", "0.000001": "1", "12.345678": "12345678"} {
		if got, err := baseUnits(text, 6); err != nil || got.String() != want {
			t.Errorf("%s: %v, %v; want %s", text, got, err, want)
		}
	}
	for _, text := range []string{"", "0", "-1", "1/2", "1e3", "1.0000001", "1,5"} {
		if got, err := baseUnits(text, 6); err == nil {
			t.Errorf("%q read as %s", text, got)
		}
	}
}
