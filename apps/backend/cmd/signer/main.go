// Command signer signs typed settlement intents with the executor key. It has no public routes.
package main

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/ensp1re/forwend/apps/backend/internal/chain"
	"github.com/ensp1re/forwend/apps/backend/internal/config"
	"github.com/ensp1re/forwend/apps/backend/internal/database"
	"github.com/ensp1re/forwend/apps/backend/internal/settlement"
	"github.com/ethereum/go-ethereum/crypto"
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
	key, err := crypto.HexToECDSA(strings.TrimPrefix(cfg.ExecutorKey, "0x"))
	if err != nil {
		return fmt.Errorf("EXECUTOR_PRIVATE_KEY is not a hex secp256k1 key") // never echo the value
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

	rounds := settlement.NewRounds(pool, key, specs, cfg.Chains.InfuraKeys)
	defer rounds.Close()
	slog.Info("signer ready", "executor", crypto.PubkeyToAddress(key.PublicKey).Hex(), "every", cfg.Chains.PollInterval)
	for {
		rounds.Round(ctx)
		if !wait(ctx, cfg.Chains.PollInterval) {
			return nil
		}
	}
}

// wait sleeps for d; false when the signer is stopping.
func wait(ctx context.Context, d time.Duration) bool {
	select {
	case <-ctx.Done():
		return false
	case <-time.After(d):
		return true
	}
}
