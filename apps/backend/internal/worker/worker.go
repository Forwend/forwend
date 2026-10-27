// Package worker runs the worker's rounds: for each enabled chain it scans for deposits (watcher), then books and
// moves the chain's invoices (ledger).
package worker

import (
	"context"
	"log/slog"
	"time"

	"github.com/ethereum/go-ethereum/ethclient"
	"github.com/forwend/forwend/apps/backend/internal/chain"
	"github.com/forwend/forwend/apps/backend/internal/ledger"
	"github.com/forwend/forwend/apps/backend/internal/watcher"
	"github.com/jackc/pgx/v5/pgxpool"
)

const RescanTimeout = 30 * time.Second

const RoundTimeout = 2 * time.Minute

// LockKey is the worker's Postgres advisory lock: one worker runs at a time, since two would race on the chain
// cursors.
const LockKey int64 = 0x666f7277656e6401 // "forwend" 1

type Worker struct {
	pool     *pgxpool.Pool
	specs    map[uint64]chain.Spec
	keys     []string
	rate     float64
	rpcs     map[uint64]chain.RPCs
	watchers map[uint64]*watcher.Chain
	balances map[uint64]*ethclient.Client // the second RPC per chain, read by the ledger (D-15)
	jobs     chain.Jobs
	budgets  []*chain.Budget
}

// New sends each RPC at most rate calls per second.
func New(pool *pgxpool.Pool, specs map[uint64]chain.Spec, keys []string, rate float64, budgets ...*chain.Budget) *Worker {
	w := &Worker{budgets: budgets, pool: pool, specs: specs, keys: keys, rate: rate, rpcs: map[uint64]chain.RPCs{},
		watchers: map[uint64]*watcher.Chain{}, balances: map[uint64]*ethclient.Client{}}
	return w
}

// Round: a failing or rate-limited RPC is rested and its calls move to the chain's next one (chain.NewRPCs).
func (w *Worker) Round(ctx context.Context) {
	w.Tick(ctx)
	w.jobs.Wait()
}

// Tick starts only idle chains; a slow chain keeps its own deadline without delaying the next poll.
func (w *Worker) Tick(ctx context.Context) {
	ids, err := chain.Enabled(ctx, w.pool)
	if err != nil {
		slog.Error("worker round", "err", err)
		return
	}
	enabled := map[uint64]bool{}
	for _, id := range ids {
		enabled[id] = true
	}
	for id, r := range w.rpcs {
		if !enabled[id] {
			w.jobs.Cancel(id)
			if w.jobs.Idle(id) {
				r.Close()
				delete(w.rpcs, id)
				delete(w.watchers, id)
				delete(w.balances, id)
			}
		}
	}
	for _, id := range ids {
		if !w.jobs.Idle(id) {
			continue
		}
		watch, ok := w.watchers[id]
		if !ok {
			spec, known := w.specs[id]
			if !known {
				slog.Error("enabled chain is not in the chain list", "chain", id)
				continue
			}
			r, err := chain.NewRPCs(spec, w.keys, w.rate, w.budgets...)
			if err != nil {
				slog.Error("pick RPCs", "chain", id, "err", chain.Redact(err))
				continue
			}
			watch = watcher.NewChain(w.pool, id, r.Primary)
			w.rpcs[id], w.watchers[id], w.balances[id] = r, watch, ethclient.NewClient(r.Second)
		}
		client := w.balances[id]
		w.jobs.Start(ctx, id, func(ctx context.Context) {
			book := ledger.NewService(w.pool, ledger.BalanceSnapshot(client),
				ledger.DeployedFrom(map[uint64]*ethclient.Client{id: client}))
			// A hanging RPC must not stop the other chains.
			chainCtx, cancel := context.WithTimeout(ctx, RoundTimeout)
			err := watch.ScanNew(chainCtx)
			if err == nil {
				// Check status asked to look again (R-55): what a rescan finds is booked below in the same round. Its own
				// shorter deadline leaves the ledger its time even when rescans hit a slow RPC.
				rescanCtx, cancelRescan := context.WithTimeout(chainCtx, RescanTimeout)
				if recoveryErr := watch.Recover(rescanCtx); recoveryErr != nil {
					slog.Error("worker recovery", "chain", id, "err", chain.Redact(recoveryErr))
				}
				if rescanErr := watch.Rescans(rescanCtx); rescanErr != nil {
					slog.Error("worker rescans", "chain", id, "err", chain.Redact(rescanErr))
				}
				if receiverErr := watch.Receivers(rescanCtx, w.rpcs[id].Second); receiverErr != nil {
					slog.Error("worker receiver evidence", "chain", id, "err", chain.Redact(receiverErr))
				}
				cancelRescan()
				err = book.ProcessChain(chainCtx, id)
			}
			cancel()
			if err != nil {
				slog.Error("worker round", "chain", id, "err", chain.Redact(err))
			}
		})
	}
}

func (w *Worker) Close() {
	w.jobs.Close()
	for _, r := range w.rpcs {
		r.Close()
	}
}
