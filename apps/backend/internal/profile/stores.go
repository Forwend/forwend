package profile

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"regexp"
	"slices"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
)

// MaxStores is per merchant profile; the list is read whole. MaxOrigins is per store.
const (
	MaxStores  = 20
	MaxOrigins = 20
)

// A store's default checkout close is within an invoice's expiresIn bounds (D-18), in seconds.
const (
	MinStoreExpiresIn = 900
	MaxStoreExpiresIn = 31_536_000
)

var (
	ErrStoreNotFound = errors.New("store not found")
	// Stores are a merchant profile's (D-30).
	ErrNotMerchant = errors.New("only a merchant profile has stores")
)

// StoreDetails are what the owner saves (R-134). An invoice made without expiresIn closes after DefaultExpiresIn
// seconds; a return link must start with one of AllowedOrigins.
type StoreDetails struct {
	Name             string
	DefaultExpiresIn int64
	AllowedOrigins   []string
	BrandColor       string // "#rrggbb" or "" (R-135)
	// More tokens off for the store's invoices than the profile has off (R-136).
	TokensOff []TokenPair
}

// Store's ID is its project ID: public, with no authority (D-31).
type Store struct {
	StoreDetails
	ID        string
	UpdatedAt time.Time
	LogoAt    *time.Time // when the logo was saved; nil without one (R-135)
}

// Allows reports whether link's origin is one of the store's allowed origins.
func (s Store) Allows(link string) bool {
	o, _ := origin(link)
	return o != "" && slices.Contains(s.AllowedOrigins, o)
}

// origin is link's https origin in lower case, without the default port; ok is false when link has more than an
// origin (a path, query or fragment).
func origin(link string) (o string, ok bool) {
	u, err := url.Parse(link)
	if err != nil || u.Scheme != "https" || u.Host == "" || u.User != nil || u.Opaque != "" {
		return "", false
	}
	o = "https://" + strings.TrimSuffix(strings.ToLower(u.Host), ":443")
	return o, (u.Path == "" || u.Path == "/") && u.RawQuery == "" && !u.ForceQuery && u.Fragment == "" &&
		!strings.HasSuffix(link, "#")
}

// check validates d and puts its origins in their stored form, without repeats.
func (d *StoreDetails) check() error {
	d.Name = strings.TrimSpace(d.Name)
	if d.Name == "" || !utf8.ValidString(d.Name) || utf8.RuneCountInString(d.Name) > MaxNameLength ||
		!PlainText(d.Name, false) {
		return fmt.Errorf("%w: name must be 1 to %d characters of plain text", ErrInvalid, MaxNameLength)
	}
	if Impersonates(d.Name) {
		return fmt.Errorf("%w: name can't name Forwend", ErrInvalid)
	}
	if d.BrandColor != "" && !brandColor.MatchString(d.BrandColor) {
		return fmt.Errorf("%w: brandColor must be a color like #1f6a8c", ErrInvalid)
	}
	d.BrandColor = strings.ToLower(d.BrandColor)
	if d.DefaultExpiresIn < MinStoreExpiresIn || d.DefaultExpiresIn > MaxStoreExpiresIn {
		return fmt.Errorf("%w: defaultExpiresIn must be seconds from %d to %d", ErrInvalid, MinStoreExpiresIn,
			MaxStoreExpiresIn)
	}
	origins := make([]string, 0, len(d.AllowedOrigins))
	for _, link := range d.AllowedOrigins {
		o, ok := origin(strings.TrimSpace(link))
		if !ok || len(o) > 300 || !PlainText(o, false) || strings.ContainsFunc(o, func(r rune) bool { return r > '~' }) {
			return fmt.Errorf("%w: allowedOrigins must be https origins like https://shop.example.com", ErrInvalid)
		}
		if !slices.Contains(origins, o) {
			origins = append(origins, o)
		}
	}
	if len(origins) > MaxOrigins {
		return fmt.Errorf("%w: a store has at most %d allowed origins", ErrInvalid, MaxOrigins)
	}
	d.AllowedOrigins = origins
	return nil
}

var brandColor = regexp.MustCompile(`^#[0-9a-fA-F]{6}$`)

const storeColumns = `id::text, name, default_expires_in, allowed_origins, coalesce(brand_color, ''), updated_at, logo_at,
	coalesce((SELECT array_agg(o.chain_id::text || ':' || o.token_contract ORDER BY o.chain_id, o.token_contract)
	          FROM store_tokens_off o JOIN tokens t ON t.chain_id = o.chain_id AND t.contract = o.token_contract
	          JOIN chains c ON c.chain_id = t.chain_id
	          WHERE o.store_id = stores.id AND t.enabled AND c.enabled), '{}')`

func scanStore(row pgx.CollectableRow) (Store, error) {
	var s Store
	var off []string
	err := row.Scan(&s.ID, &s.Name, &s.DefaultExpiresIn, &s.AllowedOrigins, &s.BrandColor, &s.UpdatedAt, &s.LogoAt, &off)
	s.TokensOff = make([]TokenPair, 0, len(off))
	for _, o := range off {
		chainID, token, _ := strings.Cut(o, ":")
		var t TokenPair
		fmt.Sscan(chainID, &t.ChainID)
		t.Token = token
		s.TokensOff = append(s.TokensOff, t)
	}
	return s, err
}

