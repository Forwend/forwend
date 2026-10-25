// Package ledger books confirmed deposits and moves each invoice's payment status from the money it holds (R-21).
package ledger

import (
	"context"
	"errors"
	"fmt"
	"math/big"

	"github.com/ethereum/go-ethereum"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/ethereum/go-ethereum/ethclient"
	"github.com/ethereum/go-ethereum/rpc"
)

// Payment statuses. paid, expired, expired_partially_paid and canceled are final but for one Reopen (R-130); the
// database rejects any other transition. The owner cancels (invoice.Cancel); the ledger never does.
const (
	Open                 = "open"
	Detected             = "detected"
	PartiallyPaid        = "partially_paid"
	Paid                 = "paid"
	Expired              = "expired"
	ExpiredPartiallyPaid = "expired_partially_paid"
	Canceled             = "canceled"
)

// Why money is held for the payer (D-26), in the order a run writes them to the history.
const (
	HeldOverpaid    = "overpaid" // more than the amount, or sent after it was paid
	HeldLate        = "late"     // sent after the checkout closed
	HeldExpired     = "expired"  // what was paid of an invoice that expired unpaid; the owner may reopen it (R-130)
	HeldCanceled    = "canceled"
	HeldOtherOption = "other_option" // sent to an option the payer did not choose (D-76)
)

var heldReasons = []string{HeldOverpaid, HeldLate, HeldExpired, HeldCanceled, HeldOtherOption}

// heldReason is why the held part of a deposit is the payer's.
func heldReason(current string, late, superseded bool) string {
	switch {
	case current == Canceled:
		return HeldCanceled
	case superseded:
		return HeldOtherOption
	case late || current == Expired || current == ExpiredPartiallyPaid:
		return HeldLate
	}
	return HeldOverpaid
}

// Final is a status that takes no more money for the creator: every later deposit is held for the payer (D-26).
func Final(status string) bool {
	return status == Paid || status == Expired || status == ExpiredPartiallyPaid || status == Canceled
}

// BalanceOf reads from an RPC other than the watcher's, at its finalized block, so one bad provider can't mark an
// invoice paid (D-15, D-45). An answer from behind the watcher's finalized block can miss deposits and is not used.
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

// funded: the second RPC agrees the receive address holds every booked deposit; mayExpire: expiry has passed and
// the chain holds exactly what is booked.
func status(current string, amount, owed *big.Int, anyTransfer, mayExpire, funded bool) string {
	switch {
	case Final(current):
		return current
	case owed.Cmp(amount) >= 0 && funded:
		return Paid
	case owed.Cmp(amount) >= 0 && current == PartiallyPaid:
		return PartiallyPaid // the database allows no way back to detected
	case owed.Cmp(amount) >= 0:
		// Paid in full and on time, waiting for the second RPC to agree; it never expires.
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
	// Every RPC in the chain list serves eth_call at its finalized block.
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

// DeployedAt reads factory.deployedAt(receiver) at the finalized block: 0 when the receiver is not deployed. An early
// deploy, a refund authority recovery, ends the receiver's settle window at deployedAt + 30 days (R-130).
type DeployedAt func(ctx context.Context, chainID uint64, factory, receiver string) (uint64, error)

// DeployedFrom reads with BalanceFrom's clients, the second RPC per chain.
func DeployedFrom(clients map[uint64]*ethclient.Client) DeployedAt {
	return func(ctx context.Context, chainID uint64, factory, receiver string) (uint64, error) {
		client, ok := clients[chainID]
		if !ok {
			return 0, fmt.Errorf("no deployedAt RPC for chain %d", chainID)
		}
		final, err := client.HeaderByNumber(ctx, big.NewInt(int64(rpc.FinalizedBlockNumber)))
		if err != nil {
			return 0, fmt.Errorf("deployedAt %s on chain %d: read finalized block: %w", receiver, chainID, err)
		}
		to := common.HexToAddress(factory)
		data := append(crypto.Keccak256([]byte("deployedAt(address)"))[:4],
			common.LeftPadBytes(common.HexToAddress(receiver).Bytes(), 32)...)
		out, err := client.CallContract(ctx, ethereum.CallMsg{To: &to, Data: data}, final.Number)
		if err != nil {
			return 0, fmt.Errorf("deployedAt %s on chain %d: %w", receiver, chainID, err)
		}
		// Empty means no factory there: never read as "not deployed".
		if len(out) != 32 {
			return 0, fmt.Errorf("deployedAt %s on chain %d: %d-byte answer", receiver, chainID, len(out))
		}
		return new(big.Int).SetBytes(out).Uint64(), nil
	}
}

// The ledger never reads an empty answer as 0: it must not let an invoice expire with money in it.
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
