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
// invoice paid (D-15).
type BalanceOf func(ctx context.Context, chainID uint64, token, holder string) (*big.Int, error)

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

// status is the next payment status from the booked money and the chain's finalized time. funded means the second
// RPC agrees the receive address holds every booked deposit.
func status(current string, amount, owed *big.Int, anyTransfer, expired, funded bool) string {
	switch {
	case current == Paid || current == Expired || current == ExpiredPartiallyPaid:
		return current
	case owed.Cmp(amount) >= 0 && funded:
		return Paid
	case expired && owed.Sign() > 0:
		return ExpiredPartiallyPaid
	case expired:
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
	return func(ctx context.Context, chainID uint64, token, holder string) (*big.Int, error) {
		client, ok := clients[chainID]
		if !ok {
			return nil, fmt.Errorf("no balance RPC for chain %d", chainID)
		}
		to := common.HexToAddress(token)
		data := append(common.FromHex("0x70a08231"), common.LeftPadBytes(common.HexToAddress(holder).Bytes(), 32)...)
		out, err := client.CallContract(ctx, ethereum.CallMsg{To: &to, Data: data}, nil)
		if err != nil {
			return nil, fmt.Errorf("balanceOf %s on chain %d: %w", holder, chainID, err)
		}
		if len(out) != 32 {
			return nil, fmt.Errorf("balanceOf %s on chain %d: %d-byte answer", holder, chainID, len(out))
		}
		return new(big.Int).SetBytes(out), nil
	}
}
