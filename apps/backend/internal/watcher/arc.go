package watcher

import (
	"bytes"
	"context"
	"fmt"
	"math/big"
	"slices"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/common/hexutil"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/ethereum/go-ethereum/rpc"
)

// On Arc, USDC is the native coin; its ERC-20 interface at arcUSDC shows the same balance in 6 decimals. Every USDC
// movement also logs Transfer from arcEmitter in 18 decimals, and a plain native send logs only that
// (docs.arc.io/arc/references/usdc-system-events). No contract can emit a log from arcEmitter: it has no code.
var (
	arcUSDC    = common.HexToAddress("0x3600000000000000000000000000000000000000")
	arcEmitter = common.HexToAddress("0xfffffffffffffffffffffffffffffffffffffffe")
	arcScale   = big.NewInt(1e12)
)

type txLog struct {
	tx    common.Hash
	index uint
}

// twins marks each Arc system log whose token log is in logs. An ERC-20 transfer logs its system twin just before it:
// one index earlier, or two for a CCTP mint or burn. Each token log takes at most one twin, the nearest.
func twins(logs []types.Log) map[int]bool {
	system := map[txLog]int{}
	var tokens []int
	for i, l := range logs {
		if l.Address == arcEmitter {
			system[txLog{l.TxHash, l.Index}] = i
		} else {
			tokens = append(tokens, i)
		}
	}
	twin := map[int]bool{}
	if len(system) == 0 {
		return twin
	}
	slices.SortFunc(tokens, func(a, b int) int { return int(logs[a].Index) - int(logs[b].Index) })
	for _, j := range tokens {
		t := logs[j]
		for back := uint(1); back <= 2 && back <= t.Index; back++ {
			i, ok := system[txLog{t.TxHash, t.Index - back}]
			if ok && !twin[i] && sameMovement(logs[i], t) {
				twin[i] = true
				break
			}
		}
	}
	return twin
}

// nativeSends keeps every token log and turns each Arc system log without a token twin, a native send, into a token
// log of the same movement in 6 decimals.
// ponytail: each native send is floored to 6 decimals, so several sends with sub-micro parts can book up to one unit
// less per send than balanceOf shows; paid still holds (balanceOf covers the booking), expiry then alerts (R-120).
// Keep an 18-decimal total per receiver if that ever happens.
func nativeSends(logs []types.Log) []types.Log {
	twin := twins(logs)
	var out []types.Log
	for i, l := range logs {
		if l.Address == arcEmitter {
			if twin[i] {
				continue
			}
			value := new(big.Int).Quo(new(big.Int).SetBytes(l.Data), arcScale)
			if value.Sign() == 0 {
				continue // under one micro-USDC: balanceOf shows none of it either
			}
			l.Address, l.Data = arcUSDC, common.LeftPadBytes(value.Bytes(), 32)
		}
		out = append(out, l)
	}
	return out
}

func sameMovement(system, token types.Log) bool {
	return bytes.Equal(system.Topics[1][:], token.Topics[1][:]) && bytes.Equal(system.Topics[2][:], token.Topics[2][:]) &&
		new(big.Int).SetBytes(system.Data).Cmp(new(big.Int).Mul(new(big.Int).SetBytes(token.Data), arcScale)) == 0
}

// arcTwins adds to logs, from its transaction's receipt, the token twin of each system log they hold without one and
// table (chain_transfers or wallet_transfers) hasn't recorded. An answer that lacks the token log would otherwise
// record an ERC-20 transfer a second time, as a native send at the system log's index. A recorded one was checked then.
func (c *Chain) arcTwins(ctx context.Context, table string, logs []types.Log) ([]types.Log, error) {
	twin := twins(logs)
	var hashes []string
	var indexes []int64
	for i, l := range logs {
		if l.Address == arcEmitter && !twin[i] {
			hashes, indexes = append(hashes, hexutil.Encode(l.TxHash[:])), append(indexes, int64(l.Index))
		}
	}
	if len(hashes) == 0 {
		return logs, nil
	}
	recorded := map[txLog]bool{}
	rows, err := c.pool.Query(ctx, `SELECT tx_hash, log_index FROM `+table+` WHERE chain_id = $1 AND status <> 'reorged'
		AND (tx_hash, log_index) IN (SELECT * FROM unnest($2::text[], $3::bigint[]))`, c.chainID, hashes, indexes)
	if err != nil {
		return nil, fmt.Errorf("read chain %d recorded native sends: %w", c.chainID, err)
	}
	defer rows.Close()
	for rows.Next() {
		var hash string
		var index uint
		if err := rows.Scan(&hash, &index); err != nil {
			return nil, fmt.Errorf("read chain %d recorded native sends: %w", c.chainID, err)
		}
		recorded[txLog{common.HexToHash(hash), index}] = true
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("read chain %d recorded native sends: %w", c.chainID, err)
	}
	// Only the logs: go-ethereum can't decode every chain's receipts (S-4).
	type receipt struct {
		BlockHash common.Hash `json:"blockHash"`
		Logs      []types.Log `json:"logs"`
	}
	receipts := map[common.Hash]**receipt{}
	var batch []rpc.BatchElem
	for i, l := range logs {
		if l.Address != arcEmitter || twin[i] || recorded[txLog{l.TxHash, l.Index}] || receipts[l.TxHash] != nil {
			continue
		}
		var r *receipt
		receipts[l.TxHash] = &r
		batch = append(batch, rpc.BatchElem{Method: "eth_getTransactionReceipt", Args: []any{l.TxHash}, Result: &r})
	}
	if err := c.batchCall(ctx, batch); err != nil {
		return nil, fmt.Errorf("read chain %d receipts: %w", c.chainID, err)
	}
	for _, b := range batch {
		if b.Error != nil {
			return nil, fmt.Errorf("read chain %d receipt %v: %w", c.chainID, b.Args[0], b.Error)
		}
	}
	out := slices.Clone(logs)
	for i, l := range logs {
		r := receipts[l.TxHash]
		if l.Address != arcEmitter || twin[i] || r == nil {
			continue
		}
		if *r == nil || (*r).BlockHash != l.BlockHash {
			return nil, fmt.Errorf("read chain %d receipt %s: not in block %s", c.chainID, l.TxHash, l.BlockHash)
		}
		for _, t := range (*r).Logs {
			if t.Address == arcUSDC && len(t.Topics) == 3 && t.Topics[0] == transferTopic && len(t.Data) == 32 &&
				t.Index > l.Index && t.Index <= l.Index+2 && sameMovement(l, t) &&
				!slices.ContainsFunc(out, func(o types.Log) bool { return o.TxHash == t.TxHash && o.Index == t.Index }) {
				out = append(out, t)
			}
		}
	}
	return out, nil
}
