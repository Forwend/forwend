package auth

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
)

type Service struct {
	pool *pgxpool.Pool
}

func NewService(pool *pgxpool.Pool) *Service {
	return &Service{pool: pool}
}

// CheckSession refuses a token issued before the user signed out everywhere (R-137). A user not signed up yet has
// no cutoff.
func (s *Service) CheckSession(ctx context.Context, t Token) error {
	var revoked bool
	err := s.pool.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM users WHERE privy_user_id = $1
		AND sessions_revoked_at > to_timestamp($2))`, t.User, t.IssuedAt.Unix()).Scan(&revoked)
	if err != nil {
		return fmt.Errorf("check session: %w", err)
	}
	if revoked {
		return fmt.Errorf("%w: issued before sign out everywhere", ErrUnauthorized)
	}
	return nil
}
