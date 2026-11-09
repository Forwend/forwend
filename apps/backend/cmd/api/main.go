// Command api serves the public and dashboard HTTP API. It holds no private keys.
package main

import (
	"context"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/ethereum/go-ethereum/ethclient"
	"github.com/forwend/forwend/apps/backend/internal/address"
	"github.com/forwend/forwend/apps/backend/internal/auth"
	"github.com/forwend/forwend/apps/backend/internal/balance"
	"github.com/forwend/forwend/apps/backend/internal/chain"
	"github.com/forwend/forwend/apps/backend/internal/config"
	"github.com/forwend/forwend/apps/backend/internal/database"
	"github.com/forwend/forwend/apps/backend/internal/email"
	"github.com/forwend/forwend/apps/backend/internal/httpapi"
	"github.com/forwend/forwend/apps/backend/internal/invoice"
	"github.com/forwend/forwend/apps/backend/internal/notify"
	"github.com/forwend/forwend/apps/backend/internal/privy"
	"github.com/forwend/forwend/apps/backend/internal/reauth"
	"github.com/forwend/forwend/apps/backend/internal/settlement"
)

func main() {
	if err := run(); err != nil {
		slog.Error("api stopped", "err", err)
		os.Exit(1)
	}
}

func run() error {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	cfg, err := config.LoadAPI()
	if err != nil {
		return err
	}
	pool, err := database.Open(ctx, cfg.DatabaseURL)
	if err != nil {
		return err
	}
	defer pool.Close()
	if err := database.Migrate(ctx, cfg.DatabaseURL); err != nil {
		return err
	}
	if cfg.EnableTestnetUSDC {
		if err := chain.EnableTestnetTokens(ctx, pool); err != nil {
			return err
		}
	}
	if len(cfg.EnableMainnets) > 0 {
		if err := chain.EnableMainnets(ctx, pool, cfg.EnableMainnets); err != nil {
			return err
		}
	}
	specs, err := chain.Specs(ctx, pool, cfg.RPCSecrets, cfg.RPCAllowLoopback)
	if err != nil {
		return err
	}
	budget, err := chain.NewBudget(ctx, pool, cfg.RPCRate)
	if err != nil {
		return err
	}
	defer budget.Close()

	err = chain.CheckEnabled(ctx, pool, specs, cfg.RPCRate, func(ctx context.Context, id uint64, r chain.RPCs) error {
		return address.FactoryDeployed(ctx, id, ethclient.NewClient(r.Client))
	}, budget)
	if err != nil {
		return err
	}
	balances := balance.NewChainReader(specs, cfg.RPCRate, budget)
	defer balances.Close()

	verifier, err := auth.NewVerifier(ctx, cfg.PrivyAppID, cfg.PrivyJWKSURL, &http.Client{Timeout: 10 * time.Second})
	if err != nil {
		return err
	}
	users := privy.NewClient(cfg.PrivyAppID, cfg.PrivyAppSecret, "")
	// Confirm it's you codes (R-137) go out from the api at once; without a key none can be sent.
	var sender email.Sender
	if cfg.Email.ResendKey != "" {
		r := email.NewResend(cfg.Email.ResendKey, cfg.Email.From)
		if cfg.Email.ResendURL != "" {
			r.URL = cfg.Email.ResendURL // a test's fake Resend
		}
		sender = r
	}
	site := notify.Site{WebURL: cfg.Email.PublicWebURL, PostalAddress: cfg.Email.PostalAddress, Support: cfg.Email.Support}
	codes := reauth.NewService(pool, sender, func(code string) (email.Message, error) {
		return notify.CodeMessage(site, code, reauth.CodeTTL)
	}, cfg.CodesPerHour)
	server := &http.Server{
		Addr: cfg.Addr,
		Handler: httpapi.NewMux(pool, verifier, users, balances.Read, balances.Client, codes, cfg.PublicWebURL,
			cfg.UserBurst, cfg.WebhookKey, cfg.TrustProxyHeader, invoice.Pricing{Quotes: settlement.NewQuotes(balances.Client),
				Plan: invoice.FeePlan{RateBps: cfg.Fees.RateBps, MinUSD: cfg.Fees.MinUSD, CapUSD: cfg.Fees.CapUSD}}),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       60 * time.Second,
	}
	listener, err := net.Listen("tcp", cfg.Addr)
	if err != nil {
		return fmt.Errorf("listen for HTTP: %w", err)
	}
	slog.Info("api listening", "addr", listener.Addr().String())
	return httpapi.Serve(ctx, server, listener, 10*time.Second)
}
