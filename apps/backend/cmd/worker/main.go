// Command worker watches the chains, keeps the ledger and runs the invoice state machine.
package main

import (
	"context"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"sync"
	"syscall"
	"time"

	"github.com/forwend/forwend/apps/backend/internal/chain"
	"github.com/forwend/forwend/apps/backend/internal/config"
	"github.com/forwend/forwend/apps/backend/internal/database"
	"github.com/forwend/forwend/apps/backend/internal/ecb"
	"github.com/forwend/forwend/apps/backend/internal/email"
	"github.com/forwend/forwend/apps/backend/internal/invoice"
	"github.com/forwend/forwend/apps/backend/internal/notify"
	"github.com/forwend/forwend/apps/backend/internal/price"
	"github.com/forwend/forwend/apps/backend/internal/worker"
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
	pool, err := database.Open(ctx, cfg.DatabaseURL)
	if err != nil {
		return err
	}
	defer pool.Close()
	lock, err := database.TakeLock(ctx, pool, worker.LockKey, "worker", cfg.Chains.PollInterval)
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
	specs, err := chain.Specs(ctx, pool, cfg.Chains.RPCSecrets, cfg.Chains.AllowLoopback)
	if err != nil {
		return err
	}
	budget, err := chain.NewBudget(ctx, pool, cfg.Chains.RPCRate)
	if err != nil {
		return err
	}
	defer budget.Close()

	if err := chain.CheckEnabled(ctx, pool, specs, cfg.Chains.RPCRate, nil, budget); err != nil {
		return err
	}

	w := worker.New(pool, specs, cfg.Chains.RPCRate, budget)
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
	invoices := invoice.NewService(pool)
	rates := &ecb.Keeper{Pool: pool, Client: &http.Client{Timeout: 30 * time.Second}, URL: cfg.RatesURL}
	prices := &price.Keeper{Pool: pool, URL: cfg.Prices.URL, Key: cfg.Prices.Key, Every: cfg.Prices.Every,
		// The key's header would follow a redirect to any host.
		Client: &http.Client{Timeout: 10 * time.Second,
			CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}}
	slog.Info("worker ready", "every", cfg.Chains.PollInterval, "email", sender != nil)
	// Housekeeping calls Resend, the ECB and CoinGecko: on its own loop, a slow answer never delays a chain round. It
	// stops with the chain loop, before the pool closes.
	ctx, stopHousekeeping := context.WithCancel(ctx)
	var housekeeping sync.WaitGroup
	defer housekeeping.Wait()
	defer stopHousekeeping()
	housekeeping.Go(func() {
		for {
			keepHouse(ctx, cfg, invoices, rates, prices, sender, pool)
			select {
			case <-ctx.Done():
				return
			case <-time.After(cfg.Chains.PollInterval):
			}
		}
	})
	for {
		if err := lock.Held(ctx); err != nil {
			return err
		}
		w.Tick(ctx)
		select {
		case <-ctx.Done():
			return nil
		case <-time.After(cfg.Chains.PollInterval):
		}
	}
}

func keepHouse(ctx context.Context, cfg config.Worker, invoices *invoice.Service, rates *ecb.Keeper, prices *price.Keeper,
	sender email.Sender, pool *pgxpool.Pool) {
	// Payment reminders (R-96) wait in the outbox like the other emails when there is no key.
	if err := invoices.QueueReminders(ctx); err != nil {
		slog.Error("queue reminders", "err", err)
	}
	if err := invoices.MakeRetainerInvoices(ctx); err != nil {
		slog.Error("make retainer invoices", "err", err)
	}
	// Records in another currency (R-110) wait for the rates when the ECB can't be read.
	if err := rates.Tick(ctx, time.Now()); err != nil {
		slog.Warn("keep ECB rates", "err", err)
	}
	// Prices are for display only (R-178): when CoinGecko can't be read, the app shows the last ones as stale.
	if err := prices.Tick(ctx, time.Now()); err != nil {
		slog.Warn("keep CoinGecko prices", "err", err)
	}
	if sender != nil {
		if err := notify.Deliver(ctx, pool, sender, notify.Site{WebURL: cfg.Email.PublicWebURL, PostalAddress: cfg.Email.PostalAddress,
			Support: cfg.Email.Support}); err != nil {
			slog.Error("deliver email", "err", err)
		}
	}
}
