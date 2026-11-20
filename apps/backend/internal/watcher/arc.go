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
	"github.com/forwend/forwend/apps/backend/internal/chain"
)

// On Arc, USDC is the native coin; every movement also logs Transfer from ArcEmitter in 18 decimals, and a plain
// native send logs only that (docs.arc.io/arc/references/usdc-system-events). ArcEmitter has no code.
var (
	arcUSDC    = common.HexToAddress("0x3600000000000000000000000000000000000000")
	ArcEmitter = common.HexToAddress("0xfffffffffffffffffffffffffffffffffffffffe")
	arcScale   = big.NewInt(1e12)
)

type txLog struct {
	tx    common.Hash
	index uint
}

// twins marks each Arc system log whose token log is in logs: one index earlier, or two for a CCTP mint or burn.
func twins(logs []types.Log) map[int]bool {
	system := map[txLog]int{}
	var tokens []int
	for i, l := range logs {
		if l.Address == ArcEmitter {
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

// nativeSends turns each Arc system log without a token twin, a native send, into a 6-decimal token log.
// ponytail: floored to 6 decimals per send, so sub-micro parts book up to a unit less; sum per receiver if it matters.
func nativeSends(logs []types.Log) []types.Log {
	twin := twins(logs)
	var out []types.Log
	for i, l := range logs {
		if l.Address == ArcEmitter {
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

// arcTwins adds each system log's missing token twin from the receipt, so an ERC-20 transfer isn't recorded twice.
func (c *Chain) arcTwins(ctx context.Context, table string, logs []types.Log) ([]types.Log, error) {
	twin := twins(logs)
	var hashes []string
	var indexes []int64
	for i, l := range logs {
		if l.Address == ArcEmitter && !twin[i] {
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
	// Only the logs: go-ethereum can't decode every chain's receipts.
	type receipt struct {
		BlockHash common.Hash `json:"blockHash"`
		Logs      []types.Log `json:"logs"`
	}
	receipts := map[common.Hash]**receipt{}
	var batch []rpc.BatchElem
	for i, l := range logs {
		if l.Address != ArcEmitter || twin[i] || recorded[txLog{l.TxHash, l.Index}] || receipts[l.TxHash] != nil {
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
		if l.Address != ArcEmitter || twin[i] || r == nil {
			continue
		}
		if *r == nil || (*r).BlockHash != l.BlockHash {
			return nil, fmt.Errorf("read chain %d receipt %s: not in block %s", c.chainID, l.TxHash, l.BlockHash)
		}
		for _, t := range (*r).Logs {
			if t.Address == arcUSDC && len(t.Topics) == 3 && t.Topics[0] == chain.TransferTopic && len(t.Data) == 32 &&
				t.Index > l.Index && t.Index <= l.Index+2 && sameMovement(l, t) &&
				!slices.ContainsFunc(out, func(o types.Log) bool { return o.TxHash == t.TxHash && o.Index == t.Index }) {
				out = append(out, t)
			}
		}
	}
	return out, nil
}
