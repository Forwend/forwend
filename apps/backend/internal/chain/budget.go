package chain

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Budget shares weighted pacing across processes. One ordinary read is 80 units.
type Budget struct {
	db   *pgxpool.Pool
	rate float64
}

func NewBudget(ctx context.Context, db *pgxpool.Pool, rate float64) (*Budget, error) {
	// Ledger reads hold invoice transactions. A separate small pool avoids waiting for a connection they own.
	cfg := db.Config()
	cfg.MaxConns, cfg.MinConns = 2, 0
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, fmt.Errorf("open RPC budget pool: %w", err)
	}
	return &Budget{db: pool, rate: rate * 80}, nil
}

func (b *Budget) Close() { b.db.Close() }

type budgetError struct{ error }

func (e budgetError) Unwrap() error { return e.error }

func (b *Budget) wait(ctx context.Context, endpoint string, body []byte) error {
	remaining := 300.0
	if deadline, ok := ctx.Deadline(); ok {
		remaining = max(0, time.Until(deadline).Seconds())
	}
	seconds := float64(requestCost(body)) / b.rate
	var delay float64
	err := b.db.QueryRow(ctx, `INSERT INTO rpc_budgets (bucket, next_at)
		VALUES ($1, clock_timestamp() + $2 * interval '1 second')
		ON CONFLICT (bucket) DO UPDATE
		SET next_at = greatest(rpc_budgets.next_at, clock_timestamp()) + $2 * interval '1 second'
		WHERE rpc_budgets.next_at <= clock_timestamp() + $3 * interval '1 second'
		RETURNING greatest(0, extract(epoch FROM next_at - $2 * interval '1 second' - clock_timestamp()))::float8`,
		budgetKey(endpoint), seconds, remaining).Scan(&delay)
	if errors.Is(err, pgx.ErrNoRows) {
		err = context.DeadlineExceeded
	}
	if err != nil {
		return budgetError{fmt.Errorf("reserve RPC budget: %w", err)}
	}
	if err := sleepUntil(ctx, time.Now().Add(time.Duration(delay*float64(time.Second)))); err != nil {
		return budgetError{err}
	}
	return nil
}

func budgetKey(endpoint string) string {
	hash := sha256.Sum256([]byte(endpoint))
	return hex.EncodeToString(hash[:])
}

func requestCost(body []byte) int {
	type request struct {
		Method string `json:"method"`
	}
	var calls []request
	if json.Unmarshal(body, &calls) != nil {
		var one request
		_ = json.Unmarshal(body, &one)
		calls = []request{one}
	}
	cost := 0
	for _, c := range calls {
		switch c.Method {
		case "eth_chainId":
			cost += 5
		case "eth_getLogs":
			cost += 255
		case "eth_getBlockReceipts":
			cost += 1000
		case "eth_estimateGas":
			cost += 300
		default:
			cost += 80
		}
	}
	return max(cost, 5)
}
