// Command worker watches the chains, keeps the ledger and runs the invoice state machine.
package main

import (
	"context"
	"log/slog"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/ensp1re/forwend/apps/backend/internal/chain"
	"github.com/ensp1re/forwend/apps/backend/internal/config"
	"github.com/ensp1re/forwend/apps/backend/internal/database"
	"github.com/ensp1re/forwend/apps/backend/internal/ledger"
	"github.com/ensp1re/forwend/apps/backend/internal/watcher"
	"github.com/ethereum/go-ethereum/ethclient"
	"github.com/jackc/pgx/v5/pgxpool"
)

func main() {
	if err := run(); err != nil {
		slog.Error("worker stopped", "err", err)
		os.Exit(1)
	}
}

func run() error {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	cfg, err := config.LoadWorker()
	if err != nil {
		return err
	}
	specs, err := chain.Specs(cfg.Chains.File)
	if err != nil {
		return err
	}
	pool, err := database.Open(ctx, cfg.DatabaseURL)
	if err != nil {
		return err
	}
	defer pool.Close()

	w := worker{pool: pool, specs: specs, keys: cfg.Chains.InfuraKeys, rpcs: map[uint64]chain.RPCs{},
		balances: map[uint64]*ethclient.Client{}}
	w.ledger = ledger.NewService(pool, ledger.BalanceFrom(w.balances))
	defer w.closeAll()
	slog.Info("worker ready", "every", cfg.Chains.PollInterval)
	for {
		w.round(ctx)
		select {
		case <-ctx.Done():
			return nil
		case <-time.After(cfg.Chains.PollInterval):
		}
	}
}

type worker struct {
	pool     *pgxpool.Pool
	specs    map[uint64]chain.Spec
	keys     []string
	rpcs     map[uint64]chain.RPCs
	balances map[uint64]*ethclient.Client // the second RPC per chain, read by the ledger (D-15)
	ledger   *ledger.Service
}

// round scans each enabled chain, then books and moves its invoices. A chain's RPCs are picked again after any
// error, so a rate-limited or broken provider is skipped next round.
func (w *worker) round(ctx context.Context) {
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
				slog.Error("pick RPCs", "chain", id, "err", err)
				continue
			}
			w.rpcs[id], w.balances[id] = r, ethclient.NewClient(r.Second)
		}
		err := watcher.NewChain(w.pool, id, r.Primary).Scan(ctx)
		if err == nil {
			err = w.ledger.ProcessChain(ctx, id)
		}
		if err != nil {
			slog.Error("worker round", "chain", id, "err", err)
			w.close(id)
		}
	}
}

func (w *worker) close(id uint64) {
	if r, ok := w.rpcs[id]; ok {
		r.Close()
		delete(w.rpcs, id)
		delete(w.balances, id)
	}
}

func (w *worker) closeAll() {
	for id := range w.rpcs {
		w.close(id)
	}
}
