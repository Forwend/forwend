package watcher

import (
	"context"
	"errors"
	"fmt"
	"slices"

	"github.com/ethereum/go-ethereum"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/common/hexutil"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/ethereum/go-ethereum/rpc"
	"github.com/forwend/forwend/apps/backend/internal/chain"
)

// The hash is never computed in Go: go-ethereum gets it wrong on Tempo.
type header struct {
	Number    hexutil.Uint64 `json:"number"`
	Hash      common.Hash    `json:"hash"`
	Timestamp hexutil.Uint64 `json:"timestamp"`
}

// go-ethereum nodes refuse more topic or address values with "exceed max topics"; a smaller block range doesn't help.
var topicLimit = 1000

func parts[T any](items []T) [][]T {
	var out [][]T
	for len(items) > topicLimit {
		out, items = append(out, items[:topicLimit]), items[topicLimit:]
	}
	return append(out, items)
}

// narrow halves the log range after a refusal every endpoint gave, never on a rate limit; growAfter doubles it back.
func (c *Chain) narrow(err error) bool {
	switch {
	case err == nil:
		if c.span < MaxRange {
			if c.accepted++; c.accepted >= growAfter {
				c.span, c.accepted = min(2*c.span, MaxRange), 0
			}
		}
	case chain.TooLarge(err) && c.span > 1:
		c.span, c.accepted = c.span/2, 0
		return true
	}
	return false
}

func (c *Chain) filterLogs(ctx context.Context, q ethereum.FilterQuery) ([]types.Log, error) {
	logs, err := c.eth.FilterLogs(ctx, q)
	if err == nil || !chain.TooLarge(err) || q.FromBlock.Cmp(q.ToBlock) != 0 {
		return logs, err
	}
	var receipts []struct {
		Logs []types.Log `json:"logs"`
	}
	if err := c.rpc.CallContext(ctx, &receipts, "eth_getBlockReceipts", hexutil.EncodeBig(q.FromBlock)); err != nil {
		return nil, fmt.Errorf("read block %s receipts: %w", q.FromBlock, err)
	}
	logs = nil
	for _, r := range receipts {
		for _, l := range r.Logs {
			if matches(q, l) {
				logs = append(logs, l)
			}
		}
	}
	return logs, nil
}

func matches(q ethereum.FilterQuery, l types.Log) bool {
	if len(q.Addresses) > 0 && !slices.Contains(q.Addresses, l.Address) {
		return false
	}
	for i, want := range q.Topics {
		if len(want) > 0 && (i >= len(l.Topics) || !slices.Contains(want, l.Topics[i])) {
			return false
		}
	}
	return true
}

// headers leaves out a block the node doesn't have.
func (c *Chain) headers(ctx context.Context, numbers []uint64) (header, map[uint64]header, error) {
	unique := map[uint64]bool{}
	var finalized *header
	batch := []rpc.BatchElem{{Method: "eth_getBlockByNumber", Args: []any{"finalized", false}, Result: &finalized}}
	results := map[uint64]**header{}
	for _, n := range numbers {
		if unique[n] {
			continue
		}
		unique[n] = true
		var h *header
		results[n] = &h
		batch = append(batch, rpc.BatchElem{Method: "eth_getBlockByNumber", Args: []any{hexutil.EncodeUint64(n), false}, Result: &h})
	}
	// RPC providers cap batch sizes; finalized stays in the first chunk with the first blocks.
	if err := c.batchCall(ctx, batch); err != nil {
		return header{}, nil, fmt.Errorf("read chain %d blocks: %w", c.chainID, err)
	}

	for _, b := range batch {
		if b.Error != nil {
			return header{}, nil, fmt.Errorf("read chain %d block %v: %w", c.chainID, b.Args[0], b.Error)
		}
	}
	if finalized == nil {
		return header{}, nil, fmt.Errorf("read chain %d finalized block: not found", c.chainID)
	}
	out := map[uint64]header{}
	for n, h := range results {
		if *h != nil {
			out[n] = **h
		}
	}
	return *finalized, out, nil
}

func (c *Chain) batchCall(ctx context.Context, batch []rpc.BatchElem) error {
	for offset := 0; offset < len(batch); {
		size := min(c.batchSize, len(batch)-offset)
		part := batch[offset : offset+size]
		var err error
		if size == 1 {
			part[0].Error = nil
			err = c.rpc.CallContext(ctx, part[0].Result, part[0].Method, part[0].Args...)
			var responseError rpc.Error
			if errors.As(err, &responseError) {
				part[0].Error, err = err, nil
			}
		} else {
			err = c.rpc.BatchCallContext(ctx, part)
		}
		limited := chain.BatchTooLarge(err)
		for _, call := range part {
			limited = limited || chain.BatchTooLarge(call.Error)
		}
		if limited && size > 1 {
			c.batchSize, c.batchAccepted = max(1, size/2), 0
			continue
		}
		if err != nil {
			return err
		}
		if c.batchSize < MaxBatch && size == c.batchSize {
			if c.batchAccepted++; c.batchAccepted >= growAfter {
				c.batchSize, c.batchAccepted = min(2*c.batchSize, MaxBatch), 0
			}
		}
		offset += size
	}
	return nil
}
