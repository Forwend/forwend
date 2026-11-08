package apikey

import (
	"context"
	"errors"
	"fmt"
	"regexp"
	"slices"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/forwend/forwend/apps/backend/internal/auth"
	"github.com/forwend/forwend/apps/backend/internal/profile"
	"github.com/jackc/pgx/v5"
)

// MaxName is the longest name a key takes.
const MaxName = 100

var lowercaseUUID = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)

// A key works until it is revoked or its overlap after a roll ends.
const (
	keyColumns = `id::text, coalesce(store_id::text, ''), name, livemode, last4, scopes, created_at, last_used_at,
		expires_at`
	working = `revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now())`
)

func scanKey(row pgx.CollectableRow) (Key, error) {
	var k Key
	var scopes []string
	err := row.Scan(&k.ID, &k.StoreID, &k.Name, &k.Livemode, &k.Last4, &scopes, &k.CreatedAt, &k.LastUsedAt,
		&k.ExpiresAt)
	for _, s := range scopes {
		k.Scopes = append(k.Scopes, auth.Permission(s))
	}
	return k, err
}

// Create makes a key in the profile's mode (D-120) and answers its text, the one time it is shown. A merchant's key is
// for one of its stores; a freelancer's has none.
// The caller has checked the user's access to the profile and the fresh sign-in (D-63).
func (s *Service) Create(ctx context.Context, profileID, user, name, storeID string, scopes []auth.Permission) (Key,
	string, error) {
	name = strings.TrimSpace(name)
	if name == "" || !utf8.ValidString(name) || utf8.RuneCountInString(name) > MaxName || !profile.PlainText(name, false) {
		return Key{}, "", fmt.Errorf("%w: name must be 1 to %d characters of plain text", ErrInvalid, MaxName)
	}
	invalid := len(scopes) == 0
	for _, p := range scopes {
		invalid = invalid || !slices.Contains(Scopes, p)
	}
	if invalid {
		return Key{}, "", fmt.Errorf("%w: scopes must be one or more of %v", ErrInvalid, Scopes)
	}
	// Each once, in Scopes' order.
	scopes = slices.DeleteFunc(slices.Clone(Scopes), func(p auth.Permission) bool { return !slices.Contains(scopes, p) })
	storeID = strings.ToLower(storeID)
	var kind string
	var stored, live bool
	if err := s.pool.QueryRow(ctx, `SELECT kind, EXISTS (SELECT 1 FROM stores WHERE profile_id = p.id AND id::text = $2),
		livemode FROM profiles p WHERE id = $1`, profileID, storeID).Scan(&kind, &stored, &live); err != nil {
		return Key{}, "", fmt.Errorf("read profile: %w", err)
	}
	switch {
	case kind == profile.Personal:
		return Key{}, "", ErrPersonal
	case kind == profile.Merchant && !stored:
		return Key{}, "", fmt.Errorf("%w: storeId must be one of the profile's stores", ErrInvalid)
	case kind != profile.Merchant && storeID != "":
		return Key{}, "", fmt.Errorf("%w: storeId: only a merchant profile has stores", ErrInvalid)
	}
	var k Key
	var text string
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		var err error
		k, text, err = s.insert(ctx, tx, profileID, user, Key{StoreID: storeID, Name: name, Livemode: live, Scopes: scopes})
		return err
	})
	return k, text, err
}

func (s *Service) insert(ctx context.Context, tx pgx.Tx, profileID, user string, k Key) (Key, string, error) {
	if err := auth.StillCan(ctx, tx, profileID, user, auth.Keys); err != nil {
		return Key{}, "", err
	}
	text, hash := newText(k.Livemode)
	k.Last4 = text[len(text)-4:]
	err := tx.QueryRow(ctx, `INSERT INTO api_keys (profile_id, store_id, name, livemode, secret_hash, last4, scopes,
		    created_by)
		SELECT $1, NULLIF($2, '')::uuid, $3, $4, $5, $6, $7, id FROM users WHERE privy_user_id = $8
		RETURNING id::text, created_at`, profileID, k.StoreID, k.Name, k.Livemode, hash, k.Last4, k.Scopes, user).
		Scan(&k.ID, &k.CreatedAt)
	if err != nil {
		return Key{}, "", fmt.Errorf("insert API key: %w", err)
	}
	return k, text, nil
}

// ofProfileMode keeps a key, by id with its profile as $2, to the profile's mode: the dashboard reaches one mode at a
// time (R-221), and only signed-in owners and Admins manage keys.
const ofProfileMode = "livemode = (SELECT livemode FROM profiles WHERE id = $2)"

// List is the profile's working keys of its mode (R-221), newest first.
func (s *Service) List(ctx context.Context, profileID string) ([]Key, error) {
	rows, err := s.pool.Query(ctx, `SELECT `+keyColumns+` FROM api_keys WHERE profile_id = $1 AND `+working+`
		AND livemode = (SELECT livemode FROM profiles WHERE id = $1) ORDER BY created_at DESC, id`, profileID)
	if err != nil {
		return nil, fmt.Errorf("list API keys: %w", err)
	}
	keys, err := pgx.CollectRows(rows, scanKey)
	if err != nil {
		return nil, fmt.Errorf("list API keys: %w", err)
	}
	return keys, nil
}

// Roll makes a new key like the profile's key id, whose text the caller gets once, and keeps the old one working for
// overlap, so a developer can swap it without downtime. A key rolls once; its new one rolls next.
func (s *Service) Roll(ctx context.Context, profileID, id, user string, overlap time.Duration) (Key, string, error) {
	if overlap < 0 || overlap > MaxOverlap {
		return Key{}, "", fmt.Errorf("%w: overlap must be 0 to %s", ErrInvalid, MaxOverlap)
	}
	if !lowercaseUUID.MatchString(id) {
		return Key{}, "", ErrNotFound
	}
	var k Key
	var text string
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `UPDATE api_keys SET expires_at = now() + $3 * interval '1 second'
			WHERE id = $1 AND profile_id = $2 AND revoked_at IS NULL AND expires_at IS NULL AND `+ofProfileMode+`
			RETURNING `+keyColumns, id, profileID, int64(overlap/time.Second))
		if err != nil {
			return fmt.Errorf("roll API key: %w", err)
		}
		old, err := pgx.CollectExactlyOneRow(rows, scanKey)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		} else if err != nil {
			return fmt.Errorf("roll API key: %w", err)
		}
		k, text, err = s.insert(ctx, tx, profileID, user, Key{StoreID: old.StoreID, Name: old.Name,
			Livemode: old.Livemode, Scopes: old.Scopes})
		return err
	})
	return k, text, err
}

// Revoke stops the profile's key id at once.
func (s *Service) Revoke(ctx context.Context, profileID, id string) error {
	if !lowercaseUUID.MatchString(id) {
		return ErrNotFound
	}
	tag, err := s.pool.Exec(ctx, `UPDATE api_keys SET revoked_at = now() WHERE id = $1 AND profile_id = $2 AND `+working+
		` AND `+ofProfileMode, id, profileID)
	if err != nil {
		return fmt.Errorf("revoke API key: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}
