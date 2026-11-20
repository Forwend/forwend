// Command worker watches the chains, keeps the ledger and runs the invoice state machine.
package main

import (
	"context"
	"log/slog"
	"maps"
	"net/http"
	"os"
	"os/signal"
	"slices"
	"sync"
	"syscall"
	"time"

	"github.com/forwend/forwend/apps/backend/internal/balance"
	"github.com/forwend/forwend/apps/backend/internal/chain"
	"github.com/forwend/forwend/apps/backend/internal/config"
	"github.com/forwend/forwend/apps/backend/internal/database"
	"github.com/forwend/forwend/apps/backend/internal/ecb"
	"github.com/forwend/forwend/apps/backend/internal/email"
	"github.com/forwend/forwend/apps/backend/internal/intents"
	"github.com/forwend/forwend/apps/backend/internal/invoice"
	"github.com/forwend/forwend/apps/backend/internal/notify"
	"github.com/forwend/forwend/apps/backend/internal/price"
	"github.com/forwend/forwend/apps/backend/internal/settlement"
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
	budget, err := chain.NewBudget(ctx, pool, cfg.Chains.RPCRate, chain.MoneyShare)
	if err != nil {
		return err
	}
	defer budget.Close()

	if err := chain.CheckEnabled(ctx, pool, specs, cfg.Chains.RPCRate, nil, budget); err != nil {
		return err
	}

	w := worker.New(pool, specs, cfg.Chains.RPCRate, budget)
	defer w.Close()
	// Without a Resend key nothing is sent, and the events wait in the outbox.
	sender, site := notify.FromConfig(cfg.Email)
	invoices := invoice.NewService(pool)
	quotes := balance.NewChainReader(specs, cfg.Chains.RPCRate, budget)
	defer quotes.Close()
	fees := settlement.NewQuotes(quotes.Client)
	go fees.Keep(ctx, slices.Sorted(maps.Keys(specs)))
	invoices.SetPricing(invoice.Pricing{Quotes: fees, Plan: invoice.FeePlan(cfg.Fees)})
	rates := &ecb.Keeper{Pool: pool, Client: &http.Client{Timeout: 30 * time.Second}, URL: cfg.RatesURL}
	prices := &price.Keeper{Pool: pool, URL: cfg.Prices.URL, Key: cfg.Prices.Key, Every: cfg.Prices.Every,
		// The key's header would follow a redirect to any host.
		Client: &http.Client{Timeout: 10 * time.Second,
			CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}}
	oneClick := intents.NewClient(cfg.OneClick.URL, cfg.OneClick.Key, cfg.Chains.AllowLoopback)
	tokens := &intents.Keeper{Pool: pool, Client: oneClick, Every: intents.TokensEvery}
	invoices.SetCrossChain(oneClick)
	slog.Info("worker ready", "every", cfg.Chains.PollInterval, "email", sender != nil)
	// Housekeeping runs on its own loops, so a slow outside service never delays a chain round.
	ctx, stopHousekeeping := context.WithCancel(ctx)
	var housekeeping sync.WaitGroup
	defer housekeeping.Wait()
	defer stopHousekeeping()
	housekeeping.Go(func() {
		repeat(ctx, cfg.Chains.PollInterval, func() { keepHouse(ctx, invoices, rates, prices, tokens, sender, site, pool) })
	})
	housekeeping.Go(func() {
		repeat(ctx, intents.ProbeGap, func() {
			if err := tokens.Probe(ctx, time.Now()); err != nil {
				slog.Warn("check 1Click minimums", "err", err)
			}
		})
	})
	housekeeping.Go(func() {
		repeat(ctx, cfg.Chains.PollInterval, func() {
			if err := invoices.TrackCrossChain(ctx, time.Now()); err != nil {
				slog.Error("track cross-chain quotes", "err", err)
			}
		})
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

func repeat(ctx context.Context, d time.Duration, fn func()) {
	for {
		fn()
		select {
		case <-ctx.Done():
			return
		case <-time.After(d):
		}
	}
}

func keepHouse(ctx context.Context, invoices *invoice.Service, rates *ecb.Keeper, prices *price.Keeper,
	tokens *intents.Keeper, sender email.Sender, site notify.Site, pool *pgxpool.Pool) {
	if err := invoices.QueueReminders(ctx); err != nil {
		slog.Error("queue reminders", "err", err)
	}
	if err := invoices.MakeRetainerInvoices(ctx); err != nil {
		slog.Error("make retainer invoices", "err", err)
	}
	if err := rates.Tick(ctx, time.Now()); err != nil {
		slog.Warn("keep ECB rates", "err", err)
	}
	if err := prices.Tick(ctx, time.Now()); err != nil {
		slog.Warn("keep CoinGecko prices", "err", err)
	}
	if err := tokens.Tick(ctx, time.Now()); err != nil {
		slog.Warn("keep 1Click tokens", "err", err)
	}
	if sender != nil {
		if err := notify.Deliver(ctx, pool, sender, site); err != nil {
			slog.Error("deliver email", "err", err)
		}
	}
}
