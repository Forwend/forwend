package chain

import "context"

// Jobs is owned by one coordinator. A busy chain never blocks another chain's next poll.
type Jobs struct {
	active map[uint64]chainJob
}

type chainJob struct {
	cancel context.CancelFunc
	done   chan struct{}
}

func (j *Jobs) Idle(id uint64) bool {
	job, ok := j.active[id]
	if !ok {
		return true
	}
	select {
	case <-job.done:
		job.cancel()
		delete(j.active, id)
		return true
	default:
		return false
	}
}

func (j *Jobs) Start(ctx context.Context, id uint64, run func(context.Context)) {
	if !j.Idle(id) {
		return
	}
	if j.active == nil {
		j.active = map[uint64]chainJob{}
	}
	ctx, cancel := context.WithCancel(ctx)
	job := chainJob{cancel: cancel, done: make(chan struct{})}
	j.active[id] = job
	go func() {
		defer close(job.done)
		defer cancel()
		run(ctx)
	}()
}

func (j *Jobs) Cancel(id uint64) {
	if job, ok := j.active[id]; ok {
		job.cancel()
	}
}

func (j *Jobs) Wait() {
	for _, job := range j.active {
		<-job.done
	}
}

func (j *Jobs) Close() {
	for id := range j.active {
		j.Cancel(id)
	}
	j.Wait()
}
