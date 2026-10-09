// Package profile signs users up and keeps their profiles, each with one Privy wallet (R-32, D-20, D-21).
package profile

import (
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/ensp1re/forwend/apps/backend/internal/privy"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Profile kinds (D-20). Personal is made at signup; the others by request.
const (
	Personal   = "personal"
	Freelancer = "freelancer"
	Merchant   = "merchant"
)

const MaxNameLength = 64 // characters

var (
	// ErrInvalid wraps a request value that breaks a rule; the message names it.
	ErrInvalid = errors.New("invalid profile request")
	// ErrConflict means the idempotency key was used with another request.
	ErrConflict = errors.New("idempotency key reused with another request")
	// ErrNotSignedUp means the user has not called signup yet.
	ErrNotSignedUp = errors.New("user has not signed up")
)

// Profile is one of a user's profiles. Name is "" when none was given; WalletAddress is "" until Privy has made the
// wallet (a failed create is retried by repeating the request).
type Profile struct {
	ID            string
	Kind          string
	Name          string
	WalletAddress string
	CreatedAt     time.Time
}

type Service struct {
	pool    *pgxpool.Pool
	wallets *privy.Client
}

func NewService(pool *pgxpool.Pool, wallets *privy.Client) *Service {
	return &Service{pool: pool, wallets: wallets}
}

// SignUp makes the user and their personal profile once, then makes sure the profile has its wallet. A repeated call
// changes nothing, except that it retries a wallet Privy failed to make. created reports a new personal profile.
func (s *Service) SignUp(ctx context.Context, privyUserID string) (profiles []Profile, created bool, err error) {
	err = pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, "INSERT INTO users (privy_user_id) VALUES ($1) ON CONFLICT DO NOTHING",
			privyUserID); err != nil {
			return fmt.Errorf("insert user: %w", err)
		}
		tag, err := tx.Exec(ctx, `INSERT INTO profiles (user_id, kind) SELECT id, $2 FROM users WHERE privy_user_id = $1
			ON CONFLICT (user_id) WHERE kind = 'personal' DO NOTHING`, privyUserID, Personal)
		if err != nil {
			return fmt.Errorf("insert personal profile: %w", err)
		}
		created = tag.RowsAffected() == 1
		return nil
	})
	if err != nil {
		return nil, false, err
	}
	var personal string
	if err := s.pool.QueryRow(ctx, `SELECT p.id::text FROM profiles p JOIN users u ON u.id = p.user_id
		WHERE u.privy_user_id = $1 AND p.kind = $2`, privyUserID, Personal).Scan(&personal); err != nil {
		return nil, false, fmt.Errorf("read personal profile: %w", err)
	}
	if err := s.ensureWallet(ctx, privyUserID, personal); err != nil {
		return nil, false, err
	}
	profiles, err = s.List(ctx, privyUserID)
	return profiles, created, err
}

// List returns the user's profiles, oldest first.
func (s *Service) List(ctx context.Context, privyUserID string) ([]Profile, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT p.id::text, p.kind, coalesce(p.name, ''), coalesce(w.address, ''), p.created_at
		FROM profiles p JOIN users u ON u.id = p.user_id
		LEFT JOIN profile_wallets w ON w.profile_id = p.id AND w.chain_family = 'evm'
		WHERE u.privy_user_id = $1 ORDER BY p.created_at, p.id`, privyUserID)
	if err != nil {
		return nil, fmt.Errorf("read profiles: %w", err)
	}
	profiles, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (Profile, error) {
		var p Profile
		err := row.Scan(&p.ID, &p.Kind, &p.Name, &p.WalletAddress, &p.CreatedAt)
		return p, err
	})
	if err != nil {
		return nil, fmt.Errorf("read profiles: %w", err)
	}
	if len(profiles) == 0 {
		return nil, ErrNotSignedUp
	}
	return profiles, nil
}

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
	if err := s.ensureWallet(ctx, privyUserID, id); err != nil {
		return Profile{}, false, err
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

// ensureWallet stores the profile's Privy wallet unless it has one. Concurrent calls get the same wallet from Privy
// (looked up by external_id); the profile row lock lets one store it and the others see it. Any other conflict, such
// as a wallet already stored for another profile, is an error.
func (s *Service) ensureWallet(ctx context.Context, privyUserID, profileID string) error {
	has, err := s.hasWallet(ctx, s.pool, profileID)
	if err != nil || has {
		return err
	}
	w, err := s.wallets.ProfileWallet(ctx, privyUserID, profileID)
	if err != nil {
		return err
	}
	return pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, "SELECT FROM profiles WHERE id = $1 FOR UPDATE", profileID); err != nil {
			return fmt.Errorf("lock profile %s: %w", profileID, err)
		}
		if has, err := s.hasWallet(ctx, tx, profileID); err != nil || has {
			return err
		}
		if _, err := tx.Exec(ctx, `INSERT INTO profile_wallets (profile_id, provider, provider_wallet_id, chain_family, address)
			VALUES ($1, 'privy', $2, 'evm', $3)`, profileID, w.ID, w.Address); err != nil {
			return fmt.Errorf("insert profile %s wallet: %w", profileID, err)
		}
		return nil
	})
}

func (s *Service) hasWallet(ctx context.Context, db interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}, profileID string) (bool, error) {
	var has bool
	if err := db.QueryRow(ctx, "SELECT EXISTS (SELECT 1 FROM profile_wallets WHERE profile_id = $1 AND chain_family = 'evm')",
		profileID).Scan(&has); err != nil {
		return false, fmt.Errorf("read profile %s wallet: %w", profileID, err)
	}
	return has, nil
}
