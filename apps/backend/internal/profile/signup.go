package profile

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5"
)

// RepairBudget bounds, together, the retries of missing wallets on profiles other than the personal one during
// signup, so a slow Privy delays the app's load by at most this much (the api's write timeout is 30 s).
var RepairBudget = 5 * time.Second

// SignUp makes the user and their personal profile once, then makes sure every profile of the user has its wallet. A
// repeated call changes nothing, except that it retries wallets Privy failed to make. Only the personal profile's
// wallet must succeed; another profile's failure is logged and retried on the next call. created reports a new
// personal profile.
func (s *Service) SignUp(ctx context.Context, privyUserID string) (profiles []Profile, created bool, err error) {
	err = pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, "INSERT INTO users (privy_user_id) VALUES ($1) ON CONFLICT DO NOTHING",
			privyUserID); err != nil {
			return fmt.Errorf("insert user: %w", err)
		}
		tag, err := tx.Exec(ctx, `INSERT INTO profiles (user_id, kind) SELECT id, $2 FROM users WHERE privy_user_id = $1
			ON CONFLICT (user_id) WHERE kind = 'personal' DO NOTHING`, privyUserID, Personal)
		if err != nil {
			return fmt.Errorf("insert personal profile: %w", err)
		}
		created = tag.RowsAffected() == 1
		return nil
	})
	if err != nil {
		return nil, false, err
	}
	profiles, err = s.List(ctx, privyUserID)
	if err != nil {
		return nil, false, err
	}
	repaired := false
	repairCtx, cancel := context.WithTimeout(ctx, RepairBudget)
	defer cancel()
	for _, p := range profiles {
		if p.WalletAddress != "" {
			continue
		}
		walletCtx := repairCtx
		if p.Kind == Personal {
			walletCtx = ctx // the personal wallet must exist; it has privy.Timeout of its own
		}
		if err := s.ensureWallet(walletCtx, privyUserID, p.ID); err != nil {
			if p.Kind == Personal {
				return nil, false, err
			}
			slog.Warn("make profile wallet", "profile", p.ID, "err", err)
			continue
		}
		repaired = true
	}
	if repaired {
		profiles, err = s.List(ctx, privyUserID)
	}
	return profiles, created, err
}
