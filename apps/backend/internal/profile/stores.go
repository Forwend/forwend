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

	"github.com/forwend/forwend/apps/backend/internal/auth"
	"github.com/jackc/pgx/v5"
)

// MaxStores is per merchant profile; MaxOrigins is per store.
const (
	MaxStores  = 20
	MaxOrigins = 20
)

// A store's default checkout close, in seconds: an invoice's expiresIn bounds.
const (
	MinStoreExpiresIn = 900
	MaxStoreExpiresIn = 31_536_000
)

var (
	ErrStoreNotFound = errors.New("store not found")
	ErrNotMerchant   = errors.New("only a merchant profile has stores")
)

type StoreDetails struct {
	Name             string
	DefaultExpiresIn int64
	AllowedOrigins   []string
	BrandColor       string      // "#rrggbb" or ""
	TokensOff        []TokenPair // on top of the profile's
	TokensFixed      bool        // only an Admin may change TokensOff
}

// Store's ID is its project ID: public, with no authority.
type Store struct {
	StoreDetails
	ID        string
	UpdatedAt time.Time
	LogoAt    *time.Time // nil without a logo
}

func (s Store) Allows(link string) bool {
	o, _ := origin(link)
	return o != "" && slices.Contains(s.AllowedOrigins, o)
}

// FramedBy: browserOrigin must be exactly as a browser writes it, so it can go into a header unchanged.
func FramedBy(allowed []string, browserOrigin string, live bool) bool {
	o, ok := origin(browserOrigin)
	return ok && o == browserOrigin && slices.Contains(allowed, o) && (!live || strings.HasPrefix(o, "https://"))
}

// origin is https, or http on a loopback host for test mode; ok is false when link has more than an origin.
func origin(link string) (o string, ok bool) {
	u, err := url.Parse(link)
	if err != nil || u.Host == "" || u.User != nil || u.Opaque != "" {
		return "", false
	}
	// Only a hostname and a port: it goes into frame-ancestors, where "*" or ";" would mean more.
	host := strings.ToLower(u.Host)
	if !originHost.MatchString(host) {
		return "", false
	}
	switch {
	case u.Scheme == "https":
		o = "https://" + strings.TrimSuffix(host, ":443")
	case u.Scheme == "http" && (u.Hostname() == "localhost" || u.Hostname() == "127.0.0.1"):
		o = "http://" + strings.TrimSuffix(host, ":80")
	default:
		return "", false
	}
	return o, (u.Path == "" || u.Path == "/") && u.RawQuery == "" && !u.ForceQuery && u.Fragment == "" &&
		!strings.HasSuffix(link, "#")
}

func (d *StoreDetails) check() error {
	d.Name = strings.TrimSpace(d.Name)
	if d.Name == "" || !ValidText(d.Name, MaxNameLength, false) {
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
			return fmt.Errorf("%w: allowedOrigins must be https origins like https://shop.example.com, or "+
				"http://localhost:<port> for test mode", ErrInvalid)
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

var (
	brandColor = regexp.MustCompile(`^#[0-9a-fA-F]{6}$`)
	originHost = regexp.MustCompile(`^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*(:[0-9]{1,5})?$`)
)

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

// Callers below have checked access; every query also names the profile, so another profile's store is not found.

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

func (s *Service) Store(ctx context.Context, profileID, id string) (Store, error) {
	if !lowercaseUUID.MatchString(id) {
		return Store{}, ErrStoreNotFound
	}
	rows, err := s.pool.Query(ctx, `SELECT `+storeColumns+` FROM stores WHERE profile_id = $1 AND id = $2`, profileID, id)
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

// SaveStore upserts by the caller's id, so a repeat saves one store.
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
	// The profile row lock serializes saves, so none passes the cap on a stale count.
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
	// Another profile's id neither inserts (the conflict) nor updates (the WHERE): no row comes back.
	var st Store
	var created bool
	var was []string // "chainId:token"
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
			&was, &created)
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
	if d.TokensFixed {
		now := make([]string, 0, len(off))
		for _, t := range off {
			now = append(now, fmt.Sprint(t.ChainID)+":"+t.Token)
		}
		slices.Sort(was)
		slices.Sort(now)
		if !slices.Equal(was, now) {
			return Store{}, false, fmt.Errorf("%w: only an Admin turns a store's tokens on or off", auth.ErrForbidden)
		}
	} else {
		// The form hides unavailable tokens, so their saved restrictions stay.
		if _, err := tx.Exec(ctx, `DELETE FROM store_tokens_off o USING tokens t, chains c
			WHERE o.store_id = $1 AND o.chain_id = t.chain_id AND o.token_contract = t.contract
			AND c.chain_id = t.chain_id AND t.enabled AND c.enabled`, id); err != nil {
			return Store{}, false, fmt.Errorf("save store tokens off: %w", err)
		}
		for _, t := range off {
			if _, err := tx.Exec(ctx, `INSERT INTO store_tokens_off (store_id, chain_id, token_contract) VALUES ($1, $2, $3)`,
				id, t.ChainID, t.Token); err != nil {
				return Store{}, false, fmt.Errorf("save store tokens off: %w", err)
			}
		}
	}
	if err := checkTokensOn(ctx, tx, profileID, id); err != nil {
		return Store{}, false, err
	}
	if err := tx.Commit(ctx); err != nil {
		return Store{}, false, fmt.Errorf("save store: %w", err)
	}
	st.TokensOff = append([]TokenPair{}, off...)
	return st, created, nil
}

// InvoiceStore is id's store, or the profile's first store when id is "".
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
