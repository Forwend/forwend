// Package reauth is Forwend's own Confirm it's you (R-137, D-49): the api emails a 6-digit code, and a confirmed one
// makes the user's Privy session fresh for auth.FreshWindow. Privy's own email login, made while signed in, keeps the
// session and its sign-in time, so it can't prove one.
package reauth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"errors"
	"fmt"
	"math/big"
	"regexp"
	"time"

	"github.com/forwend/forwend/apps/backend/internal/auth"
	"github.com/forwend/forwend/apps/backend/internal/email"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	// CodeTTL is how long an emailed code works.
	CodeTTL = 10 * time.Minute
	// MaxAttempts wrong codes end a code: a million codes can't be guessed in five.
	MaxAttempts = 5
	// ResendAfter is per session; MaxPerHour bounds the codes one user had emailed and never confirmed in an hour.
	ResendAfter = 30 * time.Second
	MaxPerHour  = 10
)

var (
	// ErrNoSession: the token carries no Privy session to confirm.
	ErrNoSession = errors.New("the token has no session")
	// ErrTooSoon: this session got a code a moment ago, which is still the one to enter.
	ErrTooSoon = errors.New("a code was sent a moment ago")
	// ErrTooMany: the user had the hour's codes (MaxPerHour by default); the answer says when another may go.
	ErrTooMany = errors.New("too many codes this hour")
	// ErrWrongCode: wrong, expired, used up, or never sent for this session.
	ErrWrongCode = errors.New("wrong or expired code")
	// ErrNoEmail: the api has no email key, so no code can be sent.
	ErrNoEmail = errors.New("email is not configured")
	// ErrNoAddress: the user has no login email to send a code to.
	ErrNoAddress = errors.New("the account has no email")
)

// Mailer turns a code into the email that carries it (notify.CodeMessage).
type Mailer func(code string) (email.Message, error)

// Addresses gives a user's login email (privy.Client.LoginEmail); "" for none.
type Addresses func(ctx context.Context, privyUserID string) (string, error)

type Service struct {
	pool    *pgxpool.Pool
	sender  email.Sender // nil: no email key
	mail    Mailer
	address Addresses
	perHour int
	now     func() time.Time
}

// NewService: perHour 0 keeps MaxPerHour.
func NewService(pool *pgxpool.Pool, sender email.Sender, mail Mailer, address Addresses, perHour int) *Service {
	if perHour == 0 {
		perHour = MaxPerHour
	}
	return &Service{pool: pool, sender: sender, mail: mail, address: address, perHour: perHour, now: time.Now}
}

