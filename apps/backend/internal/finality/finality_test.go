package finality

import (
	"testing"
	"time"
)

// Deposit at Base Sepolia block 47889653 (2 s blocks), from the S-4 measurements.
var deposit = Block{Number: 47889653, Time: 1791547594}

func behind(blocks uint64) Block {
	return Block{Number: deposit.Number - blocks, Time: deposit.Time - 2*blocks}
}

func TestProgressOf(t *testing.T) {
	tests := []struct {
		name      string
		finalized Block
		want      Progress
	}{
		{"finalized 461 blocks behind", behind(461), Progress{BlocksLeft: 461, TimeLeft: 922 * time.Second}},
		{"one block left", behind(1), Progress{BlocksLeft: 1, TimeLeft: 2 * time.Second}},
		{"finalized passes the deposit block", Block{Number: deposit.Number + 50, Time: deposit.Time + 100}, Progress{}},
		// Arbitrum makes several blocks per second, so a block left can still share the head's second.
		{"same second, block not final", Block{Number: deposit.Number - 3, Time: deposit.Time}, Progress{BlocksLeft: 3}},
		// Arc and Tempo: the finalized head is the latest block, so a deposit is final when it is seen.
		{"finalized equals latest", deposit, Progress{}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := ProgressOf(deposit, tt.finalized)
			if got != tt.want {
				t.Fatalf("got %+v, want %+v", got, tt.want)
			}
			if got.Final() != (tt.finalized.Number >= deposit.Number) {
				t.Fatalf("Final() = %v with finalized #%d, deposit #%d", got.Final(), tt.finalized.Number, deposit.Number)
			}
		})
	}
}
