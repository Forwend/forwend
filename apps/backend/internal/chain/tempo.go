package chain

import (
	"bytes"

	"github.com/ethereum/go-ethereum/common"
)

// TempoFeeManager is Tempo's fee manager precompile: an account chooses its fee token there, and a fee leaves the
// account as a Transfer of that token to it (R-224).
var TempoFeeManager = common.HexToAddress("0xfeec000000000000000000000000000000000000")

// TIP20 reports whether token is a Tempo TIP-20 token: they all sit at addresses starting 0x20c0, and only TIP-20 USD
// tokens pay Tempo fees.
func TIP20(token common.Address) bool {
	return bytes.HasPrefix(token.Bytes(), []byte{0x20, 0xc0})
}