// The callers below have checked that the user owns the profile; every query also names the profile, so a store id
// from another profile is not found.

// Stores lists the profile's stores, the first one first; a personal or freelancer profile has none.
func (s *Service) Stores(ctx context.Context, profileID string) ([]Store, error) {
	rows, err := s.pool.Query(ctx, `SELECT `+storeColumns+` FROM stores WHERE profile_id = $1 ORDER BY created_at, id`,
		profileID)
	if err != nil {
		return nil, fmt.Errorf("list stores: %w", err)
	}
	stores, err := pgx.CollectRows(rows, scanStore)
	if err != nil {
		return nil, fmt.Errorf("list stores: %w", err)
	}
	return stores, nil
}

// SaveStore upserts by the id the caller chose, so sending the same request twice saves one store. Invoices made
// earlier keep their close; a changed list of origins applies to return links set from now on.
func (s *Service) SaveStore(ctx context.Context, profileID, id string, d StoreDetails) (Store, bool, error) {
	if err := d.check(); err != nil {
		return Store{}, false, err
	}
	if !lowercaseUUID.MatchString(id) {
		return Store{}, false, fmt.Errorf("%w: storeId must be a lowercase UUID", ErrInvalid)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return Store{}, false, fmt.Errorf("save store: %w", err)
	}
	defer tx.Rollback(ctx)
	// The profile row lock makes concurrent saves count one after another, so none passes the cap on a stale count.
	var kind string
	if err := tx.QueryRow(ctx, "SELECT kind FROM profiles WHERE id = $1 FOR UPDATE", profileID).Scan(&kind); err != nil {
		return Store{}, false, fmt.Errorf("lock profile: %w", err)
	}
	if kind != Merchant {
		return Store{}, false, ErrNotMerchant
	}
	off, err := enabledOff(ctx, tx, "tokensOff", d.TokensOff)
	if err != nil {
		return Store{}, false, err
	}
	// An id that belongs to another profile neither inserts (the conflict) nor updates (the WHERE), so no row comes back.
	var st Store
	var created bool
	err = tx.QueryRow(ctx, `
		INSERT INTO stores (id, profile_id, name, default_expires_in, allowed_origins, brand_color)
		SELECT $2, $1, $3, $4, $5, nullif($7, '')
		WHERE (SELECT count(*) FROM stores WHERE profile_id = $1) < $6 OR EXISTS (SELECT 1 FROM stores WHERE id = $2)
		ON CONFLICT (id) DO UPDATE SET name = excluded.name, default_expires_in = excluded.default_expires_in,
		    allowed_origins = excluded.allowed_origins, brand_color = excluded.brand_color, updated_at = now()
		    WHERE stores.profile_id = excluded.profile_id
		RETURNING `+storeColumns+`, xmax = 0`, profileID, id, d.Name, d.DefaultExpiresIn, d.AllowedOrigins, MaxStores,
		d.BrandColor).
		Scan(&st.ID, &st.Name, &st.DefaultExpiresIn, &st.AllowedOrigins, &st.BrandColor, &st.UpdatedAt, &st.LogoAt,
			new([]string), &created)
	if errors.Is(err, pgx.ErrNoRows) {
		var taken bool
		if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM stores WHERE id = $1)`, id).Scan(&taken); err != nil {
			return Store{}, false, fmt.Errorf("save store: %w", err)
		}
		if taken {
			return Store{}, false, ErrStoreNotFound
		}
		return Store{}, false, fmt.Errorf("%w: a profile has at most %d stores", ErrInvalid, MaxStores)
	}
	if err != nil {
		return Store{}, false, fmt.Errorf("save store: %w", err)
	}
	if _, err := tx.Exec(ctx, "DELETE FROM store_tokens_off WHERE store_id = $1", id); err != nil {
		return Store{}, false, fmt.Errorf("save store tokens off: %w", err)
	}
	for _, t := range off {
		if _, err := tx.Exec(ctx, `INSERT INTO store_tokens_off (store_id, chain_id, token_contract) VALUES ($1, $2, $3)`,
			id, t.ChainID, t.Token); err != nil {
			return Store{}, false, fmt.Errorf("save store tokens off: %w", err)
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return Store{}, false, fmt.Errorf("save store: %w", err)
	}
	st.TokensOff = append([]TokenPair{}, off...)
	return st, created, nil
}

// InvoiceStore is the store a merchant invoice records: id, or the profile's first store when id is "". An id that is
// not one of the profile's stores is ErrStoreNotFound.
func InvoiceStore(ctx context.Context, tx pgx.Tx, profileID, id string) (Store, error) {
	if id != "" && !lowercaseUUID.MatchString(id) {
		return Store{}, ErrStoreNotFound
	}
	rows, err := tx.Query(ctx, `SELECT `+storeColumns+` FROM stores
		WHERE profile_id = $1 AND id = coalesce(nullif($2, '')::uuid, id) ORDER BY created_at, id LIMIT 1`, profileID, id)
	if err != nil {
		return Store{}, fmt.Errorf("read store: %w", err)
	}
	st, err := pgx.CollectExactlyOneRow(rows, scanStore)
	if errors.Is(err, pgx.ErrNoRows) {
		return Store{}, ErrStoreNotFound
	}
	if err != nil {
		return Store{}, fmt.Errorf("read store: %w", err)
	}
	return st, nil
}
