package link

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

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

// MaxLimit is the largest page; List without a limit reads every link, as before pages.
const MaxLimit = 100

// Page is one page of links; NextCursor is "" on the last one.
type Page struct {
	Links      []Link
	NextCursor string
}

// List is the profile's links, newest first. stores, when not nil, keeps only those stores' links (R-138). limit 0
// reads every link after cursor.
func (s *Service) List(ctx context.Context, profileID string, stores []string, live *bool, cursor string, limit int) (Page, error) {
	if limit < 0 || limit > MaxLimit {
		return Page{}, fmt.Errorf("%w: limit must be 1 to %d", ErrInvalid, MaxLimit)
	}
	args := []any{profileID, stores, live}
	where := "l.profile_id = $1 AND ($2::uuid[] IS NULL OR l.store_id = ANY($2)) AND ($3::boolean IS NULL OR l.livemode = $3)"
	if cursor != "" {
		at, id, err := decodeCursor(cursor)
		if err != nil {
			return Page{}, err
		}
		args = append(args, at, id)
		where += " AND (l.created_at < $4 OR l.created_at = $4 AND l.id > $5)"
	}
	page := ""
	if limit > 0 {
		args = append(args, limit+1)
		page = fmt.Sprintf(" LIMIT $%d", len(args))
	}
	rows, err := s.pool.Query(ctx, `SELECT `+linkColumns+` FROM payment_links l WHERE `+where+`
		ORDER BY l.created_at DESC, l.id`+page, args...)
	if err != nil {
		return Page{}, fmt.Errorf("list payment links: %w", err)
	}
	links, err := pgx.CollectRows(rows, scanLink)
	if err != nil {
		return Page{}, fmt.Errorf("list payment links: %w", err)
	}
	var next string
	if limit > 0 && len(links) > limit {
		links = links[:limit]
		last := links[limit-1]
		next = base64.RawURLEncoding.EncodeToString([]byte(fmt.Sprintf("%d|%s", last.CreatedAt.UnixMicro(), last.ID)))
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
				return Page{}, err
			}
			ready = r.Ready()
			readiness[key] = ready
		}
		links[i].Ready = ready
	}
	return Page{Links: links, NextCursor: next}, nil
}

// A cursor is the last link's creation time (Unix microseconds, Postgres' precision) and id.
func decodeCursor(cursor string) (time.Time, string, error) {
	raw, err := base64.RawURLEncoding.DecodeString(cursor)
	at, id, ok := strings.Cut(string(raw), "|")
	micros, parseErr := strconv.ParseInt(at, 10, 64)
	if err != nil || !ok || parseErr != nil || !lowercaseUUID.MatchString(id) {
		return time.Time{}, "", fmt.Errorf("%w: cursor is not one this API returned", ErrInvalid)
	}
	return time.UnixMicro(micros), id, nil
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
