package profile

import (
	"github.com/ensp1re/forwend/apps/backend/internal/privy"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Service struct {
	pool    *pgxpool.Pool
	wallets *privy.Client
}

func NewService(pool *pgxpool.Pool, wallets *privy.Client) *Service {
	return &Service{pool: pool, wallets: wallets}
}
