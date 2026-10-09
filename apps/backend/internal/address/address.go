// Package address computes an invoice's receive address locally, exactly as InvoiceReceiverFactory.predict does.
// It is tested against vectors written by packages/contracts/script/ReceiveAddressVectors.s.sol.
package address

import (
	"encoding/binary"
	"encoding/hex"
	"errors"
	"math/big"

	"golang.org/x/crypto/sha3"
)

// The v1 factory, at one address on every chain (packages/contracts/deployments.json), and the receiver
// implementation it created. A contract change means a new factory and new values here.
var (
	Factory        = mustHex20("ECe745390524e4d0B05D26F56AF7F1D38FDb7546")
	Implementation = mustHex20("322F6c8dAf0a8bd7cF16eb62D0a04700eEA4b639")
)

// ErrAmount means the amount does not fit a uint256.
var ErrAmount = errors.New("amount must be between 0 and 2^256-1")

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

// Receive returns the receiver address the factory deploys for t: a CREATE2 clone (OpenZeppelin
// Clones.cloneDeterministicWithImmutableArgs) with args = abi.encode(t) and salt = keccak256(args).
func Receive(t Terms) ([20]byte, error) {
	args, err := t.Encode()
	if err != nil {
		return [20]byte{}, err
	}

	// Clones._cloneCodeWithImmutableArgs: 0x61 <uint16 len(args)+0x2d> <prefix> <implementation> <suffix> <args>.
	code := []byte{0x61, 0, 0}
	binary.BigEndian.PutUint16(code[1:3], uint16(len(args)+0x2d))
	code = append(code, mustHex("3d81600a3d39f3363d3d373d3d3d363d73")...)
	code = append(code, Implementation[:]...)
	code = append(code, mustHex("5af43d82803e903d91602b57fd5bf3")...)
	code = append(code, args...)

	// CREATE2: keccak256(0xff ++ factory ++ salt ++ keccak256(init code))[12:].
	salt := keccak(args)
	hash := keccak([]byte{0xff}, Factory[:], salt, keccak(code))
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
