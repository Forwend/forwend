package address

import (
	"encoding/hex"
	"encoding/json"
	"errors"
	"math/big"
	"os"
	"strconv"
	"strings"
	"testing"
)

// Written by Foundry from factory.predict; see packages/contracts/script/ReceiveAddressVectors.s.sol.
const vectorsPath = "../../../../packages/contracts/vectors/receive-address.json"

type vectorsFile struct {
	Factory        string
	Implementation string
	Vectors        []struct {
		InvoiceID       string
		Recipient       string
		Token           string
		Amount          string
		ExpiresAt       string
		SettleDeadline  string
		IntendedChainID string
		Receiver        string
	}
}

func TestReceiveMatchesFactoryPredict(t *testing.T) {
	raw, err := os.ReadFile(vectorsPath)
	if err != nil {
		t.Fatal(err)
	}
	var f vectorsFile
	if err := json.Unmarshal(raw, &f); err != nil {
		t.Fatal(err)
	}
	if len(f.Vectors) < 20 {
		t.Fatalf("got %d vectors, want at least 20", len(f.Vectors))
	}
	if got := hexAddress(Factory); got != strings.ToLower(f.Factory) {
		t.Fatalf("compiled factory %s, vectors factory %s", got, f.Factory)
	}
	if got := hexAddress(Implementation); got != strings.ToLower(f.Implementation) {
		t.Fatalf("compiled implementation %s, vectors implementation %s", got, f.Implementation)
	}
	for i, v := range f.Vectors {
		amount, ok := new(big.Int).SetString(v.Amount, 10)
		if !ok {
			t.Fatalf("vector %d: bad amount %q", i, v.Amount)
		}
		terms := Terms{
			InvoiceID:       [32]byte(decodeHex(t, v.InvoiceID)),
			Recipient:       [20]byte(decodeHex(t, v.Recipient)),
			Token:           [20]byte(decodeHex(t, v.Token)),
			Amount:          amount,
			ExpiresAt:       parseUint(t, v.ExpiresAt),
			SettleDeadline:  parseUint(t, v.SettleDeadline),
			IntendedChainID: parseUint(t, v.IntendedChainID),
		}
		got, err := Receive(terms)
		if err != nil {
			t.Fatalf("vector %d: %v", i, err)
		}
		if hexAddress(got) != strings.ToLower(v.Receiver) {
			t.Errorf("vector %d: got %s, want %s", i, hexAddress(got), v.Receiver)
		}
	}
}

func TestReceiveRejectsAmountOutsideUint256(t *testing.T) {
	tooBig := new(big.Int).Lsh(big.NewInt(1), 256)
	for name, amount := range map[string]*big.Int{"nil": nil, "negative": big.NewInt(-1), "2^256": tooBig} {
		if _, err := Receive(Terms{Amount: amount}); !errors.Is(err, ErrAmount) {
			t.Errorf("%s: got %v, want ErrAmount", name, err)
		}
	}
}

func hexAddress(a [20]byte) string {
	return "0x" + hex.EncodeToString(a[:])
}

func decodeHex(t *testing.T, s string) []byte {
	t.Helper()
	b, err := hex.DecodeString(strings.TrimPrefix(s, "0x"))
	if err != nil {
		t.Fatal(err)
	}
	return b
}

func parseUint(t *testing.T, s string) uint64 {
	t.Helper()
	n, err := strconv.ParseUint(s, 10, 64)
	if err != nil {
		t.Fatal(err)
	}
	return n
}
