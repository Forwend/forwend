package chain

import (
	"strings"

	"github.com/ethereum/go-ethereum/common"
)

// TempoFeeManager is Tempo's fee manager precompile: an account chooses its fee token there, and a fee leaves the
// account as a Transfer of that token to it (R-224).
var TempoFeeManager = common.HexToAddress("0xfeec000000000000000000000000000000000000")

// TempoFee is the SQL test that wallet transfer t is wallet-paid send s's Tempo fee (R-224): the token's outflow from
// the send's wallet to the fee manager, at most the fee the send was signed for together. The transaction is the one
// whose hash the owner's browser reported for the send; or, until it reports one, a transaction since the send's
// approval that moves exactly the send, as the send's own transfer is matched (D-49). Tempo blocks are final at once,
// so the watcher may see the fee before the hash. The fee manager also swaps and takes liquidity, so any other
// transfer to it is money out: it shows in Transactions and tells the owner.
func TempoFee(t, s string) string {
	feeManager := "'" + strings.ToLower(TempoFeeManager.Hex()) + "'"
	same := `tm.chain_id = ` + t + `.chain_id AND tm.tx_hash = ` + t + `.tx_hash AND tm.wallet_address = ` + t +
		`.wallet_address AND tm.token_contract = ` + t + `.token_contract AND tm.direction = 'out' AND ` +
		`tm.status <> 'reorged'`
	return t + `.direction = 'out' AND ` + t + `.counterparty = ` + feeManager + ` AND ` + s + `.gas_limit IS NOT NULL AND ` +
		s + `.chain_id = ` + t + `.chain_id AND ` + s + `.from_address = ` + t + `.wallet_address AND ` + s +
		`.token_contract = ` + t + `.token_contract AND (` + s + `.tx_hash = ` + t + `.tx_hash OR ` + s +
		`.tx_hash IS NULL AND ` + s + `.approved_at IS NOT NULL AND ` + t + `.created_at >= ` + s + `.approved_at AND (` +
		s + `.status = 'approved' OR ` + s + `.status = 'expired' AND ` + t + `.created_at < ` + s +
		`.finished_at + interval '1 hour') AND EXISTS (SELECT 1 FROM wallet_transfers tm WHERE ` + same +
		` AND tm.counterparty = ` + s + `.to_address AND tm.amount = ` + s + `.amount)) AND ` +
		`(SELECT coalesce(sum(tm.amount), 0) FROM wallet_transfers tm WHERE ` + same + ` AND tm.counterparty = ` +
		feeManager + `) <= ` + s + `.network_fee`
}
