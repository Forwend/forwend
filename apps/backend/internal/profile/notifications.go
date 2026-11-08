package profile

import (
	"context"
	"fmt"
)

// Notifications (R-80): Address is the login email it goes to; "" when the account has none or it was not read yet.
type Notifications struct {
	Email   bool
	Address string
}

// The caller has checked the user's access to the profile.
func (s *Service) Notifications(ctx context.Context, profileID string) (Notifications, error) {
	var n Notifications
	if err := s.pool.QueryRow(ctx, `SELECT p.email_notifications, coalesce(u.login_email, '')
		FROM profiles p JOIN users u ON u.id = p.user_id WHERE p.id = $1`, profileID).Scan(&n.Email, &n.Address); err != nil {
		return Notifications{}, fmt.Errorf("read notifications: %w", err)
	}
	return n, nil
}

// SetLivemode turns Developer mode off (live) or on (test) for the profile (R-221). Objects keep their own mode. Live
// mode needs a mainnet switched on: without one, as on staging, the profile could take no payment.
func (s *Service) SetLivemode(ctx context.Context, profileID string, live bool) error {
	tag, err := s.pool.Exec(ctx, `UPDATE profiles SET livemode = $2 WHERE id = $1
		AND (NOT $2 OR EXISTS (SELECT 1 FROM chains WHERE enabled AND livemode))`, profileID, live)
	if err != nil {
		return fmt.Errorf("save profile mode: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("%w: livemode: no live network is switched on yet", ErrInvalid)
	}
	return nil
}

// The address is never set here: it is the login email.
func (s *Service) SetNotifications(ctx context.Context, profileID string, email bool) (Notifications, error) {
	if _, err := s.pool.Exec(ctx, "UPDATE profiles SET email_notifications = $2 WHERE id = $1", profileID, email); err != nil {
		return Notifications{}, fmt.Errorf("save notifications: %w", err)
	}
	return s.Notifications(ctx, profileID)
}
