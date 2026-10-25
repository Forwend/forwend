package link

import (
	"context"
	"errors"
	"fmt"
	"regexp"
	"time"

	"github.com/ensp1re/forwend/apps/backend/internal/history"
	"github.com/ensp1re/forwend/apps/backend/internal/invoice"
	"github.com/ensp1re/forwend/apps/backend/internal/job"
	"github.com/jackc/pgx/v5"
)

// A link's state for its payer (R-142), as the owner's list names it: only a link that is on makes invoices.
const (
	On    = "on"
	Off   = "off"   // the owner turned it off
	Ended = "ended" // past its last day
	Full  = "full"  // paid as many times as its cap
)

var (
	ErrOff   = errors.New("the payment link is off")
	ErrEnded = errors.New("the payment link has ended")
	ErrFull  = errors.New("the payment link has taken all its payments")
)

var slugPattern = regexp.MustCompile(`^[a-z0-9]{12}$`)

// MaxPayKey leaves room in the invoice's 255-byte key for the link's prefix.
const MaxPayKey = 200

// Public is a link as its payer sees it at /l/<slug>. Payee is the billing name, "" before the owner saves billing
// details; a merchant store's link also has its branding (R-135).
type Public struct {
	Link
	ProfileID  string
	Payee      string
	BrandColor string
	LogoAt     *time.Time
	State      string
}

func (s *Service) Public(ctx context.Context, slug string) (Public, error) {
	if !slugPattern.MatchString(slug) {
		return Public{}, ErrNotFound
	}
	var p Public
	l := &p.Link
	err := s.pool.QueryRow(ctx, `SELECT `+linkColumns+`, l.profile_id::text, coalesce(b.name, ''),
		    coalesce(st.brand_color, ''), st.logo_at
		FROM payment_links l LEFT JOIN profile_billing_details b ON b.profile_id = l.profile_id
		LEFT JOIN stores st ON st.id = l.store_id WHERE l.slug = $1`, slug).Scan(&l.ID, &l.StoreID, &l.Slug, &l.Title,
		&l.AmountCents, &l.MinCents, &l.MaxCents, &l.EndsAt, &l.MaxPayments, &l.Active, &l.Visits, &l.Paid,
		&l.CreatedAt, &l.UpdatedAt, &p.ProfileID, &p.Payee, &p.BrandColor, &p.LogoAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return Public{}, ErrNotFound
	}
	if err != nil {
		return Public{}, fmt.Errorf("read payment link %s: %w", slug, err)
	}
	switch {
	case !l.Active:
		p.State = Off
	case l.EndsAt != nil && time.Now().After(*l.EndsAt):
		p.State = Ended
	case l.MaxPayments > 0 && l.Paid >= int64(l.MaxPayments):
		p.State = Full
	default:
		p.State = On
	}
	return p, nil
}

// Visit counts one opening of the link's page; the page makes nothing (D-54).
func (s *Service) Visit(ctx context.Context, slug string) error {
	if !slugPattern.MatchString(slug) {
		return ErrNotFound
	}
	tag, err := s.pool.Exec(ctx, "UPDATE payment_links SET visits = visits + 1 WHERE slug = $1", slug)
	if err != nil {
		return fmt.Errorf("count payment link %s visit: %w", slug, err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// Pay makes the payer's invoice (R-142): the payer picks the token, the link's store sets the tokens and the close,
// and the invoice has no number until its first deposit (R-141). amountUSD is the payer's for an open link and ""
// for a fixed one. key is the payer's Idempotency-Key, so a retried Pay makes one invoice. allow is asked only just
// before the insert, so a Pay that makes no invoice spends none of it (R-117).
func (s *Service) Pay(ctx context.Context, slug, amountUSD, key string, allow func() time.Duration) (invoice.Invoice,
	bool, error) {
	p, err := s.Public(ctx, slug)
	if err != nil {
		return invoice.Invoice{}, false, err
	}
	switch p.State {
	case Off:
		return invoice.Invoice{}, false, ErrOff
	case Ended:
		return invoice.Invoice{}, false, ErrEnded
	case Full:
		return invoice.Invoice{}, false, ErrFull
	}
	amount := p.AmountCents
	switch {
	case amount > 0 && amountUSD != "":
		return invoice.Invoice{}, false, fmt.Errorf("%w: amountUsd: this link's amount is fixed", ErrInvalid)
	case amount == 0 && amountUSD == "":
		return invoice.Invoice{}, false, fmt.Errorf("%w: amountUsd: enter the amount to pay", ErrInvalid)
	case amount == 0:
		if amount, err = cents("amountUsd", amountUSD); err != nil {
			return invoice.Invoice{}, false, err
		}
		if amount < p.MinCents || p.MaxCents > 0 && amount > p.MaxCents {
			return invoice.Invoice{}, false, fmt.Errorf("%w: amountUsd must be within the link's limits", ErrInvalid)
		}
	}
	if len(key) > MaxPayKey {
		return invoice.Invoice{}, false, fmt.Errorf("%w: Idempotency-Key must be at most %d bytes", ErrInvalid,
			MaxPayKey)
	}
	// Keys are the profile's: a payer's key must never replay the owner's invoices.
	return s.invoices.Create(ctx, p.ProfileID, "link:"+p.ID+":"+key, invoice.Request{AmountUSD: job.USD(amount),
		Details: invoice.Details{Title: p.Title}, StoreID: p.StoreID, LinkID: p.ID, By: history.Payer, Allow: allow})
}
