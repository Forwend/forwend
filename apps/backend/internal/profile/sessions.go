package profile

import (
	"context"
	"errors"
	"fmt"
)

// Privy's freeze first, then refuse older tokens: a failed freeze leaves the user signed in to retry.
func (s *Service) SignOutEverywhere(ctx context.Context, privyUserID string) error {
	ended, err := s.wallets.EndSessions(ctx, privyUserID)
	if !ended {
		return err
	}
	if _, uerr := s.pool.Exec(context.WithoutCancel(ctx), `UPDATE users SET sessions_revoked_at = now()
		WHERE privy_user_id = $1`, privyUserID); uerr != nil {
		return errors.Join(err, fmt.Errorf("revoke sessions: %w", uerr))
	}
	return err
}
