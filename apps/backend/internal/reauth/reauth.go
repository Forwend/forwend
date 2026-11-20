// Package reauth emails a 6-digit code that makes the Privy session fresh; Privy's own re-login can't prove one.
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
	"slices"
	"strings"
	"time"

	"github.com/forwend/forwend/apps/backend/internal/auth"
	"github.com/forwend/forwend/apps/backend/internal/email"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	CodeTTL     = 10 * time.Minute
	MaxAttempts = 5
	ResendAfter = 30 * time.Second // per session
	MaxPerHour  = 10               // unconfirmed codes per user
)

var (
	ErrNoSession = errors.New("the token has no session")
	ErrTooSoon   = errors.New("a code was sent a moment ago")
	ErrTooMany   = errors.New("too many codes this hour")
	ErrWrongCode = errors.New("wrong or expired code") // also used up, or never sent for this session
	ErrNoEmail   = errors.New("email is not configured")
	ErrNoAddress = errors.New("the account has no email")
	ErrNoTwoStep = errors.New("two-step verification is not set up")
)

type Mailer func(code string) (email.Message, error)

type Service struct {
	pool    *pgxpool.Pool
	sender  email.Sender // nil without an email key
	mail    Mailer
	perHour int
}

// NewService: perHour 0 means MaxPerHour.
func NewService(pool *pgxpool.Pool, sender email.Sender, mail Mailer, perHour int) *Service {
	if perHour == 0 {
		perHour = MaxPerHour
	}
	return &Service{pool: pool, sender: sender, mail: mail, perHour: perHour}
}

// Send uses the login email stored at sign-up, never Privy's current one: a stolen session can link its own there.
func (s *Service) Send(ctx context.Context, t auth.Token) (wait time.Duration, err error) {
	if t.Session == "" {
		return 0, ErrNoSession
	}
	if s.sender == nil {
		return 0, ErrNoEmail
	}
	now := time.Now()
	// The user's row lock makes the limits and the new code one step, so concurrent requests send one email.
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return 0, fmt.Errorf("begin: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	var user, address string
	if err := tx.QueryRow(ctx, "SELECT id::text, coalesce(login_email, '') FROM users WHERE privy_user_id = $1 FOR UPDATE",
		t.User).Scan(&user, &address); err != nil {
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
	// The hourly cap counts only unconfirmed codes, so an owner who confirms isn't stopped.
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
	// The id salts the hash, so the hash is written once the id is known.
	var id string
	err = tx.QueryRow(ctx, `INSERT INTO fresh_sign_ins (user_id, session, code_hash, created_at, expires_at)
		VALUES ($1, $2, '\x', $3, $4) RETURNING id::text`, user, t.Session, now, now.Add(CodeTTL)).Scan(&id)
	if err != nil {
		return 0, fmt.Errorf("save code: %w", err)
	}
	if _, err := tx.Exec(ctx, "UPDATE fresh_sign_ins SET code_hash = $2 WHERE id = $1", id, hash(id, code)); err != nil {
		return 0, fmt.Errorf("save code: %w", err)
	}
	// Commit only after the email went out, and never cancel it midway: every code in the inbox must count.
	stay := context.WithoutCancel(ctx)
	m, err := s.mail(code)
	if err == nil {
		m.To, m.Key = address, "fresh-sign-in-"+id
		err = s.sender.Send(stay, m)
	}
	if err != nil {
		return 0, fmt.Errorf("email code: %w", err)
	}
	if err := tx.Commit(stay); err != nil {
		return 0, fmt.Errorf("commit: %w", err)
	}
	return ResendAfter, nil
}

func (s *Service) Verify(ctx context.Context, t auth.Token, code string) error {
	if t.Session == "" {
		return ErrNoSession
	}
	if !codePattern.MatchString(code) { // no try is used up
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
	if confirmed != nil || attempts >= MaxAttempts || !time.Now().Before(expires) {
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
	if _, err := tx.Exec(ctx, "UPDATE fresh_sign_ins SET confirmed_at = $2 WHERE id = $1", id, time.Now()); err != nil {
		return fmt.Errorf("confirm code: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit: %w", err)
	}
	return nil
}

type Stored struct {
	LoginEmail string   // "" when none
	TwoStep    []string // as privy.SignInTimes names them
}

func (s *Service) Fresh(ctx context.Context, t auth.Token) (fresh bool, user Stored, err error) {
	err = s.pool.QueryRow(ctx, `
		SELECT coalesce(u.login_email, ''), u.two_step_methods, $2 <> '' AND EXISTS (
		    SELECT 1 FROM fresh_sign_ins f WHERE f.user_id = u.id AND f.session = $2 AND f.confirmed_at > $3)
		FROM users u WHERE u.privy_user_id = $1`, t.User, t.Session, time.Now().Add(-auth.FreshWindow)).
		Scan(&user.LoginEmail, &user.TwoStep, &fresh)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, Stored{}, nil
	} else if err != nil {
		return false, Stored{}, fmt.Errorf("read confirmed code: %w", err)
	}
	return fresh, user, nil
}

const twoStepRereads = 3

var TwoStepWait = 700 * time.Millisecond

// RecordTwoStep rereads because Privy can briefly answer with the methods from before a change.
func (s *Service) RecordTwoStep(ctx context.Context, privyUserID string, want []string,
	read func(context.Context) ([]string, error)) error {
	methods, err := read(ctx)
	for try := 0; err == nil && !holds(methods, want) && try < twoStepRereads; try++ {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(TwoStepWait):
		}
		methods, err = read(ctx)
	}
	if err != nil {
		return err
	}
	if len(methods) == 0 || !holds(methods, want) {
		return ErrNoTwoStep
	}
	if _, err := s.pool.Exec(ctx, "UPDATE users SET two_step_methods = $2 WHERE privy_user_id = $1", privyUserID,
		methods); err != nil {
		return fmt.Errorf("record two-step: %w", err)
	}
	return nil
}

func holds(methods, types []string) bool {
	for _, t := range types {
		if !slices.ContainsFunc(methods, func(m string) bool { return strings.HasPrefix(m, t+":") }) {
			return false
		}
	}
	return true
}

var codePattern = regexp.MustCompile(`^[0-9]{6}$`)

// ponytail: a table reader can try all million codes per row; a server-side HMAC key fixes that if codes live longer.
func hash(id, code string) []byte {
	h := sha256.Sum256([]byte(id + ":" + code))
	return h[:]
}
