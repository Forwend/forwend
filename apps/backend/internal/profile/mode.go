package profile

import (
	"context"
	"fmt"
)

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

// SetFeesPaidBy sets who pays the profile's new invoices' fees (D-122, R-227): "owner", deducted at settlement, or
// "client", added on top of the price. Invoices made before keep theirs.
func (s *Service) SetFeesPaidBy(ctx context.Context, profileID, paidBy string) error {
	if paidBy != "owner" && paidBy != "client" {
		return fmt.Errorf("%w: feesPaidBy must be owner or client", ErrInvalid)
	}
	if _, err := s.pool.Exec(ctx, "UPDATE profiles SET fees_paid_by = $2 WHERE id = $1", profileID, paidBy); err != nil {
		return fmt.Errorf("save who pays the fees: %w", err)
	}
	return nil
}
