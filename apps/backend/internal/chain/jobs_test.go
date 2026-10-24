package chain

import (
	"context"
	"testing"
	"time"
)

func TestHungChainDoesNotDelayOtherPollingRounds(t *testing.T) {
	var jobs Jobs
	defer jobs.Close()
	started := make(chan struct{})
	jobs.Start(context.Background(), 1, func(ctx context.Context) { close(started); <-ctx.Done() })
	<-started
	for range 3 {
		done := make(chan struct{})
		jobs.Start(context.Background(), 1, func(context.Context) { t.Error("busy chain started twice") })
		jobs.Start(context.Background(), 2, func(context.Context) { close(done) })
		select {
		case <-done:
		case <-time.After(time.Second):
			t.Fatal("healthy chain waited for the hung chain")
		}
		<-jobs.active[2].done
	}
	jobs.Cancel(1)
	jobs.Wait()
	if !jobs.Idle(1) {
		t.Fatal("canceled chain is still busy")
	}
}
