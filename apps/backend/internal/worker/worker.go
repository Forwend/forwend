// Package worker runs the worker's rounds: for each enabled chain it scans for deposits (watcher), then books and
// moves the chain's invoices (ledger).
package worker

import (
	"context"
	"log/slog"
	"time"

	"github.com/ensp1re/forwend/apps/backend/internal/chain"
	"github.com/ensp1re/forwend/apps/backend/internal/ledger"
	"github.com/ensp1re/forwend/apps/backend/internal/watcher"
	"github.com/ethereum/go-ethereum/ethclient"
	"github.com/jackc/pgx/v5/pgxpool"
)

// RoundTimeout bounds one chain's scan and ledger run.
const RoundTimeout = 2 * time.Minute

type Worker struct {
	pool     *pgxpool.Pool
	specs    map[uint64]chain.Spec
	keys     []string
	rpcs     map[uint64]chain.RPCs
	balances map[uint64]*ethclient.Client // the second RPC per chain, read by the ledger (D-15)
	ledger   *ledger.Service
}

// New works on the chains in specs, dialing Infura with keys where a chain lists it.
func New(pool *pgxpool.Pool, specs map[uint64]chain.Spec, keys []string) *Worker {
	w := &Worker{pool: pool, specs: specs, keys: keys, rpcs: map[uint64]chain.RPCs{},
		balances: map[uint64]*ethclient.Client{}}
	w.ledger = ledger.NewService(pool, ledger.BalanceFrom(w.balances))
	return w
}

// Round scans each enabled chain, then books and moves its invoices. A chain's RPCs are picked again after any
// error, so a rate-limited or broken provider is skipped next round.
func (w *Worker) Round(ctx context.Context) {
	ids, err := chain.Enabled(ctx, w.pool)
	if err != nil {
		slog.Error("worker round", "err", err)
		return
	}
	for _, id := range ids {
		r, ok := w.rpcs[id]
		if !ok {
			spec, known := w.specs[id]
			if !known {
				slog.Error("enabled chain is not in the chain list", "chain", id)
				continue
			}
			if r, err = chain.Dial(ctx, spec, w.keys); err != nil {
				slog.Error("pick RPCs", "chain", id, "err", chain.Redact(err))
				continue
			}
			w.rpcs[id], w.balances[id] = r, ethclient.NewClient(r.Second)
		}
		// A hanging RPC must not stop the other chains.
		chainCtx, cancel := context.WithTimeout(ctx, RoundTimeout)
		err := watcher.NewChain(w.pool, id, r.Primary).Scan(chainCtx)
		if err == nil {
			err = w.ledger.ProcessChain(chainCtx, id)
		}
		cancel()
		if err != nil {
			slog.Error("worker round", "chain", id, "err", chain.Redact(err))
			w.close(id)
		}
	}
}

func (w *Worker) close(id uint64) {
	if r, ok := w.rpcs[id]; ok {
		r.Close()
		delete(w.rpcs, id)
		delete(w.balances, id)
	}
}

// Close closes every chain's RPC clients.
func (w *Worker) Close() {
	for id := range w.rpcs {
		w.close(id)
	}
}
