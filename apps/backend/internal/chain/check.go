package chain

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/ethereum/go-ethereum/common/hexutil"
	"github.com/jackc/pgx/v5/pgxpool"
)

// StartupTimeout bounds the startup check of one chain.
const StartupTimeout = 30 * time.Second

// ErrUnavailable marks a startup check that got no answer from a chain's RPCs: an outage, not a mistake in the chain
// list or on chain.
var ErrUnavailable = errors.New("its RPCs did not answer")

// CheckEnabled is the api's, worker's and signer's startup check: every chain enabled in the database must be in the
// chain list and answer through a primary and a second RPC on different hosts (D-15). also, when not nil, runs a
// further check per chain with its RPCs (the factory, the signer's executor gas). Each chain has StartupTimeout. A
// mistake stops the process. A chain whose RPCs don't answer is logged and skipped (D-71): the process then rides out
// that outage as it rides out one that starts later, and nothing is decided paid or settled there without the second
// RPC.
func CheckEnabled(ctx context.Context, db *pgxpool.Pool, specs map[uint64]Spec, keys []string, rate float64,
	also func(ctx context.Context, chainID uint64, r RPCs) error) error {
	ids, err := Enabled(ctx, db)
	if err != nil {
		return err
	}
	for _, id := range ids {
		spec, ok := specs[id]
		if !ok {
			return fmt.Errorf("chain %d is enabled in the database but not in the chain list (CHAINS_FILE)", id)
		}
		r, err := NewRPCs(spec, keys, rate)
		if err != nil {
			return err
		}
		err = r.check(ctx, also)
		r.Close()
		switch {
		case errors.Is(err, ErrUnavailable):
			slog.Warn("chain unavailable at startup; its requests wait for its RPCs", "chain", id, "err", Redact(err))
		case err != nil:
			return errors.New(Redact(err)) // the process logs it as it stops
		}
	}
	return nil
}

func (r RPCs) check(ctx context.Context, also func(context.Context, uint64, RPCs) error) error {
	ctx, cancel := context.WithTimeout(ctx, StartupTimeout)
	defer cancel()
	var block hexutil.Uint64
	err := r.Primary.CallContext(ctx, &block, "eth_blockNumber")
	if err == nil {
		err = r.Second.CallContext(ctx, &block, "eth_blockNumber")
	}
	if err != nil {
		answered, hosts := r.pool.answered()
		return fmt.Errorf("chain %d: %d of %d RPC hosts answered; D-15 needs a primary and a second on different "+
			"hosts: %s: %w", r.pool.chainID, answered, hosts, Redact(err), ErrUnavailable)
	}
	if also != nil {
		return also(ctx, r.pool.chainID, r)
	}
	return nil
}
