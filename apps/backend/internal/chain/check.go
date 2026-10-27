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

const StartupTimeout = 30 * time.Second

// errUnavailable marks a chain whose RPC hosts don't answer at startup: an outage, not a mistake.
var errUnavailable = errors.New("its RPCs did not answer")

// CheckEnabled checks every enabled chain at startup (D-15); also, when not nil, adds a check per chain.
// A mistake stops the process; a chain whose hosts don't answer is logged and skipped (D-71).
func CheckEnabled(ctx context.Context, db *pgxpool.Pool, specs map[uint64]Spec, rate float64,
	also func(ctx context.Context, chainID uint64, r RPCs) error, budgets ...*Budget) error {
	ids, err := Enabled(ctx, db)
	if err != nil {
		return err
	}
	for _, id := range ids {
		spec, ok := specs[id]
		if !ok {
			return fmt.Errorf("chain %d is enabled in the database but not in the RPC configuration snapshot", id)
		}
		r, err := NewRPCs(spec, rate, budgets...)
		if err != nil {
			return err
		}
		err = r.check(ctx, also)
		r.Close()
		switch {
		case errors.Is(err, errUnavailable):
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
	if err := r.Client.CallContext(ctx, &block, "eth_blockNumber"); err != nil {
		answered, hosts := r.pool.answered()
		err := fmt.Errorf("chain %d: %d of %d RPC hosts answered: %s", r.pool.chainID, answered, hosts, Redact(err))
		if !r.pool.serves() {
			return err
		}
		return fmt.Errorf("%w: %w", err, errUnavailable)
	}
	if also != nil {
		return also(ctx, r.pool.chainID, r)
	}
	return nil
}
