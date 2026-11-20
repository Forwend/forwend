package profile

import (
	"context"

	"github.com/forwend/forwend/apps/backend/internal/privy"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Service struct {
	pool    *pgxpool.Pool
	wallets *privy.Client
}

func NewService(pool *pgxpool.Pool, wallets *privy.Client) *Service {
	return &Service{pool: pool, wallets: wallets}
}

type rowQuerier interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}
