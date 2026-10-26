package link

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/forwend/forwend/apps/backend/internal/invoice"
	"github.com/forwend/forwend/apps/backend/internal/profile"
	"github.com/jackc/pgx/v5"
)

var (
	lowercaseUUID = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)
	// Whole dollars up to 10^12 and at most two decimals: USD cents fit a bigint with room.
	usd = regexp.MustCompile(`^([0-9]{1,12})(?:\.([0-9]{1,2}))?$`)
)

// cents is a USD decimal in cents; "" is 0, for none.
func cents(field, s string) (int64, error) {
	if s == "" {
		return 0, nil
	}
	m := usd.FindStringSubmatch(s)
	if m == nil {
		return 0, fmt.Errorf("%w: %s must be a USD amount like 12.50", ErrInvalid, field)
	}
	if c, _ := strconv.ParseInt(m[1]+m[2]+strings.Repeat("0", 2-len(m[2])), 10, 64); c > 0 {
		return c, nil
	}
	return 0, fmt.Errorf("%w: %s must be above 0", ErrInvalid, field)
}

// newSlug is 12 random lowercase letters and digits (D-94): 60 bits of base32, so a link can't be guessed.
func newSlug() string {
	return strings.ToLower(rand.Text()[:12])
}

// Save creates the link with the id the caller picks, or replaces every field of the profile's link with that id:
// a retried save makes one link. Its slug is made once and never changes. created is true for a new link.
func (s *Service) Save(ctx context.Context, profileID, id string, d Details) (l Link, created bool, err error) {
	d.Title = strings.TrimSpace(d.Title)
	if !lowercaseUUID.MatchString(id) {
		return Link{}, false, fmt.Errorf("%w: linkId must be a lowercase UUID", ErrInvalid)
	}
	if d.Title == "" || !utf8.ValidString(d.Title) || utf8.RuneCountInString(d.Title) > invoice.MaxTitle ||
		!profile.PlainText(d.Title, false) {
		return Link{}, false, fmt.Errorf("%w: title must be 1 to %d characters of plain text", ErrInvalid, invoice.MaxTitle)
	}
	amount, err := cents("amountUsd", d.AmountUSD)
	if err != nil {
		return Link{}, false, err
	}
	low, err := cents("minUsd", d.MinUSD)
	if err != nil {
		return Link{}, false, err
	}
	high, err := cents("maxUsd", d.MaxUSD)
	if err != nil {
		return Link{}, false, err
	}
	if amount > 0 && (low > 0 || high > 0) {
		return Link{}, false, fmt.Errorf("%w: a fixed amountUsd has no minUsd or maxUsd", ErrInvalid)
	}
	if low > 0 && high > 0 && low > high {
		return Link{}, false, fmt.Errorf("%w: minUsd must be at most maxUsd", ErrInvalid)
	}
	maxPayments := 0
	if d.MaxPayments != nil {
		if *d.MaxPayments < 1 || *d.MaxPayments > MaxPayments {
			return Link{}, false, fmt.Errorf("%w: maxPayments must be from 1 to %d, or left out", ErrInvalid, MaxPayments)
		}
		maxPayments = *d.MaxPayments
	}
	slug := newSlug()
	err = pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		var kind string
		if err := tx.QueryRow(ctx, "SELECT kind FROM profiles WHERE id = $1 FOR NO KEY UPDATE", profileID).Scan(&kind); err != nil {
			return fmt.Errorf("read profile: %w", err)
		}
		var oldStore string
		var live bool
		prior := tx.QueryRow(ctx, `SELECT coalesce(store_id::text, ''), livemode FROM payment_links
            WHERE id = $1 AND profile_id = $2 FOR UPDATE`, id, profileID).Scan(&oldStore, &live)
		if prior != nil && !errors.Is(prior, pgx.ErrNoRows) {
			return fmt.Errorf("read payment link identity: %w", prior)
		}
		if prior == nil {
			if d.Livemode != nil && *d.Livemode != live {
				return ErrNotFound
			}
			if d.StoreID != "" && strings.ToLower(d.StoreID) != oldStore {
				return fmt.Errorf("%w: storeId never changes; create another link for another store", ErrInvalid)
			}
			d.StoreID = oldStore
		} else {
			if d.Livemode != nil {
				live = *d.Livemode
			} else if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM tokens t JOIN chains c ON c.chain_id = t.chain_id
			WHERE t.enabled AND c.enabled AND c.livemode)`).Scan(&live); err != nil {
				return fmt.Errorf("read payment link mode: %w", err)
			}
		}
		store := ""
		switch kind {
		case profile.Personal:
			return ErrPersonal
		case profile.Merchant:
			st, err := profile.InvoiceStore(ctx, tx, profileID, strings.ToLower(d.StoreID))
			if err != nil {
				return err
			}
			store = st.ID
		default:
			if d.StoreID != "" {
				return fmt.Errorf("%w: storeId: only a merchant profile has stores", ErrInvalid)
			}
		}
		if d.Active {
			ready, err := profile.ReadPaymentReadiness(ctx, tx, profileID, store, live)
			if err != nil {
				return err
			}
			if !ready.Ready() {
				return ErrNotReady
			}
		}
		// An id of another profile's link neither inserts (the conflict) nor updates (the WHERE): no row comes back.
		err := tx.QueryRow(ctx, `
			INSERT INTO payment_links (id, profile_id, store_id, slug, title, amount_cents, min_cents, max_cents, ends_at,
			    max_payments, active, livemode)
			VALUES ($1, $2, nullif($3, '')::uuid, $4, $5, nullif($6, 0), nullif($7, 0), nullif($8, 0), $9, nullif($10, 0), $11, $12)
			ON CONFLICT (id) DO UPDATE SET title = excluded.title,
			    amount_cents = excluded.amount_cents, min_cents = excluded.min_cents, max_cents = excluded.max_cents,
			    ends_at = excluded.ends_at, max_payments = excluded.max_payments, active = excluded.active,
			    updated_at = now()
			    WHERE payment_links.profile_id = excluded.profile_id
			      AND ($13::boolean IS NULL OR payment_links.livemode = $13)
			RETURNING xmax = 0`, id, profileID, store, slug, d.Title, amount, low, high, d.EndsAt, maxPayments,
			d.Active, live, d.Livemode).Scan(&created)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		if err != nil {
			return fmt.Errorf("save payment link: %w", err)
		}
		return nil
	})
	if err != nil {
		return Link{}, false, err
	}
	l, err = s.Get(ctx, profileID, id)
	return l, created, err
}
