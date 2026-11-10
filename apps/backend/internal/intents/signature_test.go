package intents

import (
	"bytes"
	"errors"
	"math/big"
	"os"
	"testing"
	"time"
)

// testdata holds two answers 1Click gave on 2026-11-09 for 2.5 USDC from Arbitrum to Base, signed by ManagerKey.
func fixture(t *testing.T, name string) []byte {
	t.Helper()
	b, err := os.ReadFile("testdata/" + name)
	if err != nil {
		t.Fatal(err)
	}
	return b
}

func verify(signed []byte, key string) error {
	_, err := verified(signed, key)
	return err
}

func TestVerifyAcceptsOnlyWhat1ClickSigned(t *testing.T) {
	for _, name := range []string{"quote-dry.json", "quote.json"} {
		if err := verify(fixture(t, name), ManagerKey); err != nil {
			t.Fatalf("%s: %v", name, err)
		}
	}
	signed := fixture(t, "quote.json")
	for _, change := range [][2]string{
		{"0x1Ad7e4DDd04f5680cAed3bB23271642BDA6F55Cc", "0x1Ad7e4DDd04f5680cAed3bB23271642BDA6F55Cd"}, // deposit address
		{`"recipient":"0x5e4b7c9a1f3d2e6b8a0c4d7f9e1b3a5c7d9e0f12"`, `"recipient":"0x5e4b7c9a1f3d2e6b8a0c4d7f9e1b3a5c7d9e0f13"`},
		{`"amountOut":"2500000"`, `"amountOut":"2600000"`},
		{`"refundTo":"0x6fd1`, `"refundTo":"0x6fd2`},
		{`"slippageTolerance":100`, `"slippageTolerance":101`},
	} {
		changed := bytes.Replace(signed, []byte(change[0]), []byte(change[1]), 1)
		if bytes.Equal(changed, signed) {
			t.Fatalf("%s is not in the answer", change[0])
		}
		if err := verify(changed, ManagerKey); !errors.Is(err, ErrSignature) {
			t.Fatalf("changing %s: %v, want ErrSignature", change[0], err)
		}
	}
	// 1Click spreads a real quote's fields over its request's, so the address's deadline is signed and the request's
	// is not.
	if err := verify(bytes.Replace(signed, []byte(`"deadline":"2026-11-12T02:41:33.000Z"`), []byte(`"deadline":"2026-11-13T02:41:33.000Z"`), 1), ManagerKey); !errors.Is(err, ErrSignature) {
		t.Fatalf("changed quote deadline: %v", err)
	}
	// A key in another case beside a signed one must not take its place: Go's struct decoding would read either.
	for _, extra := range []string{`"DepositAddress":"0xEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE",`, `"DepositMemo":"1",`, `"AmountIn":"1",`} {
		changed := bytes.Replace(signed, []byte(`"quote":{`), []byte(`"quote":{`+extra), 1)
		q, err := Check(changed, quoteAsk(), false, ManagerKey, signedAt)
		if err != nil {
			t.Fatalf("%s: %v", extra, err)
		}
		if q.DepositAddress != "0x1Ad7e4DDd04f5680cAed3bB23271642BDA6F55Cc" || q.DepositMemo != "" || q.AmountIn.String() != "2527977" {
			t.Fatalf("%s took the signed value's place: %+v", extra, q)
		}
	}
	// A key other than 1Click's refuses even 1Click's own answer.
	if err := verify(signed, EncodeKey(make([]byte, 32))); !errors.Is(err, ErrSignature) {
		t.Fatalf("other key: %v", err)
	}
}

// signedAt is a minute after 1Click signed testdata/quote.json.
var signedAt = time.Date(2026, 11, 9, 2, 12, 34, 0, time.UTC)

// quoteAsk is what testdata/quote.json answers.
func quoteAsk() Ask {
	deadline, _ := time.Parse(time.RFC3339, "2026-11-09T02:41:33Z")
	return Ask{Origin: "nep141:arb-0xaf88d065e77c8cc2239327c5edb3a432268e5831.omft.near", Amount: big.NewInt(2500000),
		Recipient: "0x5e4b7c9a1f3d2e6b8a0c4d7f9e1b3a5c7d9e0f12", RefundTo: "0x6fd1c6b3f0b7a5b4e5d6a3c2b1a0f9e8d7c6b5a4",
		Deadline: deadline}
}

func TestCheckRefusesAQuoteForAnotherPaymentThanAsked(t *testing.T) {
	ask := quoteAsk()
	deadline := ask.Deadline
	q, err := Check(fixture(t, "quote.json"), ask, false, ManagerKey, signedAt)
	if err != nil {
		t.Fatal(err)
	}
	if q.DepositAddress != "0x1Ad7e4DDd04f5680cAed3bB23271642BDA6F55Cc" || q.AmountIn.String() != "2527977" ||
		q.MinAmountIn.String() != "2502697" || q.AmountOut.String() != "2500000" || q.TimeEstimate != 27 {
		t.Fatalf("quote %+v", q)
	}
	for name, change := range map[string]func(*Ask){
		"recipient": func(a *Ask) { a.Recipient = "0x0000000000000000000000000000000000000001" },
		"amount":    func(a *Ask) { a.Amount = big.NewInt(2400000) },
		"refund":    func(a *Ask) { a.RefundTo = "0x0000000000000000000000000000000000000002" },
		"origin":    func(a *Ask) { a.Origin = "nep141:eth.omft.near" },
		// Not signed in a real quote, but 1Click's echo must still be the deadline asked for.
		"deadline": func(a *Ask) { a.Deadline = deadline.Add(time.Minute) },
	} {
		other := quoteAsk()
		change(&other)
		if _, err := Check(fixture(t, "quote.json"), other, false, ManagerKey, signedAt); !errors.Is(err, ErrMismatch) {
			t.Fatalf("%s: %v, want ErrMismatch", name, err)
		}
	}
	// A dry quote is checked as dry: it has no address, and its refund goes to 1Click's own ledger.
	dry := quoteAsk()
	dry.RefundTo = ""
	if _, err := Check(fixture(t, "quote-dry.json"), dry, true, ManagerKey, signedAt); !errors.Is(err, ErrMismatch) {
		t.Fatalf("a dry quote refunding to the payer's address is not what Quote asks for: %v", err)
	}
}
