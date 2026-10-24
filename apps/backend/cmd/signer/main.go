// Command signer signs typed settlement intents with the executor key. It has no public routes.
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
	"github.com/ensp1re/forwend/apps/backend/internal/settlement"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/ethereum/go-ethereum/ethclient"
)

func main() {
	if err := run(); err != nil {
		slog.Error("signer stopped", "err", err)
		os.Exit(1)
	}
}

func run() error {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	cfg, err := config.LoadSigner()
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
	lock, err := database.TakeLock(ctx, pool, settlement.LockKey, "signer", cfg.Chains.PollInterval)
	if err != nil {
		if ctx.Err() != nil {
			return nil
		}
		return err
	}
	defer lock.Close()
	if err := database.CheckSchema(ctx, pool); err != nil {
		return err
	}
	executor := crypto.PubkeyToAddress(cfg.ExecutorKey.PublicKey)
	budget, err := chain.NewBudget(ctx, pool, cfg.Chains.RPCRate)
	if err != nil {
		return err
	}
	defer budget.Close()

	err = chain.CheckEnabled(ctx, pool, specs, cfg.Chains.InfuraKeys, cfg.Chains.RPCRate,
		func(ctx context.Context, id uint64, r chain.RPCs) error {
			return settlement.CheckGas(ctx, id, executor, ethclient.NewClient(r.Primary), ethclient.NewClient(r.Second))
		}, budget)
	if err != nil {
		return err
	}

	rounds := settlement.NewRounds(pool, cfg.ExecutorKey, specs, cfg.Chains.InfuraKeys, cfg.Chains.RPCRate, lock.Held, budget)
	defer rounds.Close()
	slog.Info("signer ready", "executor", executor.Hex(), "every", cfg.Chains.PollInterval)
	for {
		if err := lock.Held(ctx); err != nil {
			return err
		}
		rounds.Tick(ctx)
		if !wait(ctx, cfg.Chains.PollInterval) {
			return nil
		}
	}
}

func wait(ctx context.Context, d time.Duration) bool {
	select {
	case <-ctx.Done():
		return false
	case <-time.After(d):
		return true
	}
}
