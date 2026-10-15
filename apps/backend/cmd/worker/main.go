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
	"github.com/ensp1re/forwend/apps/backend/internal/email"
	"github.com/ensp1re/forwend/apps/backend/internal/notify"
	"github.com/ensp1re/forwend/apps/backend/internal/worker"
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
	// Startup checks: each stops the worker with a message naming what is wrong.
	pool, err := database.Open(ctx, cfg.DatabaseURL)
	if err != nil {
		return err
	}
	defer pool.Close()
	lock, err := database.TakeLock(ctx, pool, worker.LockKey, "worker", cfg.Chains.PollInterval)
	if err != nil {
		if ctx.Err() != nil {
			return nil // stopped while waiting
		}
		return err
	}
	defer lock.Close()
	if err := database.CheckSchema(ctx, pool); err != nil {
		return err
	}
	if err := chain.CheckEnabled(ctx, pool, specs, cfg.Chains.InfuraKeys, cfg.Chains.RPCRate, nil); err != nil {
		return err
	}

	w := worker.New(pool, specs, cfg.Chains.InfuraKeys, cfg.Chains.RPCRate)
	defer w.Close()
	// Owner email (R-80): without a key nothing is sent, and the events wait in the outbox.
	var sender email.Sender
	if cfg.Email.ResendKey != "" {
		r := email.NewResend(cfg.Email.ResendKey, cfg.Email.From)
		if cfg.Email.ResendURL != "" {
			r.URL = cfg.Email.ResendURL // the gate's fake Resend
		}
		sender = r
	}
	slog.Info("worker ready", "every", cfg.Chains.PollInterval, "email", sender != nil)
	for {
		if err := lock.Held(ctx); err != nil {
			return err
		}
		w.Round(ctx)
		if sender != nil {
			if err := notify.Deliver(ctx, pool, sender, notify.Site{WebURL: cfg.Email.PublicWebURL, PostalAddress: cfg.Email.PostalAddress}); err != nil {
				slog.Error("deliver email", "err", err)
			}
		}
		select {
		case <-ctx.Done():
			return nil
		case <-time.After(cfg.Chains.PollInterval):
		}
	}
}
