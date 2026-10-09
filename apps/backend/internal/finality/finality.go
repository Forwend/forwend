// Package finality tells how far a received deposit is from final, measured against the chain's finalized head
// (D-45). No fixed block count: when finality is slow, the finalized head falls behind and the time left grows.
package finality

import "time"

// Block is a block's number and time (Unix seconds) as the RPC reports them.
type Block struct {
	Number uint64
	Time   uint64
}

// Progress is what is left until a deposit's block is final. Both fields are 0 once it is final.
type Progress struct {
	BlocksLeft uint64
	TimeLeft   time.Duration
}

// Final reports whether the deposit's block is at or below the finalized head.
func (p Progress) Final() bool {
	return p.BlocksLeft == 0
}

// ProgressOf compares the deposit's block with the finalized head. Time left is the chain time the finalized head
// must still cover; it is an estimate, recomputed on every poll.
func ProgressOf(deposit, finalized Block) Progress {
	if finalized.Number >= deposit.Number {
		return Progress{}
	}
	p := Progress{BlocksLeft: deposit.Number - finalized.Number}
	if deposit.Time > finalized.Time {
		p.TimeLeft = time.Duration(deposit.Time-finalized.Time) * time.Second
	}
	return p
}
