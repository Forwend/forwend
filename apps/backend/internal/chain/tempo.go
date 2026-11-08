package chain

import (
	"strings"

	"github.com/ethereum/go-ethereum/common"
)

// TempoFeeManager is Tempo's fee manager precompile: an account chooses its fee token there, and a fee leaves the
// account as a Transfer of that token to it (R-224).
var TempoFeeManager = common.HexToAddress("0xfeec000000000000000000000000000000000000")

// TempoFee is the SQL test that wallet transfer t is wallet-paid send s's Tempo fee (R-224): the token's outflow from
// the send's wallet to the fee manager in the send's own transaction, where that transaction also moves the send, and
// its outflows to the fee manager together are at most the fee the send was signed for. The fee manager also swaps
// and takes liquidity, so any other transfer to it is money out: it shows in Transactions and tells the owner (D-49).
func TempoFee(t, s string) string {
	feeManager := "'" + strings.ToLower(TempoFeeManager.Hex()) + "'"
	same := `tm.chain_id = ` + t + `.chain_id AND tm.tx_hash = ` + t + `.tx_hash AND tm.wallet_address = ` + t +
		`.wallet_address AND tm.token_contract = ` + t + `.token_contract AND tm.direction = 'out' AND ` +
		`tm.status <> 'reorged'`
	return t + `.direction = 'out' AND ` + t + `.counterparty = ` + feeManager + ` AND ` + s + `.gas_limit IS NOT NULL AND ` +
		s + `.chain_id = ` + t + `.chain_id AND ` + s + `.tx_hash = ` + t + `.tx_hash AND ` + s + `.from_address = ` + t +
		`.wallet_address AND ` + s + `.token_contract = ` + t + `.token_contract AND EXISTS (SELECT 1 FROM ` +
		`wallet_transfers tm WHERE ` + same + ` AND tm.counterparty = ` + s + `.to_address AND tm.amount = ` + s +
		`.amount) AND (SELECT coalesce(sum(tm.amount), 0) FROM wallet_transfers tm WHERE ` + same +
		` AND tm.counterparty = ` + feeManager + `) <= ` + s + `.network_fee`
}
