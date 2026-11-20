package chain

import (
	"context"
	"fmt"
	"strings"

	"github.com/ethereum/go-ethereum"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/ethereum/go-ethereum/ethclient"
)

// TempoFeeManager is Tempo's fee precompile: an account picks its fee token there; fees go to it as Transfers.
var TempoFeeManager = common.HexToAddress("0xfeec000000000000000000000000000000000000")

var userTokens = crypto.Keccak256([]byte("userTokens(address)"))[:4]

// UserFeeToken is the token account chose in Tempo's fee manager, zero for none; tempo is false off Tempo.
func UserFeeToken(ctx context.Context, client *ethclient.Client, account common.Address) (token common.Address,
	tempo bool, err error) {
	code, err := client.CodeAt(ctx, TempoFeeManager, nil)
	if err != nil {
		return common.Address{}, false, fmt.Errorf("read the fee manager's code: %w", err)
	}
	if len(code) == 0 {
		return common.Address{}, false, nil
	}
	data := append(append([]byte{}, userTokens...), common.LeftPadBytes(account.Bytes(), 32)...)
	out, err := client.CallContract(ctx, ethereum.CallMsg{To: &TempoFeeManager, Data: data}, nil)
	if err != nil {
		return common.Address{}, true, fmt.Errorf("read the account's fee token: %w", err)
	}
	if len(out) != 32 {
		return common.Address{}, true, fmt.Errorf("read the account's fee token: %d-byte answer", len(out))
	}
	return common.BytesToAddress(out), true, nil
}

// TempoFee is SQL: t is send s's Tempo fee, to the fee manager and at most its signed fee; others are money out.
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
