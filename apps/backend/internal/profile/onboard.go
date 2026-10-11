package profile

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
)

// First-run choices (R-50, D-53) and the profile kind each one needs. Receive and send is the personal profile every
// user has; a payment integration runs on a merchant profile, so choosing it with business payments makes one.
const (
	ReceiveAndSend         = "receive_and_send"
	GetPaidByClients       = "get_paid_by_clients"
	AcceptBusinessPayments = "accept_business_payments"
	BuildIntegration       = "build_integration"
)

var choiceKinds = map[string]string{
	ReceiveAndSend:         Personal,
	GetPaidByClients:       Freelancer,
	AcceptBusinessPayments: Merchant,
	BuildIntegration:       Merchant,
}

// Onboard runs the first-run choice once: it makes the profiles the choices need and sets the user's onboarded_at,
// in one transaction. Later calls change nothing, whatever they choose. No choices (skip) only sets onboarded_at;
// nil means the request had none and is refused. Wallets are made as at signup, after the transaction. onboarded
// reports that this call did it.
func (s *Service) Onboard(ctx context.Context, privyUserID string, choices []string) (
	profiles []Profile, onboardedAt time.Time, onboarded bool, err error) {
	if choices == nil {
		return nil, time.Time{}, false, fmt.Errorf("%w: choices is required", ErrInvalid)
	}
	kinds := map[string]bool{}
	for _, c := range choices {
		kind, ok := choiceKinds[c]
		if !ok {
			return nil, time.Time{}, false, fmt.Errorf("%w: unknown choice %q", ErrInvalid, c)
		}
		kinds[kind] = true
	}
	err = pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		var userID string
		var at *time.Time
		// The row lock makes concurrent calls run one after another: only the first finds onboarded_at empty.
		err := tx.QueryRow(ctx, "SELECT id, onboarded_at FROM users WHERE privy_user_id = $1 FOR UPDATE",
			privyUserID).Scan(&userID, &at)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotSignedUp
		}
		if err != nil {
			return fmt.Errorf("read user: %w", err)
		}
		if at != nil {
			return nil
		}
		var count int
		if err := tx.QueryRow(ctx, "SELECT count(*) FROM profiles WHERE user_id = $1", userID).Scan(&count); err != nil {
			return fmt.Errorf("count profiles: %w", err)
		}
		added := 0
		for _, kind := range []string{Freelancer, Merchant} {
			if kinds[kind] {
				added++
			}
		}
		if count+added > MaxProfiles {
			return fmt.Errorf("%w: a user has at most %d profiles", ErrInvalid, MaxProfiles)
		}
		for _, kind := range []string{Freelancer, Merchant} {
			if !kinds[kind] {
				continue
			}
			if _, err := tx.Exec(ctx, "INSERT INTO profiles (user_id, kind) VALUES ($1, $2)", userID, kind); err != nil {
				return fmt.Errorf("insert %s profile: %w", kind, err)
			}
		}
		if _, err := tx.Exec(ctx, "UPDATE users SET onboarded_at = now() WHERE id = $1", userID); err != nil {
			return fmt.Errorf("set onboarded_at: %w", err)
		}
		onboarded = true
		return nil
	})
	if err != nil {
		return nil, time.Time{}, false, err
	}
	// Signup makes every missing wallet and lists the profiles; a wallet Privy fails to make now is made by the next
	// signup call, as for POST /v1/profiles.
	if profiles, _, err = s.SignUp(ctx, privyUserID); err != nil {
		return nil, time.Time{}, false, err
	}
	at, err := s.OnboardedAt(ctx, privyUserID)
	if err != nil {
		return nil, time.Time{}, false, err
	}
	return profiles, *at, onboarded, nil
}

// OnboardedAt is when the user finished or skipped the first-run choice; nil until then.
func (s *Service) OnboardedAt(ctx context.Context, privyUserID string) (*time.Time, error) {
	var at *time.Time
	err := s.pool.QueryRow(ctx, "SELECT onboarded_at FROM users WHERE privy_user_id = $1", privyUserID).Scan(&at)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotSignedUp
	}
	if err != nil {
		return nil, fmt.Errorf("read onboarded_at: %w", err)
	}
	return at, nil
}
