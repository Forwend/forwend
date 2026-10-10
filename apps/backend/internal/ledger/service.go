package ledger

import (
	"github.com/jackc/pgx/v5/pgxpool"
)

type Service struct {
	pool    *pgxpool.Pool
	balance BalanceOf
}

func NewService(pool *pgxpool.Pool, balance BalanceOf) *Service {
	return &Service{pool: pool, balance: balance}
}
