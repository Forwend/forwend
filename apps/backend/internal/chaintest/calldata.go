package chaintest

import (
	"encoding/hex"
	"fmt"
	"math/big"
	"strconv"
	"strings"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/crypto"
)

// calldata encodes a call from a signature and its arguments written as cast takes them, such as
// calldata("refund(address,uint256)", "0xab…", "1000000"). It covers the static types tests send (address, bool,
// uintN, bytesN and tuples of them); a dynamic type is an error, so it gets added here on purpose.
func calldata(sig string, args ...string) ([]byte, error) {
	open := strings.IndexByte(sig, '(')
	if open < 1 || !strings.HasSuffix(sig, ")") {
		return nil, fmt.Errorf("signature %q: want name(types)", sig)
	}
	data := crypto.Keccak256([]byte(sig))[:4]
	words, err := encodeList(split(sig[open+1:len(sig)-1]), args)
	if err != nil {
		return nil, fmt.Errorf("%s: %w", sig, err)
	}
	return append(data, words...), nil
}

func encodeList(types, values []string) ([]byte, error) {
	if len(types) != len(values) {
		return nil, fmt.Errorf("%d values for %d types", len(values), len(types))
	}
	var out []byte
	for i, typ := range types {
		word, err := encode(typ, values[i])
		if err != nil {
			return nil, err
		}
		out = append(out, word...)
	}
	return out, nil
}

// encode writes one static value: a tuple of static types sits inline, as its fields one after another.
func encode(typ, value string) ([]byte, error) {
	if strings.HasPrefix(typ, "(") {
		if !strings.HasPrefix(value, "(") || !strings.HasSuffix(value, ")") {
			return nil, fmt.Errorf("%s: want a tuple like (a,b), got %q", typ, value)
		}
		return encodeList(split(typ[1:len(typ)-1]), split(value[1:len(value)-1]))
	}
	word := make([]byte, 32)
	switch {
	case typ == "address":
		if !common.IsHexAddress(value) {
			return nil, fmt.Errorf("address %q", value)
		}
		copy(word[12:], common.HexToAddress(value).Bytes())
	case typ == "bool":
		b, err := strconv.ParseBool(value)
		if err != nil {
			return nil, fmt.Errorf("bool %q", value)
		}
		if b {
			word[31] = 1
		}
	case strings.HasPrefix(typ, "uint"):
		bits := 256
		if typ != "uint" {
			n, err := strconv.Atoi(typ[4:])
			if err != nil || n < 8 || n > 256 || n%8 != 0 {
				return nil, fmt.Errorf("type %s", typ)
			}
			bits = n
		}
		n, ok := new(big.Int), false
		if rest, isHex := strings.CutPrefix(value, "0x"); isHex {
			n, ok = n.SetString(rest, 16)
		} else {
			n, ok = n.SetString(value, 10)
		}
		if !ok || n.Sign() < 0 || n.BitLen() > bits {
			return nil, fmt.Errorf("%s %q", typ, value)
		}
		n.FillBytes(word)
	case strings.HasPrefix(typ, "bytes") && typ != "bytes":
		size, err := strconv.Atoi(typ[5:])
		raw, hexErr := hex.DecodeString(strings.TrimPrefix(value, "0x"))
		if err != nil || size < 1 || size > 32 || hexErr != nil || len(raw) != size {
			return nil, fmt.Errorf("%s %q", typ, value)
		}
		copy(word, raw)
	default:
		return nil, fmt.Errorf("type %s is not one tests send yet", typ)
	}
	return word, nil
}

// split cuts a comma list at the top level, leaving a tuple's own commas alone.
func split(list string) []string {
	if list == "" {
		return nil
	}
	var parts []string
	depth, start := 0, 0
	for i, c := range list {
		switch c {
		case '(':
			depth++
		case ')':
			depth--
		case ',':
			if depth == 0 {
				parts = append(parts, list[start:i])
				start = i + 1
			}
		}
	}
	return append(parts, list[start:])
}
