package job

import (
	"time"

	"github.com/ensp1re/forwend/apps/backend/internal/invoice"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Service struct {
	pool     *pgxpool.Pool
	invoices *invoice.Service
	now      func() time.Time
}

func NewService(pool *pgxpool.Pool, invoices *invoice.Service) *Service {
	return &Service{pool: pool, invoices: invoices, now: time.Now}
}
