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

// Written by Foundry from factory.predict; see packages/contracts/script/ReceiveAddressVectors.s.sol. The v1.1 file
// keeps the vectors of the factory before the fees, which its invoices still use.
const (
	vectorsPath     = "../../../../packages/contracts/vectors/receive-address.json"
	vectorsV1_1Path = "../../../../packages/contracts/vectors/receive-address-v1.1.json"
)

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
		NetworkFee      string
		PlatformFee     string
		Receiver        string
	}
}

func readVectors(t *testing.T, path string) vectorsFile {
	t.Helper()
	raw, err := os.ReadFile(path)
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
	return f
}

// checkVectors computes every vector's receiver at the file's factory.
func checkVectors(t *testing.T, f vectorsFile) {
	t.Helper()
	factory := [20]byte(decodeHex(t, f.Factory))
	for i, v := range f.Vectors {
		terms := Terms{
			InvoiceID:       [32]byte(decodeHex(t, v.InvoiceID)),
			Recipient:       [20]byte(decodeHex(t, v.Recipient)),
			Token:           [20]byte(decodeHex(t, v.Token)),
			Amount:          parseBig(t, v.Amount),
			ExpiresAt:       parseUint(t, v.ExpiresAt),
			SettleDeadline:  parseUint(t, v.SettleDeadline),
			IntendedChainID: parseUint(t, v.IntendedChainID),
		}
		if v.NetworkFee != "" {
			terms.NetworkFee, terms.PlatformFee = parseBig(t, v.NetworkFee), parseBig(t, v.PlatformFee)
		}
		got, err := ReceiveAt(factory, terms)
		if err != nil {
			t.Fatalf("vector %d: %v", i, err)
		}
		if hexAddress(got) != strings.ToLower(v.Receiver) {
			t.Errorf("vector %d: got %s, want %s", i, hexAddress(got), v.Receiver)
		}
	}
}

func TestReceiveMatchesFactoryPredict(t *testing.T) {
	f := readVectors(t, vectorsPath)
	if got := hexAddress(Factory); got != strings.ToLower(f.Factory) {
		t.Fatalf("compiled factory %s, vectors factory %s", got, f.Factory)
	}
	if got := hexAddress(Implementation); got != strings.ToLower(f.Implementation) {
		t.Fatalf("compiled implementation %s, vectors implementation %s", got, f.Implementation)
	}
	if !Known[Factory].Fees {
		t.Fatal("the newest factory's terms carry no fees")
	}
	checkVectors(t, f)
}

// R-226: invoices made before the fees keep their v1.1 factory and its seven-field terms.
func TestV1_1InvoicesKeepTheirAddresses(t *testing.T) {
	f := readVectors(t, vectorsV1_1Path)
	spec, ok := Known[[20]byte(decodeHex(t, f.Factory))]
	if !ok || spec.Fees || hexAddress(spec.Implementation) != strings.ToLower(f.Implementation) {
		t.Fatalf("v1.1 factory %s: known %v, spec %+v", f.Factory, ok, spec)
	}
	checkVectors(t, f)
	// A fee can't be put in terms that have no place for it.
	_, err := ReceiveAt([20]byte(decodeHex(t, f.Factory)), Terms{Amount: big.NewInt(1), NetworkFee: big.NewInt(1)})
	if !errors.Is(err, ErrFees) {
		t.Errorf("a fee on v1.1 terms: got %v, want ErrFees", err)
	}
}

// The calls the signer and a Safe make carry each factory's own tuple; Foundry's cast wrote the v2 calldata.
func TestCallsUseTheFactorysTerms(t *testing.T) {
	terms := Terms{InvoiceID: [32]byte(decodeHex(t, strings.Repeat("05", 32))),
		Recipient: [20]byte(decodeHex(t, "1a2B3c4D5e6F708192a3B4c5D6e7F80912A3b4C5")),
		Token:     [20]byte(decodeHex(t, "00000000000000000000000000000000000000bb")), Amount: big.NewInt(5000000),
		ExpiresAt: 1800000000, SettleDeadline: 1800086400, IntendedChainID: 31337,
		NetworkFee: big.NewInt(7000), PlatformFee: big.NewInt(1)}
	got, err := Call(Factory, "deploy", terms)
	if err != nil {
		t.Fatal(err)
	}
	want := "9d6ada45" + strings.Repeat("05", 32) +
		"0000000000000000000000001a2b3c4d5e6f708192a3b4c5d6e7f80912a3b4c5" +
		"00000000000000000000000000000000000000000000000000000000000000bb" +
		"00000000000000000000000000000000000000000000000000000000004c4b40" +
		"000000000000000000000000000000000000000000000000000000006b49d200" +
		"000000000000000000000000000000000000000000000000000000006b4b2380" +
		"0000000000000000000000000000000000000000000000000000000000007a69" +
		"0000000000000000000000000000000000000000000000000000000000001b58" +
		"0000000000000000000000000000000000000000000000000000000000000001"
	if hex.EncodeToString(got) != want {
		t.Errorf("v2 deploy calldata\n got %x\nwant %s", got, want)
	}
	v1 := [20]byte(decodeHex(t, "f93da73F1308A9B34aAB78bF6D84F0BAcc600dd2"))
	if sig, _ := Signature(v1, "deploy"); sig != "deploy((bytes32,address,address,uint256,uint64,uint64,uint256))" {
		t.Errorf("v1.1 signature %s", sig)
	}
	args, _ := Args(Factory, "0x05", terms)
	if args != "(0x05,0x1a2b3c4d5e6f708192a3b4c5d6e7f80912a3b4c5,0x00000000000000000000000000000000000000bb,5000000,"+
		"1800000000,1800086400,31337,7000,1)" {
		t.Errorf("v2 args %s", args)
	}
	terms.NetworkFee, terms.PlatformFee = nil, nil
	if _, err := Call(v1, "deploy", terms); err != nil {
		t.Errorf("v1.1 deploy without fees: %v", err)
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

func parseBig(t *testing.T, s string) *big.Int {
	t.Helper()
	n, ok := new(big.Int).SetString(s, 10)
	if !ok {
		t.Fatalf("bad number %q", s)
	}
	return n
}

func parseUint(t *testing.T, s string) uint64 {
	t.Helper()
	n, err := strconv.ParseUint(s, 10, 64)
	if err != nil {
		t.Fatal(err)
	}
	return n
}
