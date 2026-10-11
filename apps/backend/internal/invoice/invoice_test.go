package invoice

import (
	"errors"
	"math/big"
	"testing"
	"time"

	"github.com/ensp1re/forwend/apps/backend/internal/address"
)

// Every recipient settle() refuses is refused before an address is shown (InvoiceTypes.sol safeToSettle).
func TestBuildTermsRefusesWhatSettleRefuses(t *testing.T) {
	expires := time.Unix(1800000000, 0)
	for name, recipient := range map[string]string{
		"zero":           hexAddress([20]byte{}),
		"factory":        hexAddress(address.Factory),
		"implementation": hexAddress(address.Implementation),
		"token":          usdc,
	} {
		_, _, err := buildTerms([32]byte{1}, 84532, usdc, recipient, big.NewInt(1), expires, expires.Add(SettleWindow))
		if !errors.Is(err, ErrInvalid) {
			t.Errorf("recipient = %s: got %v, want ErrInvalid", name, err)
		}
	}
	if _, _, err := buildTerms([32]byte{1}, 84532, usdc, "0x1111111111111111111111111111111111111111", big.NewInt(1),
		expires, expires.Add(SettleWindow)); err != nil {
		t.Fatalf("ordinary wallet: %v", err)
	}
}

func TestDetailsRefuseHiddenTextAndForwendNames(t *testing.T) {
	for name, d := range map[string]Details{
		"sender named Forwend":      {SenderName: "Forwеnd Support"},
		"direction override":        {Title: "‮tnemyap"},
		"zero-width in client name": {ClientName: "Ac​me"},
		"line break in a title":     {Title: "Invoice\nPay now"},
	} {
		if err := d.check(); !errors.Is(err, ErrInvalid) {
			t.Errorf("%s: got %v, want ErrInvalid", name, err)
		}
	}
	if err := (Details{Note: "Thanks!\nSee you", ClientAddress: "1 Test Street\nBerlin"}).check(); err != nil {
		t.Errorf("line breaks in a note and an address: %v", err)
	}
}
