package profile

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
)

// List returns the user's profiles, oldest first.
func (s *Service) List(ctx context.Context, privyUserID string) ([]Profile, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT p.id::text, p.kind, coalesce(p.name, ''), coalesce(w.address, ''), p.created_at
		FROM profiles p JOIN users u ON u.id = p.user_id
		LEFT JOIN profile_wallets w ON w.profile_id = p.id AND w.chain_family = 'evm'
		WHERE u.privy_user_id = $1 ORDER BY p.created_at, p.id`, privyUserID)
	if err != nil {
		return nil, fmt.Errorf("read profiles: %w", err)
	}
	profiles, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (Profile, error) {
		var p Profile
		err := row.Scan(&p.ID, &p.Kind, &p.Name, &p.WalletAddress, &p.CreatedAt)
		return p, err
	})
	if err != nil {
		return nil, fmt.Errorf("read profiles: %w", err)
	}
	if len(profiles) == 0 {
		return nil, ErrNotSignedUp
	}
	return profiles, nil
}
