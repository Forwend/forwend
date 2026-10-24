package profile

import (
	"context"
	"errors"
	"fmt"
)

// SignOutEverywhere ends the user's sessions at Privy, then refuses every token issued before now (R-137): Privy's
// freeze stops refreshes, but a token the API verifies itself stays valid until it expires. Privy goes first, so when
// the freeze fails the cutoff is not set and the user, still signed in, can try again. Once the freeze worked the
// cutoff is set even if the unfreeze failed, and neither stops when the caller gives up.
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
