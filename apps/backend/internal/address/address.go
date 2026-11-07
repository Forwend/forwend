// Package address computes an invoice's receive address locally, exactly as InvoiceReceiverFactory.predict does.
// It is tested against vectors written by packages/contracts/script/ReceiveAddressVectors.s.sol.
package address

import (
	"encoding/binary"
	"encoding/hex"
	"errors"
	"math/big"
	"strings"

	"golang.org/x/crypto/sha3"
)

// Factory is the newest factory, at one address on every chain (packages/contracts/deployments.json), and
// Implementation the receiver implementation it created. New invoices use them; a contract change means new values.
var (
	Factory        = mustHex20("f93da73F1308A9B34aAB78bF6D84F0BAcc600dd2")
	Implementation = mustHex20("26b7DB220aF2Da25B960E7e5bCcf80a708aE630f")
)

// Known maps every factory an invoice may still use to its implementation. An invoice keeps the factory it was made
// with, so a replaced factory stays here until none of its invoices can hold money.
var Known = map[[20]byte][20]byte{
	Factory: Implementation,
	mustHex20("ECe745390524e4d0B05D26F56AF7F1D38FDb7546"): mustHex20("322F6c8dAf0a8bd7cF16eb62D0a04700eEA4b639"), // v1
}

var (
	ErrAmount         = errors.New("amount must be between 0 and 2^256-1")
	ErrUnknownFactory = errors.New("not a Forwend factory")
)

// Terms mirrors InvoiceTerms in packages/contracts/src/InvoiceTypes.sol, in ABI field order.
type Terms struct {
	InvoiceID       [32]byte
	Recipient       [20]byte
	Token           [20]byte
	Amount          *big.Int
	ExpiresAt       uint64
	SettleDeadline  uint64
	IntendedChainID uint64
}

// Receive returns the receiver address the newest factory deploys for t.
func Receive(t Terms) ([20]byte, error) {
	return ReceiveAt(Factory, t)
}

// ReceiveAt returns the receiver address a known factory deploys for t: a CREATE2 clone (OpenZeppelin
// Clones.cloneDeterministicWithImmutableArgs) with args = abi.encode(t) and salt = keccak256(args).
func ReceiveAt(factory [20]byte, t Terms) ([20]byte, error) {
	implementation, ok := Known[factory]
	if !ok {
		return [20]byte{}, ErrUnknownFactory
	}
	args, err := t.Encode()
	if err != nil {
		return [20]byte{}, err
	}

	// Clones._cloneCodeWithImmutableArgs: 0x61 <uint16 len(args)+0x2d> <prefix> <implementation> <suffix> <args>.
	code := []byte{0x61, 0, 0}
	binary.BigEndian.PutUint16(code[1:3], uint16(len(args)+0x2d))
	code = append(code, mustHex("3d81600a3d39f3363d3d373d3d3d363d73")...)
	code = append(code, implementation[:]...)
	code = append(code, mustHex("5af43d82803e903d91602b57fd5bf3")...)
	code = append(code, args...)

	salt := keccak(args)
	hash := keccak([]byte{0xff}, factory[:], salt, keccak(code))
	var out [20]byte
	copy(out[:], hash[12:])
	return out, nil
}

// Encode is abi.encode(InvoiceTerms): the clone's immutable args, and the argument of factory.deploy and status.
func (t Terms) Encode() ([]byte, error) {
	if t.Amount == nil || t.Amount.Sign() < 0 || t.Amount.BitLen() > 256 {
		return nil, ErrAmount
	}
	args := make([]byte, 7*32)
	copy(args[0:32], t.InvoiceID[:])
	copy(args[44:64], t.Recipient[:])
	copy(args[76:96], t.Token[:])
	t.Amount.FillBytes(args[96:128])
	binary.BigEndian.PutUint64(args[152:160], t.ExpiresAt)
	binary.BigEndian.PutUint64(args[184:192], t.SettleDeadline)
	binary.BigEndian.PutUint64(args[216:224], t.IntendedChainID)
	return args, nil
}

func keccak(parts ...[]byte) []byte {
	h := sha3.NewLegacyKeccak256()
	for _, p := range parts {
		h.Write(p)
	}
	return h.Sum(nil)
}

func mustHex(s string) []byte {
	b, err := hex.DecodeString(s)
	if err != nil {
		panic(err)
	}
	return b
}

func mustHex20(s string) [20]byte {
	return [20]byte(mustHex(s))
}

// InvoiceID is the on-chain id of the invoice whose pay link carries payToken (D-86): keccak256(payToken). The chain
// shows the id, never the token, so an id read from chain opens no public route; the pay page recomputes it.
func InvoiceID(payToken [32]byte) [32]byte {
	return [32]byte(keccak(payToken[:]))
}

// OptionID is the on-chain id of a payer-chooses invoice's further option (R-56). The pay page recomputes it, so an
// option's address stays tied to the link's id as a fixed invoice's is.
func OptionID(invoiceID [32]byte, chainID uint64, token [20]byte) [32]byte {
	words := make([]byte, 64)
	binary.BigEndian.PutUint64(words[24:32], chainID)
	copy(words[44:64], token[:])
	return [32]byte(keccak(invoiceID[:], words))
}

// KnownFactory parses a stored factory address and reports whether an invoice may use it.
func KnownFactory(hexAddress string) ([20]byte, bool) {
	raw, err := hex.DecodeString(strings.TrimPrefix(strings.ToLower(hexAddress), "0x"))
	if err != nil || len(raw) != 20 {
		return [20]byte{}, false
	}
	factory := [20]byte(raw)
	_, ok := Known[factory]
	return factory, ok
}

// Ours reports whether a is a known factory or its implementation: never a recipient or a refund's destination.
func Ours(a [20]byte) bool {
	for factory, implementation := range Known {
		if a == factory || a == implementation {
			return true
		}
	}
	return false
}
