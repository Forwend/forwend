package link

import (
	"context"
	"errors"
	"fmt"
	"math/big"
	"regexp"
	"strconv"
	"time"

	"github.com/forwend/forwend/apps/backend/internal/history"
	"github.com/forwend/forwend/apps/backend/internal/invoice"
	"github.com/forwend/forwend/apps/backend/internal/job"
	"github.com/forwend/forwend/apps/backend/internal/profile"
	"github.com/jackc/pgx/v5"
)

// A link's state for its payer (R-142), as the owner's list names it: only a link that is on makes invoices.
const (
	On       = "on"
	Off      = "off"   // the owner turned it off
	Ended    = "ended" // past its last day
	Full     = "full"  // paid as many times as its cap
	NotReady = "not_ready"
)

var (
	ErrOff     = errors.New("the payment link is off")
	ErrEnded   = errors.New("the payment link has ended")
	ErrFull    = errors.New("the payment link has taken all its payments")
	ErrChanged = errors.New("payment link changed before checkout was created")
)

var slugPattern = regexp.MustCompile(`^[a-z0-9]{12}$`)
var offerVersion = regexp.MustCompile(`^[1-9][0-9]{0,18}$`)

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
		&l.Reserved, &l.CreatedAt, &l.UpdatedAt, &l.Livemode, &l.Revision, &l.FeesPaidBy, &p.ProfileID, &p.Payee,
		&p.BrandColor, &p.LogoAt)
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
	case l.MaxPayments > 0 && l.Paid+l.Reserved >= int64(l.MaxPayments):
		p.State = Full
	default:
		p.State = On
	}
	if p.State == On {
		ready, err := profile.ReadPaymentReadiness(ctx, s.pool, p.ProfileID, l.StoreID, l.Livemode)
		if err != nil {
			return Public{}, err
		}
		if !ready.Ready() {
			p.State = NotReady
		}
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

type PayRequest struct {
	AmountUSD, ExpectedAmountUSD, ExpectedVersion string
	Allow                                         func() time.Duration
}

// Pay creates one document-free purchase. Public input is replayed before mutable template checks.
func (s *Service) Pay(ctx context.Context, slug, key string, request PayRequest) (invoice.Invoice,
	bool, error) {
	amountUSD := request.AmountUSD
	p, err := s.Public(ctx, slug)
	if err != nil {
		return invoice.Invoice{}, false, err
	}
	if len(key) > MaxPayKey {
		return invoice.Invoice{}, false, fmt.Errorf("%w: Idempotency-Key must be at most %d bytes", ErrInvalid, MaxPayKey)
	}
	input, err := cents("amountUsd", amountUSD)
	if err != nil {
		return invoice.Invoice{}, false, err
	}
	expected, err := cents("expectedAmountUsd", request.ExpectedAmountUSD)
	if err != nil {
		return invoice.Invoice{}, false, err
	}
	var version *int64
	if request.ExpectedVersion != "" {
		n, err := strconv.ParseInt(request.ExpectedVersion, 10, 64)
		if err != nil || n < 1 || !offerVersion.MatchString(request.ExpectedVersion) {
			return invoice.Invoice{}, false, fmt.Errorf("%w: expectedVersion must be the offer's version", ErrInvalid)
		}
		version = &n
	}
	if inv, found, err := s.replay(ctx, p, input, expected, version, key); found || err != nil {
		return inv, false, err
	}
	switch p.State {
	case Off:
		return invoice.Invoice{}, false, ErrOff
	case Ended:
		return invoice.Invoice{}, false, ErrEnded
	case Full:
		return invoice.Invoice{}, false, ErrFull
	case NotReady:
		return invoice.Invoice{}, false, ErrNotReady
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
	if expected != 0 && expected != amount || version != nil && *version != p.Revision {
		return invoice.Invoice{}, false, ErrChanged
	}
	// Keys are the profile's: a payer's key must never replay the owner's invoices.
	inv, created, err := s.invoices.Create(ctx, p.ProfileID, "link:"+p.ID+":"+key, invoice.Request{Purpose: invoice.PurposeCheckout, AmountUSD: job.USD(amount),
		Details: invoice.Details{Title: p.Title}, StoreID: p.StoreID, LinkID: p.ID, FeesPaidBy: p.FeesPaidBy, By: history.Payer,
		Allow:    request.Allow,
		Livemode: &p.Livemode, Before: func(ctx context.Context, tx pgx.Tx) error {
			if _, err := tx.Exec(ctx, "SELECT 1 FROM payment_links WHERE id = $1 FOR UPDATE", p.ID); err != nil {
				return fmt.Errorf("lock link checkout: %w", err)
			}
			// Reopening can increase reservations without the profile lock. Read a fresh snapshot after the link lock.
			rows, err := tx.Query(ctx, "SELECT "+linkColumns+" FROM payment_links l WHERE l.id = $1", p.ID)
			if err != nil {
				return fmt.Errorf("lock link checkout: %w", err)
			}
			current, err := pgx.CollectExactlyOneRow(rows, scanLink)
			if err != nil {
				return fmt.Errorf("reserve link checkout: %w", err)
			}
			switch {
			case !current.Active:
				return ErrOff
			case current.EndsAt != nil && time.Now().After(*current.EndsAt):
				return ErrEnded
			case current.MaxPayments > 0 && current.Paid+current.Reserved >= int64(current.MaxPayments):
				return ErrFull
			case current.Revision != p.Revision:
				return ErrChanged
			}
			return nil
		}, After: func(ctx context.Context, tx pgx.Tx, id string) error {
			_, err := tx.Exec(ctx, `INSERT INTO link_checkout_requests (invoice_id, amount_cents, expected_amount_cents, expected_revision)
			    VALUES ($1, nullif($2, 0), nullif($3, 0), $4)`, id, input, expected, version)
			if err != nil {
				return fmt.Errorf("record link checkout request: %w", err)
			}
			return nil
		}})
	if err != nil {
		if replay, found, replayErr := s.replay(ctx, p, input, expected, version, key); found || replayErr != nil {
			return replay, false, replayErr
		}
	}
	return inv, created, err
}

func (s *Service) replay(ctx context.Context, p Public, input, expected int64, version *int64, key string) (invoice.Invoice, bool, error) {
	var id string
	var original *int64
	var originalExpected, originalVersion *int64
	var recorded bool
	err := s.pool.QueryRow(ctx, `SELECT i.id, r.amount_cents, r.expected_amount_cents, r.expected_revision, r.invoice_id IS NOT NULL
		FROM invoices i LEFT JOIN link_checkout_requests r ON r.invoice_id = i.id
		WHERE i.profile_id = $1 AND i.link_id = $2 AND i.main_id IS NULL AND i.idempotency_key = $3`,
		p.ProfileID, p.ID, "link:"+p.ID+":"+key).Scan(&id, &original, &originalExpected, &originalVersion, &recorded)
	if errors.Is(err, pgx.ErrNoRows) {
		return invoice.Invoice{}, false, nil
	}
	if err != nil {
		return invoice.Invoice{}, false, fmt.Errorf("read link checkout request: %w", err)
	}
	if recorded && (input != value(original) || expected != value(originalExpected) || value(version) != value(originalVersion)) {
		return invoice.Invoice{}, true, invoice.ErrConflict
	}
	inv, err := s.invoices.GetOfProfile(ctx, p.ProfileID, id)
	if err != nil {
		return invoice.Invoice{}, true, err
	}
	// Legacy requests stored no fixed/open discriminator. A supplied amount must still match the original terms.
	if !recorded && (input != 0 || expected != 0) {
		main := inv.Options[0]
		for _, option := range inv.Options {
			if option.ID == inv.ID {
				main = option
				break
			}
		}
		cents := new(big.Rat).SetFrac(new(big.Int).Mul(main.Amount, big.NewInt(100)),
			new(big.Int).Exp(big.NewInt(10), big.NewInt(int64(main.Decimals)), nil))
		for _, supplied := range []int64{input, expected} {
			if supplied != 0 && cents.Cmp(new(big.Rat).SetInt64(supplied)) != 0 {
				return invoice.Invoice{}, true, invoice.ErrConflict
			}
		}
	}
	return inv, true, nil
}

func value(n *int64) int64 {
	if n == nil {
		return 0
	}
	return *n
}
