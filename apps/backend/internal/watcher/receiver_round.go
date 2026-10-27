package watcher

import (
	"context"
	"fmt"
	"math/big"

	"github.com/ethereum/go-ethereum"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/common/hexutil"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/ethereum/go-ethereum/rpc"
)

// A round shares source reads across receivers; each receiver still commits its own evidence atomically.
type receiverRound struct {
	final, from uint64
	source      receiverSource
}

type receiverSource struct {
	incoming, outgoing, transfers []types.Log
	headers                       map[uint64]header
	calls                         map[string]hexutil.Bytes
	errors                        map[string]error
}

func (c *Chain) receiverRound(ctx context.Context, ids []string) (*receiverRound, error) {
	r := &receiverRound{}
	id, err := c.eth.ChainID(ctx)
	if err != nil {
		return nil, err
	}
	if !id.IsUint64() || id.Uint64() != c.chainID {
		return nil, fmt.Errorf("receiver provider answers another chain")
	}
	first, _, err := c.headers(ctx, nil)
	if err != nil {
		return nil, err
	}
	r.final = uint64(first.Number)
	r.from = r.final
	rows, err := c.pool.Query(ctx, `SELECT i.receive_address,i.token_contract,i.factory_address,s.start_block,s.next_block,s.opening_checked,s.scanned_block
 FROM receiver_scans s JOIN invoices i ON i.id=s.invoice_id WHERE i.id=ANY($1::text[])`, ids)
	if err != nil {
		return nil, err
	}
	type receiverRead struct {
		receive, token, factory string
		start, next             uint64
		checked                 bool
		prior                   *uint64
	}
	var reads []receiverRead
	numbers := []uint64{r.final}
	invoices := map[common.Address]receiver{}
	var addresses []common.Address
	var topics []common.Hash
	tokens := map[common.Address]bool{}
	for rows.Next() {
		var v receiverRead
		if err := rows.Scan(&v.receive, &v.token, &v.factory, &v.start, &v.next, &v.checked, &v.prior); err != nil {
			rows.Close()
			return nil, err
		}
		if v.prior != nil {
			numbers = append(numbers, *v.prior)
		}
		// Deep catch-up stays on the bounded single-receiver path.
		if v.next > r.final || r.final-v.next >= c.span {
			continue
		}
		reads = append(reads, v)
		r.from = min(r.from, v.next)
		addr := common.HexToAddress(v.receive)
		invoices[addr] = receiver{token: v.token}
		addresses = append(addresses, addr)
		topics = append(topics, common.BytesToHash(addr.Bytes()))
		tokens[common.HexToAddress(v.token)] = true
		if v.start > 0 {
			numbers = append(numbers, v.start-1)
		}
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return nil, err
	}
	if len(reads) == 0 {
		if _, r.source.headers, err = c.headers(ctx, numbers); err != nil {
			return nil, err
		}
		return r, nil
	}
	var tokenList []common.Address
	for token := range tokens {
		tokenList = append(tokenList, token)
	}
	source := &r.source
	source.incoming, err = c.logsIn(ctx, r.from, r.final, invoices)
	if err != nil {
		return nil, err
	}
	for lo := r.from; lo <= r.final; {
		hi := min(r.final, lo+c.span-1)
		outgoing, e := c.filterLogs(ctx, ethereum.FilterQuery{FromBlock: new(big.Int).SetUint64(lo), ToBlock: new(big.Int).SetUint64(hi), Addresses: addresses, Topics: [][]common.Hash{{settledTopic, refundedTopic, recoveredTopic}}})
		if next, ok := narrower(e, c.span); ok {
			c.span = next
			continue
		}
		if e != nil {
			return nil, e
		}
		transfers, e := c.filterLogs(ctx, ethereum.FilterQuery{FromBlock: new(big.Int).SetUint64(lo), ToBlock: new(big.Int).SetUint64(hi), Addresses: tokenList, Topics: [][]common.Hash{{transferTopic}, topics}})
		if next, ok := narrower(e, c.span); ok {
			c.span = next
			continue
		}
		if e != nil {
			return nil, e
		}
		source.outgoing = append(source.outgoing, outgoing...)
		source.transfers = append(source.transfers, transfers...)
		lo = hi + 1
	}
	for _, logs := range [][]types.Log{source.incoming, source.outgoing, source.transfers} {
		for _, l := range logs {
			numbers = append(numbers, l.BlockNumber)
		}
	}
	_, source.headers, err = c.headers(ctx, numbers)
	if err != nil {
		return nil, err
	}
	source.calls = map[string]hexutil.Bytes{}
	source.errors = map[string]error{}
	var batch []rpc.BatchElem
	var results []*hexutil.Bytes
	var keys []string
	add := func(to string, data []byte, block uint64) {
		key := receiverCallKey(to, data, block)
		value := new(hexutil.Bytes)
		batch = append(batch, rpc.BatchElem{Method: "eth_call", Args: []any{map[string]any{"to": to, "data": hexutil.Encode(data)}, hexutil.EncodeUint64(block)}, Result: value})
		results = append(results, value)
		keys = append(keys, key)
	}
	for _, v := range reads {
		balance := append(crypto.Keccak256([]byte("balanceOf(address)"))[:4], common.LeftPadBytes(common.HexToAddress(v.receive).Bytes(), 32)...)
		if !v.checked && v.start > 0 {
			add(v.token, balance, v.start-1)
		}
		add(v.token, balance, r.final)
		deploy := append(crypto.Keccak256([]byte("deployedAt(address)"))[:4], common.LeftPadBytes(common.HexToAddress(v.receive).Bytes(), 32)...)
		add(v.factory, deploy, r.final)
	}
	if err := c.batchCall(ctx, batch); err != nil {
		return nil, err
	}

	for i, call := range batch {
		if call.Error != nil {
			source.errors[keys[i]] = call.Error
			continue
		}
		// Empty responses still need the single-receiver code-existence checks.
		if len(*results[i]) == 32 {
			source.calls[keys[i]] = *results[i]
		}
	}
	return r, nil
}

