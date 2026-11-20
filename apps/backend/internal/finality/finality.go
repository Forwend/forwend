// Package finality tells how far a deposit is from final against the chain's finalized head, not a block count.
package finality

import "time"

type Block struct {
	Number uint64
	Time   uint64 // Unix seconds
}

// Progress is what is left until a deposit's block is final. Both fields are 0 once it is final.
type Progress struct {
	BlocksLeft uint64
	TimeLeft   time.Duration
}

func (p Progress) Final() bool {
	return p.BlocksLeft == 0
}

// ProgressOf: time left is the chain time the finalized head must still cover, an estimate recomputed each poll.
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
