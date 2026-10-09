// Package ledger books confirmed deposits and moves each invoice's payment status from the money it holds (R-21).
package ledger

import (
	"context"
	"fmt"
	"math/big"

	"github.com/ethereum/go-ethereum"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/ethclient"
)

// Payment statuses. paid, expired and expired_partially_paid are final; the database rejects any other transition.
const (
	Open                 = "open"
	Detected             = "detected"
	PartiallyPaid        = "partially_paid"
	Paid                 = "paid"
	Expired              = "expired"
	ExpiredPartiallyPaid = "expired_partially_paid"
)

// BalanceOf reads a token balance from an RPC independent of the watcher's, so one bad provider can't mark an
// invoice paid (D-15). It also returns the block it read at: an answer from behind the watcher's finalized block
// can miss final deposits and is not used.
type BalanceOf func(ctx context.Context, chainID uint64, token, holder string) (balance *big.Int, block uint64, err error)

// split divides a deposit between what is still owed to the creator and what is held for the payer (D-24, D-26).
// Nothing goes to the creator once the invoice is final or the deposit is late.
func split(amount, owedSoFar, deposit *big.Int, late, final bool) (toCreator, toHeld *big.Int) {
	toCreator = new(big.Int)
	if !late && !final {
		toCreator.Sub(amount, owedSoFar)
		if toCreator.Sign() < 0 {
			toCreator.SetInt64(0)
		}
		if toCreator.Cmp(deposit) > 0 {
			toCreator.Set(deposit)
		}
	}
	return toCreator, new(big.Int).Sub(deposit, toCreator)
}

// status is the next payment status from the booked money. funded means the second RPC agrees the receive address
// holds every booked deposit; mayExpire means expiry has passed and the chain holds exactly what is booked.
func status(current string, amount, owed *big.Int, anyTransfer, mayExpire, funded bool) string {
	switch {
	case current == Paid || current == Expired || current == ExpiredPartiallyPaid:
		return current
	case owed.Cmp(amount) >= 0 && funded:
		return Paid
	case owed.Cmp(amount) >= 0: // paid in full and on time: never expires, waits for the second RPC
		return PartiallyPaid
	case mayExpire && owed.Sign() > 0:
		return ExpiredPartiallyPaid
	case mayExpire:
		return Expired
	case owed.Sign() > 0:
		return PartiallyPaid
	case anyTransfer:
		return Detected
	}
	return Open
}

// BalanceFrom reads balances with one client per chain: give it RPCs other than the watcher's (D-15).
func BalanceFrom(clients map[uint64]*ethclient.Client) BalanceOf {
	// Reads at the node's own head: non-archive RPCs can't read state at an old finalized block.
	return func(ctx context.Context, chainID uint64, token, holder string) (*big.Int, uint64, error) {
		client, ok := clients[chainID]
		if !ok {
			return nil, 0, fmt.Errorf("no balance RPC for chain %d", chainID)
		}
		head, err := client.BlockNumber(ctx)
		if err != nil {
			return nil, 0, fmt.Errorf("balanceOf %s on chain %d: %w", holder, chainID, err)
		}
		to := common.HexToAddress(token)
		data := append(common.FromHex("0x70a08231"), common.LeftPadBytes(common.HexToAddress(holder).Bytes(), 32)...)
		out, err := client.CallContract(ctx, ethereum.CallMsg{To: &to, Data: data}, new(big.Int).SetUint64(head))
		if err != nil {
			return nil, 0, fmt.Errorf("balanceOf %s on chain %d: %w", holder, chainID, err)
		}
		if len(out) != 32 {
			return nil, 0, fmt.Errorf("balanceOf %s on chain %d: %d-byte answer", holder, chainID, len(out))
		}
		return new(big.Int).SetBytes(out), head, nil
	}
}
