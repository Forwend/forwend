package watcher

import (
	"context"
	"fmt"
	"math/big"

	"github.com/ethereum/go-ethereum"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/common/hexutil"
	"github.com/ethereum/go-ethereum/core/types"
)

// tokens holds, as false, each disabled token with detected rows (R-38): its logs are read until those rows
// confirm or are reorged, so they never hold the scan's start, but none of its transfers is recorded anew.
type wallets struct {
	addresses map[common.Address]bool
	tokens    map[common.Address]bool // token -> enabled
}

type walletTransfer struct {
	token, wallet, direction, counterparty string
	txHash, blockHash                      string
	logIndex, blockNumber, blockTime       uint64
	amount                                 *big.Int
	final                                  bool
}

func (c *Chain) wallets(ctx context.Context) (wallets, error) {
	var addresses, enabled, detected []string
	err := c.pool.QueryRow(ctx, `SELECT array(SELECT address FROM profile_wallets WHERE chain_family = 'evm'),
		array(SELECT contract FROM tokens WHERE chain_id = $1 AND enabled),
		array(SELECT DISTINCT token_contract FROM wallet_transfers WHERE chain_id = $1 AND status = 'detected')`,
		c.chainID).Scan(&addresses, &enabled, &detected)
	if err != nil {
		return wallets{}, fmt.Errorf("read chain %d wallets and tokens: %w", c.chainID, err)
	}
	w := wallets{addresses: map[common.Address]bool{}, tokens: map[common.Address]bool{}}
	for _, a := range addresses {
		w.addresses[common.HexToAddress(a)] = true
	}
	for _, t := range detected {
		w.tokens[common.HexToAddress(t)] = false
	}
	for _, t := range enabled {
		w.tokens[common.HexToAddress(t)] = true
	}
	return w, nil
}

// walletLogs returns a log between two of our wallets once.
func (c *Chain) walletLogs(ctx context.Context, lo, hi uint64, w wallets) ([]types.Log, error) {
	if len(w.addresses) == 0 || len(w.tokens) == 0 {
		return nil, nil
	}
	var addresses []common.Hash
	for a := range w.addresses {
		addresses = append(addresses, common.BytesToHash(a.Bytes()))
	}
	var tokens []common.Address
	for t := range w.tokens {
		tokens = append(tokens, t)
	}
	_, arc := w.tokens[arcUSDC]
	if arc {
		tokens = append(tokens, arcEmitter) // as the deposit scan: Arc USDC sent as the native coin logs only there
	}
	var out []types.Log
	seen := map[logKey]bool{}
	// One filter can't match a wallet as sender or receiver, so: sent, then received.
	var filters [][][]common.Hash
	for _, part := range parts(addresses) {
		filters = append(filters, [][]common.Hash{{transferTopic}, part}, [][]common.Hash{{transferTopic}, nil, part})
	}
	for _, topics := range filters {
		logs, err := c.filterLogs(ctx, ethereum.FilterQuery{
			FromBlock: new(big.Int).SetUint64(lo), ToBlock: new(big.Int).SetUint64(hi), Addresses: tokens, Topics: topics,
		})
		if err != nil {
			return nil, fmt.Errorf("read chain %d wallet logs %d-%d: %w", c.chainID, lo, hi, err)
		}
		for _, l := range logs {
			key := logKey{hexutil.Encode(l.BlockHash[:]), uint64(l.Index)}
			// Only a listed token counts: anyone can emit Transfer from a look-alike contract.
			_, listed := w.tokens[l.Address]
			listed = listed || arc && l.Address == arcEmitter
			if l.Removed || len(l.Topics) != 3 || len(l.Data) != 32 ||
				new(big.Int).SetBytes(l.Data).Sign() == 0 || !listed || seen[key] {
				continue
			}
			seen[key] = true
			out = append(out, l)
		}
	}
	out, err := c.arcTwins(ctx, "wallet_transfers", out)
	return nativeSends(out), err
}

// transfers marks each kept log in seen; a disabled token's log counts only when it is a detected row in open.
func (w wallets) transfers(logs []types.Log, open []pending, headers map[uint64]header, finalized uint64,
	seen map[logKey]bool) []walletTransfer {
	detected := map[logKey]bool{}
	for _, p := range open {
		detected[logKey{p.blockHash, p.logIndex}] = true
	}
	var out []walletTransfer
	for _, l := range logs {
		h, ok := headers[l.BlockNumber]
		if !ok || h.Hash != l.BlockHash {
			continue // as for deposits: the next scan sees it again
		}
		if !w.tokens[l.Address] && !detected[logKey{hexutil.Encode(l.BlockHash[:]), uint64(l.Index)}] {
			continue
		}
		from, to := common.BytesToAddress(l.Topics[1].Bytes()), common.BytesToAddress(l.Topics[2].Bytes())
		t := walletTransfer{
			token: hexutil.Encode(l.Address[:]), txHash: hexutil.Encode(l.TxHash[:]),
			blockHash: hexutil.Encode(l.BlockHash[:]), logIndex: uint64(l.Index), blockNumber: l.BlockNumber,
			blockTime: uint64(h.Timestamp), amount: new(big.Int).SetBytes(l.Data), final: l.BlockNumber <= finalized,
		}
		if w.addresses[from] {
			t.wallet, t.direction, t.counterparty = hexutil.Encode(from[:]), "out", hexutil.Encode(to[:])
			out = append(out, t)
		}
		if w.addresses[to] {
			t.wallet, t.direction, t.counterparty = hexutil.Encode(to[:]), "in", hexutil.Encode(from[:])
			out = append(out, t)
		}
		seen[logKey{t.blockHash, t.logIndex}] = true
	}
	return out
}
