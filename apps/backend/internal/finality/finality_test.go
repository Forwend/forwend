package finality

import (
	"testing"
	"time"
)

// Deposit at Base Sepolia block 47889653 (2 s blocks), from the S-4 measurements.
var deposit = Block{Number: 47889653, Time: 1791547594}

// behind returns the finalized head the given number of 2 s blocks before the deposit.
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

// Base finality moves in steps as L1 epochs finalize: blocks left falls in jumps, never rises, and reaches 0.
func TestProgressOfStepFinality(t *testing.T) {
	prev := ProgressOf(deposit, behind(600))
	for _, head := range []Block{behind(600), behind(408), behind(216), behind(24), {deposit.Number + 168, deposit.Time + 336}} {
		got := ProgressOf(deposit, head)
		if got.BlocksLeft > prev.BlocksLeft || got.TimeLeft > prev.TimeLeft {
			t.Fatalf("progress went back: %+v after %+v", got, prev)
		}
		prev = got
	}
	if !prev.Final() || prev != (Progress{}) {
		t.Fatalf("got %+v after finality passed the deposit, want final with nothing left", prev)
	}
}

// A busy day: the finalized head falls further behind than usual, so the same deposit shows more time left.
func TestProgressOfBusyDay(t *testing.T) {
	normal := ProgressOf(deposit, behind(461)) // about 15 min, as measured
	busy := ProgressOf(deposit, behind(750))   // about 25 min, the slowest S-4 sample
	if busy.TimeLeft <= normal.TimeLeft || busy.BlocksLeft <= normal.BlocksLeft {
		t.Fatalf("busy %+v should show more left than normal %+v", busy, normal)
	}
	if busy.TimeLeft != 25*time.Minute {
		t.Fatalf("busy time left %v, want 25m", busy.TimeLeft)
	}
}
