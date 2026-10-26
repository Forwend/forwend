package invoice

import (
	"context"
	"errors"
)

type CheckoutState string

var ErrCheckoutNotExpirable = errors.New("checkout cannot expire after payment is seen")

const (
	CheckoutOpen     CheckoutState = "open"
	CheckoutComplete CheckoutState = "complete"
	CheckoutExpired  CheckoutState = "expired"
)

func (i Invoice) CheckoutState() CheckoutState {
	if i.PaymentStatus == "paid" {
		return CheckoutComplete
	}
	if i.Closed || i.PaymentStatus == "expired" || i.PaymentStatus == "expired_partially_paid" || i.PaymentStatus == "canceled" {
		return CheckoutExpired
	}
	return CheckoutOpen
}

func (s *Service) Checkout(ctx context.Context, profileID, id string) (Invoice, error) {
	inv, err := s.Payment(ctx, profileID, id)
	if errors.Is(err, ErrPaymentNotFound) || err == nil && inv.Purpose != PurposeCheckout {
		return Invoice{}, ErrCheckoutNotFound
	}
	return inv, err
}

func (s *Service) ExpireCheckout(ctx context.Context, profileID, id string) (Invoice, error) {
	inv, err := s.Checkout(ctx, profileID, id)
	if err != nil || inv.CheckoutState() == CheckoutExpired {
		return inv, err
	}
	inv, err = s.Cancel(ctx, profileID, inv.ID)
	if errors.Is(err, ErrNotCancelable) {
		current, readErr := s.Checkout(ctx, profileID, id)
		if readErr == nil && current.CheckoutState() == CheckoutExpired {
			return current, nil
		}
		return Invoice{}, ErrCheckoutNotExpirable
	}
	return inv, err
}
