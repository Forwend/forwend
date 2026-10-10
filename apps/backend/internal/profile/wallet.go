package profile

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
)

// ensureWallet stores the profile's Privy wallet unless it has one. Concurrent calls get the same wallet from Privy
// (looked up by external_id); the profile row lock lets one store it and the others see it. Any other conflict, such
// as a wallet already stored for another profile, is an error.
func (s *Service) ensureWallet(ctx context.Context, privyUserID, profileID string) error {
	has, err := s.hasWallet(ctx, s.pool, profileID)
	if err != nil || has {
		return err
	}
	w, err := s.wallets.ProfileWallet(ctx, privyUserID, profileID)
	if err != nil {
		return err
	}
	return pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, "SELECT FROM profiles WHERE id = $1 FOR UPDATE", profileID); err != nil {
			return fmt.Errorf("lock profile %s: %w", profileID, err)
		}
		if has, err := s.hasWallet(ctx, tx, profileID); err != nil || has {
			return err
		}
		if _, err := tx.Exec(ctx, `INSERT INTO profile_wallets (profile_id, provider, provider_wallet_id, chain_family, address)
			VALUES ($1, 'privy', $2, 'evm', $3)`, profileID, w.ID, w.Address); err != nil {
			return fmt.Errorf("insert profile %s wallet: %w", profileID, err)
		}
		return nil
	})
}

func (s *Service) hasWallet(ctx context.Context, db interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}, profileID string) (bool, error) {
	var has bool
	if err := db.QueryRow(ctx, "SELECT EXISTS (SELECT 1 FROM profile_wallets WHERE profile_id = $1 AND chain_family = 'evm')",
		profileID).Scan(&has); err != nil {
		return false, fmt.Errorf("read profile %s wallet: %w", profileID, err)
	}
	return has, nil
}