// Send emails a new code to the user's login email for the token's session. wait is how long until another may be
// asked for.
func (s *Service) Send(ctx context.Context, t auth.Token) (wait time.Duration, err error) {
	if t.Session == "" {
		return 0, ErrNoSession
	}
	if s == nil || s.sender == nil {
		return 0, ErrNoEmail
	}
	// Read before the lock: a slow Privy answer must not hold the user's row.
	address, err := s.address(ctx, t.User)
	if err != nil {
		return 0, err
	}
	now := s.now()
	// The user's row lock makes the limits and the new code one step, so requests at once send one email.
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return 0, fmt.Errorf("begin: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	var user string
	if err := tx.QueryRow(ctx, "SELECT id::text FROM users WHERE privy_user_id = $1 FOR UPDATE", t.User).
		Scan(&user); err != nil {
		return 0, fmt.Errorf("lock user: %w", err)
	}
	var last, oldest *time.Time
	var hour int
	err = tx.QueryRow(ctx, `
		SELECT max(created_at) FILTER (WHERE session = $2),
		       min(created_at) FILTER (WHERE created_at > $3::timestamptz - interval '1 hour' AND confirmed_at IS NULL),
		       count(*) FILTER (WHERE created_at > $3::timestamptz - interval '1 hour' AND confirmed_at IS NULL)
		FROM fresh_sign_ins WHERE user_id = $1`, user, t.Session, now).Scan(&last, &oldest, &hour)
	if err != nil {
		return 0, fmt.Errorf("read codes sent: %w", err)
	}
	// The gap is per session: another device's code is no use here. The hourly cap is per user, as the inbox is, and
	// counts codes never confirmed: those are what guessing and a flooded inbox take, so an owner who confirms isn't
	// stopped.
	if last != nil && now.Sub(*last) < ResendAfter {
		return ResendAfter - now.Sub(*last), ErrTooSoon
	}
	if hour >= s.perHour && oldest != nil {
		return oldest.Add(time.Hour).Sub(now), ErrTooMany
	}
	if address == "" {
		return 0, ErrNoAddress
	}
	n, err := rand.Int(rand.Reader, big.NewInt(1_000_000))
	if err != nil {
		return 0, fmt.Errorf("make code: %w", err)
	}
	code := fmt.Sprintf("%06d", n.Int64())
	// The id is the hash's salt, so the row is written once its id is known.
	var id string
	err = tx.QueryRow(ctx, `INSERT INTO fresh_sign_ins (user_id, session, code_hash, created_at, expires_at)
		VALUES ($1, $2, '\x', $3, $4) RETURNING id::text`, user, t.Session, now, now.Add(CodeTTL)).Scan(&id)
	if err != nil {
		return 0, fmt.Errorf("save code: %w", err)
	}
	if _, err := tx.Exec(ctx, "UPDATE fresh_sign_ins SET code_hash = $2 WHERE id = $1", id, hash(id, code)); err != nil {
		return 0, fmt.Errorf("save code: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return 0, fmt.Errorf("commit: %w", err)
	}
	m, err := s.mail(code)
	if err == nil {
		m.To, m.Key = address, "fresh-sign-in-"+id
		err = s.sender.Send(ctx, m)
	}
	if err != nil {
		// A code that never left must not count as sent: not for the 30 s gap, nor the hour's cap.
		if _, delErr := s.pool.Exec(context.WithoutCancel(ctx), "DELETE FROM fresh_sign_ins WHERE id = $1", id); delErr != nil {
			return 0, errors.Join(fmt.Errorf("email code: %w", err), fmt.Errorf("drop unsent code: %w", delErr))
		}
		return 0, fmt.Errorf("email code: %w", err)
	}
	return ResendAfter, nil
}

// Verify checks code against the session's newest code and confirms it.
func (s *Service) Verify(ctx context.Context, t auth.Token, code string) error {
	if t.Session == "" {
		return ErrNoSession
	}
	if s == nil {
		return ErrNoEmail
	}
	if !codePattern.MatchString(code) { // not a code at all: no try is used up
		return ErrWrongCode
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	var id string
	var stored []byte
	var attempts int
	var expires time.Time
	var confirmed *time.Time
	err = tx.QueryRow(ctx, `
		SELECT f.id::text, f.code_hash, f.attempts, f.expires_at, f.confirmed_at
		FROM fresh_sign_ins f JOIN users u ON u.id = f.user_id
		WHERE u.privy_user_id = $1 AND f.session = $2 ORDER BY f.created_at DESC LIMIT 1 FOR UPDATE OF f`,
		t.User, t.Session).Scan(&id, &stored, &attempts, &expires, &confirmed)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrWrongCode
	} else if err != nil {
		return fmt.Errorf("read code: %w", err)
	}
	if confirmed != nil || attempts >= MaxAttempts || !s.now().Before(expires) {
		return ErrWrongCode
	}
	if subtle.ConstantTimeCompare(stored, hash(id, code)) != 1 {
		if _, err := tx.Exec(ctx, "UPDATE fresh_sign_ins SET attempts = attempts + 1 WHERE id = $1", id); err != nil {
			return fmt.Errorf("count attempt: %w", err)
		}
		if err := tx.Commit(ctx); err != nil {
			return fmt.Errorf("commit: %w", err)
		}
		return ErrWrongCode
	}
	if _, err := tx.Exec(ctx, "UPDATE fresh_sign_ins SET confirmed_at = $2 WHERE id = $1", id, s.now()); err != nil {
		return fmt.Errorf("confirm code: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit: %w", err)
	}
	return nil
}

// Fresh reports whether the token's session confirmed a code within auth.FreshWindow.
func (s *Service) Fresh(ctx context.Context, t auth.Token) (bool, error) {
	if t.Session == "" {
		return false, nil
	}
	var fresh bool
	err := s.pool.QueryRow(ctx, `
		SELECT EXISTS (SELECT 1 FROM fresh_sign_ins f JOIN users u ON u.id = f.user_id
		               WHERE u.privy_user_id = $1 AND f.session = $2 AND f.confirmed_at > $3)`,
		t.User, t.Session, s.now().Add(-auth.FreshWindow)).Scan(&fresh)
	if err != nil {
		return false, fmt.Errorf("read confirmed code: %w", err)
	}
	return fresh, nil
}

var codePattern = regexp.MustCompile(`^[0-9]{6}$`)

// hash is sha256 of the row id and the code. ponytail: someone who reads the table can try a million codes against
// it at once; a server-only HMAC key would stop that, worth it if codes ever live longer than CodeTTL.
func hash(id, code string) []byte {
	h := sha256.Sum256([]byte(id + ":" + code))
	return h[:]
}
