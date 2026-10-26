package link

import (
	"context"
	"errors"
	"fmt"

	"github.com/forwend/forwend/apps/backend/internal/profile"

	"github.com/jackc/pgx/v5"
)

// The caller has checked the user's access to the profile; every query also names the profile.

// A link's paid count is its invoices paid or settled.
const linkColumns = `l.id::text, coalesce(l.store_id::text, ''), l.slug, l.title, coalesce(l.amount_cents, 0),
	coalesce(l.min_cents, 0), coalesce(l.max_cents, 0), l.ends_at, coalesce(l.max_payments, 0), l.active, l.visits,
	(SELECT paid FROM payment_link_usage u WHERE u.link_id = l.id),
	(SELECT reserved FROM payment_link_usage u WHERE u.link_id = l.id),
	l.created_at, l.updated_at, l.livemode, l.revision`

func scanLink(row pgx.CollectableRow) (Link, error) {
	var l Link
	err := row.Scan(&l.ID, &l.StoreID, &l.Slug, &l.Title, &l.AmountCents, &l.MinCents, &l.MaxCents, &l.EndsAt,
		&l.MaxPayments, &l.Active, &l.Visits, &l.Paid, &l.Reserved, &l.CreatedAt, &l.UpdatedAt, &l.Livemode, &l.Revision)
	return l, err
}

// List is the profile's links, newest first. stores, when not nil, keeps only those stores' links (R-138).
func (s *Service) List(ctx context.Context, profileID string, stores []string, live *bool) ([]Link, error) {
	rows, err := s.pool.Query(ctx, `SELECT `+linkColumns+` FROM payment_links l
		WHERE l.profile_id = $1 AND ($2::uuid[] IS NULL OR l.store_id = ANY($2))
		AND ($3::boolean IS NULL OR l.livemode = $3)
		ORDER BY l.created_at DESC, l.id`, profileID, stores, live)
	if err != nil {
		return nil, fmt.Errorf("list payment links: %w", err)
	}
	links, err := pgx.CollectRows(rows, scanLink)
	if err != nil {
		return nil, fmt.Errorf("list payment links: %w", err)
	}
	type scope struct {
		store string
		live  bool
	}
	readiness := map[scope]bool{}
	for i := range links {
		key := scope{links[i].StoreID, links[i].Livemode}
		ready, ok := readiness[key]
		if !ok {
			r, err := profile.ReadPaymentReadiness(ctx, s.pool, profileID, key.store, key.live)
			if err != nil {
				return nil, err
			}
			ready = r.Ready()
			readiness[key] = ready
		}
		links[i].Ready = ready
	}
	return links, nil
}

func (s *Service) Get(ctx context.Context, profileID, id string) (Link, error) {
	if !lowercaseUUID.MatchString(id) {
		return Link{}, ErrNotFound
	}
	rows, err := s.pool.Query(ctx, `SELECT `+linkColumns+` FROM payment_links l WHERE l.id = $1 AND l.profile_id = $2`,
		id, profileID)
	if err != nil {
		return Link{}, fmt.Errorf("read payment link: %w", err)
	}
	l, err := pgx.CollectExactlyOneRow(rows, scanLink)
	if errors.Is(err, pgx.ErrNoRows) {
		return Link{}, ErrNotFound
	}
	if err != nil {
		return Link{}, fmt.Errorf("read payment link: %w", err)
	}
	ready, err := profile.ReadPaymentReadiness(ctx, s.pool, profileID, l.StoreID, l.Livemode)
	if err != nil {
		return Link{}, err
	}
	l.Ready = ready.Ready()
	return l, nil
}
