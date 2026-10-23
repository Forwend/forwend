package auth

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Service struct {
	pool *pgxpool.Pool
}

func NewService(pool *pgxpool.Pool) *Service {
	return &Service{pool: pool}
}

// CheckProfileOwner returns ErrForbidden unless the user with this Privy DID owns the profile. A malformed or unknown
// profile ID is also ErrForbidden, so callers can't probe which profiles exist.
func (s *Service) CheckProfileOwner(ctx context.Context, privyUserID, profileID string) error {
	var id pgtype.UUID
	if err := id.Scan(profileID); err != nil {
		return ErrForbidden
	}
	var owned bool
	err := s.pool.QueryRow(ctx, `
		SELECT EXISTS (SELECT 1 FROM profiles p JOIN users u ON u.id = p.user_id
		               WHERE p.id = $1 AND u.privy_user_id = $2)`, id, privyUserID).Scan(&owned)
	if err != nil {
		return fmt.Errorf("check profile owner: %w", err)
	}
	if !owned {
		return ErrForbidden
	}
	return nil
}