func receiverCallKey(to string, data []byte, block uint64) string {
	return to + hexutil.Encode(data) + hexutil.EncodeUint64(block)
}

func (r *receiverRound) logs(source *receiverSource, from, hi uint64, receive, token string) (incoming, outgoing, transfers []types.Log) {
	addr := common.HexToAddress(receive)
	asset := common.HexToAddress(token)
	for _, l := range source.incoming {
		if l.BlockNumber >= from && l.BlockNumber <= hi && l.Address == asset && common.BytesToAddress(l.Topics[2].Bytes()) == addr {
			incoming = append(incoming, l)
		}
	}
	for _, l := range source.outgoing {
		if l.BlockNumber >= from && l.BlockNumber <= hi && l.Address == addr {
			outgoing = append(outgoing, l)
		}
	}
	for _, l := range source.transfers {
		if l.BlockNumber >= from && l.BlockNumber <= hi && l.Address == asset && len(l.Topics) > 1 && common.BytesToAddress(l.Topics[1].Bytes()) == addr {
			transfers = append(transfers, l)
		}
	}
	return
}

func (r *receiverRound) balance(ctx context.Context, c *Chain, source *receiverSource, token, receive string, block uint64) (*big.Int, error) {
	data := append(crypto.Keccak256([]byte("balanceOf(address)"))[:4], common.LeftPadBytes(common.HexToAddress(receive).Bytes(), 32)...)
	if err := source.errors[receiverCallKey(token, data, block)]; err != nil {
		return nil, err
	}
	if value, ok := source.calls[receiverCallKey(token, data, block)]; ok {
		return new(big.Int).SetBytes(value), nil
	}
	return c.receiverBalance(ctx, token, receive, block)
}

func (r *receiverRound) deployed(ctx context.Context, c *Chain, source *receiverSource, factory, receive string, block uint64) (uint64, error) {
	data := append(crypto.Keccak256([]byte("deployedAt(address)"))[:4], common.LeftPadBytes(common.HexToAddress(receive).Bytes(), 32)...)
	if err := source.errors[receiverCallKey(factory, data, block)]; err != nil {
		return 0, err
	}
	if value, ok := source.calls[receiverCallKey(factory, data, block)]; ok {
		at := new(big.Int).SetBytes(value)
		if !at.IsUint64() {
			return 0, fmt.Errorf("invalid deployment time")
		}
		return at.Uint64(), nil
	}
	return c.receiverDeployedAt(ctx, factory, receive, block)
}
