// Package address computes an invoice's receive address locally, exactly as InvoiceReceiverFactory.predict does.
// It is tested against vectors written by packages/contracts/script/ReceiveAddressVectors.s.sol.
package address

import (
	"encoding/binary"
	"encoding/hex"
	"errors"
	"fmt"
	"math/big"
	"strings"

	"golang.org/x/crypto/sha3"
)

// Factory is the newest factory, at one address on every chain (packages/contracts/deployments.json), and
// Implementation the receiver implementation it created. New invoices use them; a contract change means new values.
var (
	Factory        = mustHex20("e917cE63865f8Cf91a0038136E496B25eCE2A54e") // v2
	Implementation = mustHex20("81CdA02E469083fD14A75583257d9b721Ca76132")
)

// Spec is a factory's receiver implementation, whether its terms carry the fees (v2 on, R-226), and the refund
// authority a v2 settlement pays the platform fee. The authority is in the factory's CREATE2 init code, so a factory
// address has the same one on every chain.
type Spec struct {
	Implementation  [20]byte
	Fees            bool
	RefundAuthority [20]byte
}

// Known maps every factory an invoice may still use to its spec. An invoice keeps the factory it was made with, so a
// replaced factory stays here until none of its invoices can hold money.
var Known = map[[20]byte]Spec{
	Factory: {Implementation: Implementation, Fees: true, RefundAuthority: mustHex20("3E202009C02aBc635eE83fb5c9D1eE3F10FEEa00")},
	mustHex20("f93da73F1308A9B34aAB78bF6D84F0BAcc600dd2"): {Implementation: mustHex20("26b7DB220aF2Da25B960E7e5bCcf80a708aE630f")}, // v1.1
	mustHex20("ECe745390524e4d0B05D26F56AF7F1D38FDb7546"): {Implementation: mustHex20("322F6c8dAf0a8bd7cF16eb62D0a04700eEA4b639")}, // v1
}

var (
	ErrAmount         = errors.New("amount and fees must be between 0 and 2^256-1")
	ErrUnknownFactory = errors.New("not a Forwend factory")
	ErrFees           = errors.New("this factory's terms carry no fees")
)

// Terms mirrors InvoiceTerms in packages/contracts/src/InvoiceTypes.sol, in ABI field order. The fees are only in a
// v2 factory's terms; nil is 0.
type Terms struct {
	InvoiceID       [32]byte
	Recipient       [20]byte
	Token           [20]byte
	Amount          *big.Int
	ExpiresAt       uint64
	SettleDeadline  uint64
	IntendedChainID uint64
	NetworkFee      *big.Int
	PlatformFee     *big.Int
}

// Receive returns the receiver address the newest factory deploys for t.
func Receive(t Terms) ([20]byte, error) {
	return ReceiveAt(Factory, t)
}

// ReceiveAt returns the receiver address a known factory deploys for t: a CREATE2 clone (OpenZeppelin
// Clones.cloneDeterministicWithImmutableArgs) with args = abi.encode(t) and salt = keccak256(args).
func ReceiveAt(factory [20]byte, t Terms) ([20]byte, error) {
	spec, ok := Known[factory]
	if !ok {
		return [20]byte{}, ErrUnknownFactory
	}
	implementation := spec.Implementation
	args, err := t.encode(spec.Fees)
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

// Encode is abi.encode(InvoiceTerms) for a known factory: the clone's immutable args, and the argument of
// factory.deploy, predict and status.
func Encode(factory [20]byte, t Terms) ([]byte, error) {
	spec, ok := Known[factory]
	if !ok {
		return nil, ErrUnknownFactory
	}
	return t.encode(spec.Fees)
}

// Call is the calldata of the factory's function fn (deploy, predict or status) with t.
func Call(factory [20]byte, fn string, t Terms) ([]byte, error) {
	signature, err := Signature(factory, fn)
	if err != nil {
		return nil, err
	}
	args, err := Encode(factory, t)
	if err != nil {
		return nil, err
	}
	return append(keccak([]byte(signature))[:4], args...), nil
}

// Signature is fn's signature on the factory, as a Safe's Transaction Builder takes it.
func Signature(factory [20]byte, fn string) (string, error) {
	spec, ok := Known[factory]
	if !ok {
		return "", ErrUnknownFactory
	}
	tuple := "(bytes32,address,address,uint256,uint64,uint64,uint256)"
	if spec.Fees {
		tuple = "(bytes32,address,address,uint256,uint64,uint64,uint256,uint256,uint256)"
	}
	return fn + "(" + tuple + ")", nil
}

// Args writes t as the factory's tuple for a Safe's Transaction Builder, with id the 0x invoice id it shows.
func Args(factory [20]byte, id string, t Terms) (string, error) {
	spec, ok := Known[factory]
	if !ok {
		return "", ErrUnknownFactory
	}
	out := fmt.Sprintf("(%s,%s,%s,%s,%d,%d,%d", id, hex0x(t.Recipient[:]), hex0x(t.Token[:]), t.Amount, t.ExpiresAt,
		t.SettleDeadline, t.IntendedChainID)
	if spec.Fees {
		out += fmt.Sprintf(",%s,%s", orZero(t.NetworkFee), orZero(t.PlatformFee))
	}
	return out + ")", nil
}

func (t Terms) encode(fees bool) ([]byte, error) {
	if !inUint256(t.Amount) || t.NetworkFee != nil && !inUint256(t.NetworkFee) ||
		t.PlatformFee != nil && !inUint256(t.PlatformFee) {
		return nil, ErrAmount
	}
	if !fees && (orZero(t.NetworkFee).Sign() != 0 || orZero(t.PlatformFee).Sign() != 0) {
		return nil, ErrFees
	}
	words := 7
	if fees {
		words = 9
	}
	args := make([]byte, words*32)
	copy(args[0:32], t.InvoiceID[:])
	copy(args[44:64], t.Recipient[:])
	copy(args[76:96], t.Token[:])
	t.Amount.FillBytes(args[96:128])
	binary.BigEndian.PutUint64(args[152:160], t.ExpiresAt)
	binary.BigEndian.PutUint64(args[184:192], t.SettleDeadline)
	binary.BigEndian.PutUint64(args[216:224], t.IntendedChainID)
	if fees {
		orZero(t.NetworkFee).FillBytes(args[224:256])
		orZero(t.PlatformFee).FillBytes(args[256:288])
	}
	return args, nil
}

func inUint256(n *big.Int) bool {
	return n != nil && n.Sign() >= 0 && n.BitLen() <= 256
}

func orZero(n *big.Int) *big.Int {
	if n == nil {
		return new(big.Int)
	}
	return n
}

func hex0x(b []byte) string {
	return "0x" + hex.EncodeToString(b)
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
	for factory, spec := range Known {
		if a == factory || a == spec.Implementation {
			return true
		}
	}
	return false
}
