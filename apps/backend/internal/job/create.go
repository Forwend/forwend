package job

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/ensp1re/forwend/apps/backend/internal/invoice"
	"github.com/ensp1re/forwend/apps/backend/internal/profile"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// usdCents is a USD amount with at most 2 decimals and at most 10 whole digits, so a job's total fits an int64.
var usdCents = regexp.MustCompile(`^([0-9]{1,10})(?:\.([0-9]{1,2}))?$`)

// check returns the request's payments in cents, or what breaks a rule.
func (r Request) check() ([]int64, error) {
	for _, f := range []struct {
		name, value string
		max         int
		lines       bool
	}{{"title", r.Title, MaxTitle, false}, {"scope", r.Scope, MaxScope, true}} {
		if !utf8.ValidString(f.value) || utf8.RuneCountInString(f.value) > f.max || !profile.PlainText(f.value, f.lines) {
			return nil, fmt.Errorf("%w: %s must be at most %d characters of plain text", ErrInvalid, f.name, f.max)
		}
	}
	if r.Title == "" {
		return nil, fmt.Errorf("%w: title is required", ErrInvalid)
	}
	if r.Client.Name == "" || r.Client.Email == "" {
		return nil, fmt.Errorf("%w: client.name and client.email are required: payments are billed there", ErrInvalid)
	}
	if p := r.Client.Problem("client."); p != "" {
		return nil, fmt.Errorf("%w: %s", ErrInvalid, p)
	}
	if len(r.Payments) == 0 || len(r.Payments) > MaxPayments {
		return nil, fmt.Errorf("%w: payments must list 1 to %d payments", ErrInvalid, MaxPayments)
	}
	return checkPayments(r.Payments)
}

// checkPayments returns the payments in cents, or what breaks a rule: a quote's schedule or a scope change.
func checkPayments(payments []PaymentRequest) ([]int64, error) {
	cents := make([]int64, len(payments))
	for i, p := range payments {
		if p.Title == "" || !utf8.ValidString(p.Title) || utf8.RuneCountInString(p.Title) > MaxPaymentTitle ||
			!profile.PlainText(p.Title, false) {
			return nil, fmt.Errorf("%w: payments need a title of at most %d characters of plain text", ErrInvalid,
				MaxPaymentTitle)
		}
		m := usdCents.FindStringSubmatch(p.AmountUSD)
		if m != nil {
			cents[i], _ = strconv.ParseInt(m[1]+m[2]+strings.Repeat("0", 2-len(m[2])), 10, 64)
		}
		if cents[i] == 0 {
			return nil, fmt.Errorf("%w: payments need an amountUsd like 300.00, above 0, with at most 2 decimals",
				ErrInvalid)
		}
		if p.DueDays < 0 || p.DueDays > MaxDueDays {
			return nil, fmt.Errorf("%w: payments need dueDays from 0 to %d", ErrInvalid, MaxDueDays)
		}
		if p.OnAccept && i > 0 {
			return nil, fmt.Errorf("%w: payments: only the first can be due on acceptance", ErrInvalid)
		}
	}
	return cents, nil
}

// Create saves a job once per (profile, idempotency key): created is false when the same request was already made, and
// the stored job is returned. It copies the profile's billing details as the issuer. The caller has checked that the
// user owns the profile.
func (s *Service) Create(ctx context.Context, profileID, key string, r Request) (j Job, created bool, err error) {
	cents, err := r.check()
	if err != nil {
		return Job{}, false, err
	}
	// The checked values in a fixed format, amounts in cents so "300" and "300.00" match; the body is never stored.
	b := fmt.Appendf(nil, "%q|%q|%q|%q|%q|%q|%q", r.Title, r.Scope, r.Client.Name, r.Client.Email, r.Client.Address,
		r.Client.Country, r.Client.TaxID)
	for i, p := range r.Payments {
		b = fmt.Appendf(b, "|%q|%d|%d|%t", p.Title, cents[i], p.DueDays, p.OnAccept)
	}
	hash := sha256.Sum256(b)
	if j, err := s.replay(ctx, profileID, key, hash[:]); !errors.Is(err, ErrNotFound) {
		return j, false, err
	}
	token := make([]byte, 32)
	if _, err := rand.Read(token); err != nil {
		return Job{}, false, fmt.Errorf("make job token: %w", err)
	}

	var id string
	err = pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		// The profile row lock makes concurrent creates count one after another.
		var jobs int
		if err := tx.QueryRow(ctx, `SELECT (SELECT count(*) FROM jobs WHERE profile_id = $1) FROM profiles
			WHERE id = $1 FOR UPDATE`, profileID).Scan(&jobs); err != nil {
			return fmt.Errorf("lock profile: %w", err)
		}
		if jobs >= MaxJobs {
			return fmt.Errorf("%w: a profile has at most %d jobs", ErrInvalid, MaxJobs)
		}
		c := r.Client
		err := tx.QueryRow(ctx, `INSERT INTO jobs (profile_id, token, idempotency_key, request_hash, title, scope,
			    client_name, client_email, client_address, client_country, client_tax_id, issuer_name, issuer_address,
			    issuer_country, issuer_tax_id, issuer_email)
			SELECT $1, $2, $3, $4, $5, NULLIF($6, ''), $7, $8, NULLIF($9, ''), NULLIF($10, ''), NULLIF($11, ''), b.name,
			    b.address, b.country, b.tax_id, b.contact_email
			FROM profile_billing_details b WHERE b.profile_id = $1 RETURNING id::text`,
			profileID, hex.EncodeToString(token), key, hash[:], r.Title, r.Scope, c.Name, c.Email, c.Address, c.Country,
			c.TaxID).Scan(&id)
		if errors.Is(err, pgx.ErrNoRows) {
			return invoice.ErrBillingDetailsRequired
		} else if err != nil {
			return err
		}
		for i, p := range r.Payments {
			if _, err := tx.Exec(ctx, `INSERT INTO job_payments (job_id, position, title, amount_cents, due_days,
				on_accept) VALUES ($1, $2, $3, $4, $5, $6)`, id, i+1, p.Title, cents[i], p.DueDays, p.OnAccept); err != nil {
				return fmt.Errorf("insert job payment: %w", err)
			}
		}
		return nil
	})
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.ConstraintName == "jobs_profile_id_idempotency_key_key" {
		// A concurrent request with the same key won the insert.
		j, err := s.replay(ctx, profileID, key, hash[:])
		return j, false, err
	}
	if err != nil {
		if errors.Is(err, ErrInvalid) || errors.Is(err, invoice.ErrBillingDetailsRequired) {
			return Job{}, false, err
		}
		return Job{}, false, fmt.Errorf("insert job: %w", err)
	}
	j, err = s.Get(ctx, profileID, id)
	return j, err == nil, err
}

// replay returns the job made earlier with this key: ErrNotFound if none, ErrConflict if the request differed.
func (s *Service) replay(ctx context.Context, profileID, key string, hash []byte) (Job, error) {
	var id string
	var stored []byte
	err := s.pool.QueryRow(ctx, `SELECT id::text, request_hash FROM jobs WHERE profile_id = $1 AND idempotency_key = $2`,
		profileID, key).Scan(&id, &stored)
	if errors.Is(err, pgx.ErrNoRows) {
		return Job{}, ErrNotFound
	} else if err != nil {
		return Job{}, fmt.Errorf("read job: %w", err)
	}
	if !bytes.Equal(stored, hash) {
		return Job{}, ErrConflict
	}
	return s.Get(ctx, profileID, id)
}
