package watcher

import (
	"bytes"
	"math/big"
	"slices"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/types"
)

// On Arc, USDC is the native coin; its ERC-20 interface at arcUSDC shows the same balance in 6 decimals. Every USDC
// movement also logs Transfer from arcEmitter in 18 decimals, and a plain native send logs only that
// (docs.arc.io/arc/references/usdc-system-events). No contract can emit a log from arcEmitter: it has no code.
var (
	arcUSDC    = common.HexToAddress("0x3600000000000000000000000000000000000000")
	arcEmitter = common.HexToAddress("0xfffffffffffffffffffffffffffffffffffffffe")
	arcScale   = big.NewInt(1e12)
)

// nativeSends keeps every token log and turns each Arc system log without a token twin, a native send, into a token
// log of the same movement in 6 decimals. An ERC-20 transfer logs its system twin just before it: one index earlier,
// or two for a CCTP mint or burn. Each token log takes at most one twin, the nearest.
// ponytail: each native send is floored to 6 decimals, so several sends with sub-micro parts can book up to one unit
// less per send than balanceOf shows; paid still holds (balanceOf covers the booking), expiry then alerts (R-120).
// Keep an 18-decimal total per receiver if that ever happens.
func nativeSends(logs []types.Log) []types.Log {
	type txLog struct {
		tx    common.Hash
		index uint
	}
	system := map[txLog]int{}
	var tokens []int
	for i, l := range logs {
		if l.Address == arcEmitter {
			system[txLog{l.TxHash, l.Index}] = i
		} else {
			tokens = append(tokens, i)
		}
	}
	if len(system) == 0 {
		return logs
	}
	slices.SortFunc(tokens, func(a, b int) int { return int(logs[a].Index) - int(logs[b].Index) })
	twin := map[int]bool{}
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
