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

// The caller has checked that the user owns the profile.
func (s *Service) Notifications(ctx context.Context, profileID string) (Notifications, error) {
	var n Notifications
	if err := s.pool.QueryRow(ctx, `SELECT p.email_notifications, coalesce(u.login_email, '')
		FROM profiles p JOIN users u ON u.id = p.user_id WHERE p.id = $1`, profileID).Scan(&n.Email, &n.Address); err != nil {
		return Notifications{}, fmt.Errorf("read notifications: %w", err)
	}
	return n, nil
}

// The address is never set here: it is the login email.
func (s *Service) SetNotifications(ctx context.Context, profileID string, email bool) (Notifications, error) {
	if _, err := s.pool.Exec(ctx, "UPDATE profiles SET email_notifications = $2 WHERE id = $1", profileID, email); err != nil {
		return Notifications{}, fmt.Errorf("save notifications: %w", err)
	}
	return s.Notifications(ctx, profileID)
}
