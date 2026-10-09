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

	rpcs := map[uint64]chain.RPCs{}
	clients := map[uint64]*ethclient.Client{}
	signer := settlement.NewSigner(pool, key, clients)
	defer func() {
		for _, r := range rpcs {
			r.Close()
		}
	}()
	slog.Info("signer ready", "executor", crypto.PubkeyToAddress(key.PublicKey).Hex(), "every", cfg.Chains.PollInterval)
	for {
		ids, err := chain.Enabled(ctx, pool)
		if err != nil {
			slog.Error("signer round", "err", err)
		}
		for _, id := range ids {
			if _, ok := rpcs[id]; ok {
				continue
			}
			spec, known := specs[id]
			if !known {
				slog.Error("enabled chain is not in the chain list", "chain", id)
				continue
			}
			r, err := chain.Dial(ctx, spec, cfg.Chains.InfuraKeys)
			if err != nil {
				slog.Error("pick RPCs", "chain", id, "err", err)
				continue
			}
			rpcs[id], clients[id] = r, ethclient.NewClient(r.Primary)
		}
		if err := signer.Run(ctx); err != nil {
			slog.Error("signer round", "err", err)
			for id, r := range rpcs { // pick RPCs again next round
				r.Close()
				delete(rpcs, id)
				delete(clients, id)
			}
		}
		select {
		case <-ctx.Done():
			return nil
		case <-time.After(cfg.Chains.PollInterval):
		}
	}
}
