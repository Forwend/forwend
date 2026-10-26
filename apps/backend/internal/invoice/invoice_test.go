package invoice

import (
	"errors"
	"math/big"
	"os"
	"reflect"
	"regexp"
	"testing"
	"time"

	"github.com/forwend/forwend/apps/backend/internal/address"
)

// Mirrors InvoiceTypes.sol safeToSettle.
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

// R-93: an agreed value is stored in its currency's minor units, whatever the currency's decimals.
func TestAgreedValueParse(t *testing.T) {
	for _, c := range []struct {
		currency, amount string
		want             int64
		decimals         int
	}{{"EUR", "1000.5", 100050, 2}, {"EUR", "1000", 100000, 2}, {"JPY", "150000", 150000, 0}, {"ISK", "7", 7, 0}} {
		got, err := (&AgreedRequest{Currency: c.currency, Amount: c.amount, Date: "2026-10-01"}).parse()
		if err != nil || got.Amount != c.want || got.Decimals != c.decimals {
			t.Errorf("%s %s: %v %v, want %d at %d decimals", c.amount, c.currency, got, err, c.want, c.decimals)
		}
	}
}

func TestAgreedCurrenciesMatchTheWeb(t *testing.T) {
	src, err := os.ReadFile("../../../web/src/features/invoices/constants/invoices.ts")
	if err != nil {
		t.Fatal(err)
	}
	list := regexp.MustCompile(`(?s)AGREED_CURRENCIES = \{(.*?)\}`).FindSubmatch(src)
	if list == nil {
		t.Fatal("AGREED_CURRENCIES not found")
	}
	web := map[string]int{}
	for _, m := range regexp.MustCompile(`([A-Z]{3}): ([0-9])`).FindAllSubmatch(list[1], -1) {
		web[string(m[1])] = int(m[2][0] - '0')
	}
	if !reflect.DeepEqual(web, AgreedCurrencies) {
		t.Fatalf("the web offers %v, the API takes %v", web, AgreedCurrencies)
	}
}

// R-151: metadata joins the hash only when set, so a request without it hashes as it did before.
func TestRequestHashTakesMetadataOnlyWhenSet(t *testing.T) {
	hash := func(m map[string]string) string {
		return string(requestHash(84532, usdc, big.NewInt(5000000), DefaultExpiresIn, Details{Metadata: m}, nil, false, nil,
			"", ""))
	}
	if hash(nil) != hash(map[string]string{}) || hash(nil) != string(requestHash(84532, usdc, big.NewInt(5000000),
		DefaultExpiresIn, Details{}, nil, false, nil, "", "")) {
		t.Fatal("no metadata changed the hash")
	}
	if hash(map[string]string{"a": "1", "b": "2"}) != hash(map[string]string{"b": "2", "a": "1"}) ||
		hash(map[string]string{"a": "1"}) == hash(nil) || hash(map[string]string{"a": "1"}) == hash(map[string]string{"a": "2"}) {
		t.Fatal("metadata does not decide the hash")
	}
}
