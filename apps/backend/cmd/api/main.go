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

	"github.com/ensp1re/forwend/apps/backend/internal/auth"
	"github.com/ensp1re/forwend/apps/backend/internal/config"
	"github.com/ensp1re/forwend/apps/backend/internal/database"
	"github.com/ensp1re/forwend/apps/backend/internal/httpapi"
	"github.com/ensp1re/forwend/apps/backend/internal/privy"
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
	if err := database.Migrate(ctx, cfg.DatabaseURL); err != nil {
		return err
	}
	pool, err := database.Open(ctx, cfg.DatabaseURL)
	if err != nil {
		return err
	}
	defer pool.Close()

	verifier, err := auth.NewVerifier(ctx, cfg.PrivyAppID, cfg.PrivyJWKSURL, &http.Client{Timeout: 10 * time.Second})
	if err != nil {
		return err
	}
	server := &http.Server{
		Addr:              cfg.Addr,
		Handler:           httpapi.NewMux(pool, verifier, privy.NewClient(cfg.PrivyAppID, cfg.PrivyAppSecret, "")),
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
