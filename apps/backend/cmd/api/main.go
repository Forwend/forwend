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
	"github.com/forwend/forwend/apps/backend/internal/httpapi"
	"github.com/forwend/forwend/apps/backend/internal/privy"
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
		return address.FactoryDeployed(ctx, id, ethclient.NewClient(r.Primary), ethclient.NewClient(r.Second))
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
	server := &http.Server{
		Addr: cfg.Addr,
		Handler: httpapi.NewMux(pool, verifier, privy.NewClient(cfg.PrivyAppID, cfg.PrivyAppSecret, ""),
			balances.Read, cfg.PublicWebURL, cfg.UserBurst, cfg.WebhookKey),
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
