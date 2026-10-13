// Package ledger books confirmed deposits and moves each invoice's payment status from the money it holds (R-21).
package ledger

import (
	"context"
	"errors"
	"fmt"
	"math/big"

	"github.com/ethereum/go-ethereum"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/ethclient"
	"github.com/ethereum/go-ethereum/rpc"
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

// BalanceOf reads a token balance from an RPC independent of the watcher's, at that RPC's own finalized block, so
// one bad provider can't mark an invoice paid with money that isn't final (D-15, D-45). It also returns the block it
// read at: an answer from behind the watcher's finalized block can miss final deposits and is not used.
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
	case owed.Cmp(amount) >= 0 && current == PartiallyPaid:
		return PartiallyPaid // the database allows no way back to detected
	case owed.Cmp(amount) >= 0:
		// Paid in full and on time, waiting for the second RPC to agree: money seen, not a partial payment. It never
		// expires.
		return Detected
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
	// Every RPC in the chain list serves eth_call at its finalized block (checked 2026-10-09).
	return func(ctx context.Context, chainID uint64, token, holder string) (*big.Int, uint64, error) {
		client, ok := clients[chainID]
		if !ok {
			return nil, 0, fmt.Errorf("no balance RPC for chain %d", chainID)
		}
		final, err := client.HeaderByNumber(ctx, big.NewInt(int64(rpc.FinalizedBlockNumber)))
		if err != nil {
			return nil, 0, fmt.Errorf("balanceOf %s on chain %d: read finalized block: %w", holder, chainID, err)
		}
		head := final.Number.Uint64()
		balance, err := BalanceAt(ctx, client, chainID, token, holder, head)
		if err != nil {
			return nil, 0, err
		}
		return balance, head, nil
	}
}

// ErrNoToken is an empty balanceOf answer: no token contract at that block. The ledger never reads it as 0 (an RPC
// that answers empty must not let an invoice expire with money in it).
var ErrNoToken = errors.New("no token contract at the block")

func BalanceAt(ctx context.Context, client *ethclient.Client, chainID uint64, token, holder string,
	block uint64) (*big.Int, error) {
	to := common.HexToAddress(token)
	data := append(common.FromHex("0x70a08231"), common.LeftPadBytes(common.HexToAddress(holder).Bytes(), 32)...)
	out, err := client.CallContract(ctx, ethereum.CallMsg{To: &to, Data: data}, new(big.Int).SetUint64(block))
	if err != nil {
		return nil, fmt.Errorf("balanceOf %s on chain %d: %w", holder, chainID, err)
	}
	switch len(out) {
	case 0:
		return nil, fmt.Errorf("balanceOf %s on chain %d: %w", holder, chainID, ErrNoToken)
	case 32:
		return new(big.Int).SetBytes(out), nil
	}
	return nil, fmt.Errorf("balanceOf %s on chain %d: %d-byte answer", holder, chainID, len(out))
}
