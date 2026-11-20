package settlement

import (
	"context"
	"errors"
	"fmt"
	"math/big"
	"strings"

	"github.com/ethereum/go-ethereum"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/ethereum/go-ethereum/ethclient"
	"github.com/ethereum/go-ethereum/rpc"
	"github.com/forwend/forwend/apps/backend/internal/address"
	"github.com/forwend/forwend/apps/backend/internal/watcher"
)

// Calls to packages/contracts/src/InvoiceReceiverFactory.sol and InvoiceReceiver.sol.
var (
	settleSelector    = selector("settle()")
	settledSelector   = selector("settled()")
	authoritySelector = selector("refundAuthority()")
)

var (
	errUnknownFactory = errors.New("invoice factory is not a Forwend factory")
	errOtherReceiver  = errors.New("terms do not compute the stored receive address")
)

func selector(signature string) []byte {
	return crypto.Keccak256([]byte(signature))[:4]
}

// onChain is factory.status(terms): InvoiceStatus in packages/contracts/src/InvoiceTypes.sol.
type onChain struct {
	Receiver        common.Address
	Deployed        bool
	OnIntendedChain bool
	Balance         *big.Int
	Settled         bool
	Refundable      *big.Int
	Settleable      bool
	Settler         common.Address
	Deadline        uint64
}

func factoryStatus(ctx context.Context, client *ethclient.Client, factory common.Address, terms address.Terms) (onChain, error) {
	data, err := address.Call([20]byte(factory), "status", terms)
	if err != nil {
		return onChain{}, err
	}
	out, err := client.CallContract(ctx, ethereum.CallMsg{To: &factory, Data: data}, nil)
	if err != nil {
		return onChain{}, fmt.Errorf("factory.status: %w", err)
	}
	if len(out) != 9*32 {
		return onChain{}, fmt.Errorf("factory.status: %d-byte answer", len(out))
	}
	word := func(i int) []byte { return out[i*32 : (i+1)*32] }
	return onChain{
		Receiver: common.BytesToAddress(word(0)), Deployed: word(1)[31] == 1, OnIntendedChain: word(2)[31] == 1,
		Balance: new(big.Int).SetBytes(word(3)), Settled: word(4)[31] == 1, Refundable: new(big.Int).SetBytes(word(5)),
		Settleable: word(6)[31] == 1, Settler: common.BytesToAddress(word(7)), Deadline: new(big.Int).SetBytes(word(8)).Uint64(),
	}, nil
}

// finalized is the block tag for reads a reorg must not undo.
var finalized = big.NewInt(int64(rpc.FinalizedBlockNumber))

// receiverSettled reads the receiver's own settled flag at block (nil: latest); false before it is deployed.
func receiverSettled(ctx context.Context, client *ethclient.Client, receiver common.Address, block *big.Int) (bool, error) {
	out, err := client.CallContract(ctx, ethereum.CallMsg{To: &receiver, Data: settledSelector}, block)
	if err != nil {
		return false, fmt.Errorf("receiver.settled: %w", err)
	}
	return len(out) == 32 && out[31] == 1, nil
}

// settledBy: only a successful settle logs Settled.
func settledBy(r *types.Receipt, receiver common.Address) bool {
	if r.Status != types.ReceiptStatusSuccessful {
		return false
	}
	for _, l := range r.Logs {
		if l.Address == receiver && len(l.Topics) > 0 && l.Topics[0] == watcher.SettledTopic {
			return true
		}
	}
	return false
}

// termsOf builds an option's terms and checks a Forwend factory computes its stored receive address; returns it.
func termsOf(invoiceID, factory, recipient, token, receive string, amount *big.Int, fees [2]*big.Int, expires, deadline,
	chainID uint64) ([20]byte, address.Terms, error) {
	known, ok := address.KnownFactory(factory)
	if !ok {
		return [20]byte{}, address.Terms{}, errUnknownFactory
	}
	terms := address.Terms{
		InvoiceID: [32]byte(common.FromHex(invoiceID)), Recipient: common.HexToAddress(recipient),
		Token: common.HexToAddress(token), Amount: amount, ExpiresAt: expires, SettleDeadline: deadline,
		IntendedChainID: chainID, NetworkFee: fees[0], PlatformFee: fees[1],
	}
	if at, err := address.ReceiveAt(known, terms); err != nil || !strings.EqualFold(common.Address(at).Hex(), receive) {
		return [20]byte{}, address.Terms{}, errOtherReceiver
	}
	return known, terms, nil
}

// readTerms reads an option's terms and checks them as termsOf does.
func readTerms(ctx context.Context, db querier, invoiceID string) ([20]byte, address.Terms, error) {
	var factory, recipient, token, receive string
	var amount [3]string // amount, network fee, platform fee
	var expires, deadline, chainID uint64
	if err := db.QueryRow(ctx, `SELECT factory_address, recipient_address, token_contract, receive_address, amount::text,
		network_fee::text, platform_fee::text, expires_at, settle_deadline, chain_id FROM invoices WHERE id = $1`,
		invoiceID).Scan(&factory, &recipient, &token, &receive, &amount[0], &amount[1], &amount[2], &expires, &deadline,
		&chainID); err != nil {
		return [20]byte{}, address.Terms{}, fmt.Errorf("read invoice %s terms: %w", invoiceID, err)
	}
	var value [3]*big.Int
	for i, a := range amount {
		value[i], _ = new(big.Int).SetString(a, 10)
	}
	known, terms, err := termsOf(invoiceID, factory, recipient, token, receive, value[0], [2]*big.Int{value[1], value[2]},
		expires, deadline, chainID)
	if err != nil {
		return [20]byte{}, address.Terms{}, fmt.Errorf("invoice %s: %w", invoiceID, err)
	}
	return known, terms, nil
}

func refundAuthority(ctx context.Context, client *ethclient.Client, factory common.Address) (common.Address, error) {
	out, err := client.CallContract(ctx, ethereum.CallMsg{To: &factory, Data: authoritySelector}, nil)
	if err != nil {
		return common.Address{}, fmt.Errorf("factory.refundAuthority: %w", err)
	}
	if len(out) != 32 {
		return common.Address{}, fmt.Errorf("factory.refundAuthority: %d-byte answer", len(out))
	}
	return common.BytesToAddress(out), nil
}

// deployCall is the refund authority's factory.deploy of an option's receiver.
func deployCall(factory [20]byte, invoiceID string, terms address.Terms) (Call, error) {
	data, err := address.Call(factory, "deploy", terms)
	if err != nil {
		return Call{}, err
	}
	signature, _ := address.Signature(factory, "deploy")
	args, _ := address.Args(factory, invoiceID, terms)
	return Call{To: factory, Data: data, Signature: signature, Args: []string{args}}, nil
}
