package address

import (
	"encoding/hex"
	"testing"
)

// The same vector is in apps/web/src/features/pay/tests/receive-address.test.ts: the pay page derives option ids
// as the API does.
func TestOptionID(t *testing.T) {
	var id [32]byte
	var token [20]byte
	_, _ = hex.Decode(id[:], []byte("7f3a9c1e5b2d4086a1c3e5f7092b4d6f8a0c2e4f6a8b0d2f4e6c8a0b2d4f6e81"))
	_, _ = hex.Decode(token[:], []byte("75faf114eafb1bdbe2f0316df893fd58ce46aa4d"))
	got := OptionID(id, 421614, token)
	if want := "80166bc7ad9374378c99215bffabc884c9fe82e8876840816d1eb4e5710a89e7"; hex.EncodeToString(got[:]) != want {
		t.Fatalf("OptionID = %x, want %s", got, want)
	}
}
