package profile

import (
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"log/slog"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
)

// Create is idempotent per (user, idempotency key); created is false when the stored profile is returned.
func (s *Service) Create(ctx context.Context, privyUserID, idempotencyKey, kind, name string) (p Profile, created bool, err error) {
	if kind != Freelancer && kind != Merchant {
		return Profile{}, false, fmt.Errorf("%w: kind must be %s or %s", ErrInvalid, Freelancer, Merchant)
	}
	if err := checkName(name); err != nil {
		return Profile{}, false, err
	}
	hash := sha256.Sum256([]byte(kind + "\x00" + name))
	id, created, err := s.insert(ctx, privyUserID, idempotencyKey, kind, name, hash[:])
	if err != nil {
		return Profile{}, false, err
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

// checkName holds a profile name to what New profile and the first run both accept; empty means no name.
func checkName(name string) error {
	if !utf8.ValidString(name) || utf8.RuneCountInString(name) > MaxNameLength || !PlainText(name, false) {
		return fmt.Errorf("%w: name must be at most %d characters of plain text", ErrInvalid, MaxNameLength)
	}
	if Impersonates(name) {
		return fmt.Errorf("%w: name can't name Forwend", ErrInvalid)
	}
	return nil
}

// The user row lock makes the cap hold against concurrent requests: each profile's wallet is scanned forever.
func (s *Service) insert(ctx context.Context, privyUserID, idempotencyKey, kind, name string, hash []byte) (string, bool, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return "", false, fmt.Errorf("insert profile: %w", err)
	}
	defer tx.Rollback(ctx)
	var userID string
	err = tx.QueryRow(ctx, "SELECT id::text FROM users WHERE privy_user_id = $1 FOR UPDATE", privyUserID).Scan(&userID)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", false, ErrNotSignedUp
	}
	if err != nil {
		return "", false, fmt.Errorf("insert profile: %w", err)
	}
	// Counted after the lock, in its own statement, so it sees profiles other requests committed while we waited.
	var count int
	if err := tx.QueryRow(ctx, "SELECT count(*) FROM profiles WHERE user_id = $1", userID).Scan(&count); err != nil {
		return "", false, fmt.Errorf("insert profile: %w", err)
	}
	var id string
	var stored []byte
	err = tx.QueryRow(ctx, "SELECT id::text, request_hash FROM profiles WHERE user_id = $1 AND idempotency_key = $2",
		userID, idempotencyKey).Scan(&id, &stored)
	switch {
	case err == nil && string(stored) != string(hash):
		return "", false, ErrConflict
	case err == nil:
		return id, false, nil
	case !errors.Is(err, pgx.ErrNoRows):
		return "", false, fmt.Errorf("insert profile: %w", err)
	case count >= MaxProfiles:
		return "", false, fmt.Errorf("%w: a user has at most %d profiles", ErrInvalid, MaxProfiles)
	}
	err = tx.QueryRow(ctx, `INSERT INTO profiles (user_id, kind, name, idempotency_key, request_hash)
		VALUES ($1, $2, NULLIF($3, ''), $4, $5) RETURNING id::text`, userID, kind, name, idempotencyKey, hash).Scan(&id)
	if err != nil {
		return "", false, fmt.Errorf("insert profile: %w", err)
	}
	return id, true, tx.Commit(ctx)
}
