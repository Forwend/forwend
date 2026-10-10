package profile

import (
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
)

// Create makes a freelancer or merchant profile once per (user, idempotency key), then makes sure it has its wallet.
// created is false when the same request was already made: the stored profile is returned.
func (s *Service) Create(ctx context.Context, privyUserID, idempotencyKey, kind, name string) (p Profile, created bool, err error) {
	if kind != Freelancer && kind != Merchant {
		return Profile{}, false, fmt.Errorf("%w: kind must be %s or %s", ErrInvalid, Freelancer, Merchant)
	}
	if !utf8.ValidString(name) || strings.ContainsRune(name, 0) || utf8.RuneCountInString(name) > MaxNameLength {
		return Profile{}, false, fmt.Errorf("%w: name must be at most %d characters of text", ErrInvalid, MaxNameLength)
	}
	hash := sha256.Sum256([]byte(kind + "\x00" + name))
	var id string
	err = s.pool.QueryRow(ctx, `
		INSERT INTO profiles (user_id, kind, name, idempotency_key, request_hash)
		SELECT id, $2, NULLIF($3, ''), $4, $5 FROM users WHERE privy_user_id = $1
		ON CONFLICT (user_id, idempotency_key) DO NOTHING RETURNING id::text`,
		privyUserID, kind, name, idempotencyKey, hash[:]).Scan(&id)
	created = err == nil
	if errors.Is(err, pgx.ErrNoRows) { // no such user, or this key was used before
		var stored []byte
		err = s.pool.QueryRow(ctx, `SELECT p.id::text, p.request_hash FROM profiles p JOIN users u ON u.id = p.user_id
			WHERE u.privy_user_id = $1 AND p.idempotency_key = $2`, privyUserID, idempotencyKey).Scan(&id, &stored)
		if errors.Is(err, pgx.ErrNoRows) {
			return Profile{}, false, ErrNotSignedUp
		}
		if err == nil && string(stored) != string(hash[:]) {
			return Profile{}, false, ErrConflict
		}
	}
	if err != nil {
		return Profile{}, false, fmt.Errorf("insert profile: %w", err)
	}
	// A wallet Privy fails to make now is made by the next signup call; the profile itself is created, so the user
	// sees it (wallet not ready) and a retry with other values can't make a second one.
	if err := s.ensureWallet(ctx, privyUserID, id); err != nil {
		slog.Warn("make profile wallet", "profile", id, "err", err)
	}
	profiles, err := s.List(ctx, privyUserID)
	if err != nil {
		return Profile{}, false, err
	}
	for _, p := range profiles {
		if p.ID == id {
			return p, created, nil
		}
	}
	return Profile{}, false, fmt.Errorf("profile %s is not listed", id)
}
