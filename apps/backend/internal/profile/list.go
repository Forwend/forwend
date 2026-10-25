package profile

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
)

func (s *Service) List(ctx context.Context, privyUserID string) ([]Profile, error) {
	// The user's own profiles first, then the merchant profiles they are a member of.
	rows, err := s.pool.Query(ctx, `
		SELECT p.id::text, p.kind, coalesce(p.name, ''), coalesce(w.address, ''), p.created_at, a.role
		FROM users u
		JOIN (SELECT user_id, id AS profile_id, 'owner' AS role FROM profiles
		      UNION ALL SELECT user_id, profile_id, role FROM profile_members) a ON a.user_id = u.id
		JOIN profiles p ON p.id = a.profile_id
		LEFT JOIN profile_wallets w ON w.profile_id = p.id AND w.chain_family = 'evm'
		WHERE u.privy_user_id = $1 ORDER BY a.role <> 'owner', p.created_at, p.id`, privyUserID)
	if err != nil {
		return nil, fmt.Errorf("read profiles: %w", err)
	}
	profiles, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (Profile, error) {
		var p Profile
		err := row.Scan(&p.ID, &p.Kind, &p.Name, &p.WalletAddress, &p.CreatedAt, &p.Role)
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
