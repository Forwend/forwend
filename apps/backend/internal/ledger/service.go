package ledger

import (
	"github.com/jackc/pgx/v5/pgxpool"
)

type Service struct {
	pool     *pgxpool.Pool
	balance  BalanceOf
	deployed DeployedAt
}

func NewService(pool *pgxpool.Pool, balance BalanceOf, deployed DeployedAt) *Service {
	return &Service{pool: pool, balance: balance, deployed: deployed}
}
