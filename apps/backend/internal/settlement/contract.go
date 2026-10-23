package settlement

import (
	"context"
	"fmt"
	"math/big"

	"github.com/ensp1re/forwend/apps/backend/internal/address"
	"github.com/ethereum/go-ethereum"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/ethereum/go-ethereum/ethclient"
	"github.com/ethereum/go-ethereum/rpc"
)

// The only calls the signer makes (packages/contracts/src/InvoiceReceiverFactory.sol, InvoiceReceiver.sol).
var (
	deploySelector  = selector("deploy((bytes32,address,address,uint256,uint64,uint64,uint256))")
	statusSelector  = selector("status((bytes32,address,address,uint256,uint64,uint64,uint256))")
	settleSelector  = selector("settle()")
	settledSelector = selector("settled()")
	// Logged only by a successful settle.
	settledEvent = crypto.Keccak256Hash([]byte("Settled(bytes32,address,uint256)"))
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
	Settleable      bool
	Settler         common.Address
}

func factoryStatus(ctx context.Context, client *ethclient.Client, terms address.Terms) (onChain, error) {
	data, err := callData(statusSelector, terms)
	if err != nil {
		return onChain{}, err
	}
	factory := common.Address(address.Factory)
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
		Balance: new(big.Int).SetBytes(word(3)), Settled: word(4)[31] == 1, Settleable: word(6)[31] == 1,
		Settler: common.BytesToAddress(word(7)),
	}, nil
}

func callData(sel []byte, terms address.Terms) ([]byte, error) {
	args, err := terms.Encode()
	if err != nil {
		return nil, err
	}
	return append(append([]byte{}, sel...), args...), nil
}

// finalized is the block tag for reads that must not be undone by a reorg (D-45).
var finalized = big.NewInt(int64(rpc.FinalizedBlockNumber))

// receiverSettled reads the receiver's own settled flag at block (nil: latest); false before it is deployed.
func receiverSettled(ctx context.Context, client *ethclient.Client, receiver common.Address, block *big.Int) (bool, error) {
	out, err := client.CallContract(ctx, ethereum.CallMsg{To: &receiver, Data: settledSelector}, block)
	if err != nil {
		return false, fmt.Errorf("receiver.settled: %w", err)
	}
	return len(out) == 32 && out[31] == 1, nil
}

func settledBy(r *types.Receipt, receiver common.Address) bool {
	if r.Status != types.ReceiptStatusSuccessful {
		return false
	}
	for _, l := range r.Logs {
		if l.Address == receiver && len(l.Topics) > 0 && l.Topics[0] == settledEvent {
			return true
		}
	}
	return false
}
