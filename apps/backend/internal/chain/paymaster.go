package chain

import "strconv"

// PaymasterFeeSlack: a paymaster's fee is at most this many times the send's quoted network fee. More money out of the
// wallet in the send's transaction is no fee: it shows in Transactions and tells the owner (D-49).
const PaymasterFeeSlack = 3

// PaymasterFee is the SQL test that wallet transfer t is relayed send s's paymaster fee (R-224, R-225): an outflow of
// the token from the send's wallet in the transaction Privy gave the send, to anyone but its recipient, where that
// transaction also moves the send, and all such outflows in it together are within PaymasterFeeSlack times its
// quoted fee.
func PaymasterFee(t, s string) string {
	same := `pm.chain_id = ` + t + `.chain_id AND pm.tx_hash = ` + t + `.tx_hash AND pm.wallet_address = ` + t +
		`.wallet_address AND pm.token_contract = ` + t + `.token_contract AND pm.direction = 'out' AND ` +
		`pm.status <> 'reorged'`
	return t + `.direction = 'out' AND ` + s + `.privy_transaction_id IS NOT NULL AND ` + s + `.chain_id = ` + t +
		`.chain_id AND ` + s + `.tx_hash = ` + t + `.tx_hash AND ` + s + `.from_address = ` + t + `.wallet_address AND ` +
		s + `.token_contract = ` + t + `.token_contract AND ` + s + `.to_address <> ` + t + `.counterparty AND ` +
		`EXISTS (SELECT 1 FROM wallet_transfers pm WHERE ` + same + ` AND pm.counterparty = ` + s + `.to_address AND ` +
		`pm.amount = ` + s + `.amount) AND (SELECT coalesce(sum(pm.amount), 0) FROM wallet_transfers pm WHERE ` + same +
		` AND pm.counterparty <> ` + s + `.to_address) <= ` + strconv.Itoa(PaymasterFeeSlack) + ` * ` + s + `.network_fee`
}
