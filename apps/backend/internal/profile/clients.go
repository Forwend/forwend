package profile

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"net/mail"
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/forwend/forwend/apps/backend/internal/search"
	"github.com/jackc/pgx/v5"
)

// Longest client details, in characters (R-86), the same as an invoice's client block.
const (
	MaxClientName    = 200
	MaxClientEmail   = 254 // the longest address SMTP carries (RFC 5321)
	MaxClientAddress = 500
	MaxClientTaxID   = 50
	// An invoice's reference has the same limit, so a client's default always fits (R-90).
	MaxClientReference = 100
)

// MaxClients is per profile; the list reads one page at a time (R-177).
const MaxClients = 1000

var ErrClientNotFound = errors.New("client not found")

// ClientDetails are what a saved client holds and an invoice copies. Only Name is required; "" means none.
type ClientDetails struct {
	Name    string
	Email   string // the billing email: where invoices go, often the client's finance team
	Address string
	Country string // ISO 3166-1 alpha-2, upper case
	TaxID   string
	// The client's PO number or reference that New invoice fills in (R-90); an invoice keeps its own copy.
	Reference string
	// New invoice starts with payment reminders on for this client (R-97); each invoice keeps its own setting.
	Reminders bool
}

type Client struct {
	ClientDetails
	ID        string
	UpdatedAt time.Time
}

// Problem names the first field given that breaks R-86's rules, or returns "". An invoice's client block uses the
// same rules with the prefix "client.", each owner wrapping the text in its own invalid-request error.
func (d ClientDetails) Problem(prefix string) string {
	for _, f := range []struct {
		name, value string
		max         int
		lines       bool
	}{
		{"name", d.Name, MaxClientName, false}, {"email", d.Email, MaxClientEmail, false},
		{"address", d.Address, MaxClientAddress, true}, {"taxId", d.TaxID, MaxClientTaxID, false},
		{"reference", d.Reference, MaxClientReference, false},
	} {
		// Postgres text can't hold a NUL byte.
		if !utf8.ValidString(f.value) || utf8.RuneCountInString(f.value) > f.max || !PlainText(f.value, f.lines) {
			return fmt.Sprintf("%s%s must be at most %d characters of plain text", prefix, f.name, f.max)
		}
	}
	if d.Email != "" {
		if a, err := mail.ParseAddress(d.Email); err != nil || a.Address != d.Email {
			return prefix + "email must be an email address like name@example.com"
		}
	}
	if d.Country != "" && !ValidCountry(d.Country) {
		return prefix + "country must be an ISO 3166-1 alpha-2 code like DE"
	}
	return ""
}

const clientColumns = `id::text, name, coalesce(email, ''), coalesce(address, ''), coalesce(country, ''),
	coalesce(tax_id, ''), coalesce(reference, ''), reminders, updated_at`

func scanClient(row pgx.CollectableRow) (Client, error) {
	var c Client
	err := row.Scan(&c.ID, &c.Name, &c.Email, &c.Address, &c.Country, &c.TaxID, &c.Reference, &c.Reminders, &c.UpdatedAt)
	return c, err
}

// checkSaved adds what a saved client needs: a name to pick it by.
func (d ClientDetails) checkSaved() error {
	if d.Name == "" {
		return fmt.Errorf("%w: name is required", ErrInvalid)
	}
	if p := d.Problem(""); p != "" {
		return fmt.Errorf("%w: %s", ErrInvalid, p)
	}
	return nil
}

// lowercaseUUID matches a client's or a store's id, so a malformed one is not found rather than a database error.
var lowercaseUUID = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)

// The callers below have checked the user's access to the profile; every query also names the profile, so a client id
// from another profile is not found.

// A page of the clients list (R-177): DefaultClientLimit when the caller names none, at most MaxClientLimit.
const (
	DefaultClientLimit = 50
	MaxClientLimit     = 100
)

type ClientPage struct {
	Clients    []Client
	NextCursor string // "" on the last page
}

// Clients lists one page by name, then id, so a page boundary never repeats or skips a client. q matches the name,
// the email or the tax ID in any letter case; the zero Query matches every client.
func (s *Service) Clients(ctx context.Context, profileID, cursor string, limit int, q search.Query) (ClientPage, error) {
	if limit < 1 || limit > MaxClientLimit {
		return ClientPage{}, fmt.Errorf("%w: limit must be 1 to %d", ErrInvalid, MaxClientLimit)
	}
	args := []any{profileID, q.Like}
	where := "profile_id = $1 AND ($2::text IS NULL OR name ILIKE $2 OR email ILIKE $2 OR tax_id ILIKE $2)"
	if cursor != "" {
		name, id, err := decodeClientCursor(cursor)
		if err != nil {
			return ClientPage{}, err
		}
		args = append(args, name, id)
		where += " AND (lower(name), id) > (lower($3), $4::uuid)"
	}
	args = append(args, limit+1)
	rows, err := s.pool.Query(ctx, `SELECT `+clientColumns+` FROM clients WHERE `+where+`
		ORDER BY lower(name), id LIMIT $`+strconv.Itoa(len(args)), args...)
	if err != nil {
		return ClientPage{}, fmt.Errorf("list clients: %w", err)
	}
	clients, err := pgx.CollectRows(rows, scanClient)
	if err != nil {
		return ClientPage{}, fmt.Errorf("list clients: %w", err)
	}
	var next string
	if len(clients) > limit {
		clients = clients[:limit]
		last := clients[limit-1]
		next = base64.RawURLEncoding.EncodeToString([]byte(last.ID + "|" + last.Name))
	}
	return ClientPage{Clients: clients, NextCursor: next}, nil
}

// A cursor is the last client's id and name; Postgres lowers the name as it sorts, so Go never has to. The id has no "|".
func decodeClientCursor(cursor string) (name, id string, err error) {
	raw, decodeErr := base64.RawURLEncoding.DecodeString(cursor)
	id, name, ok := strings.Cut(string(raw), "|")
	// Postgres text holds no invalid UTF-8 or NUL, so a cursor this API didn't return can't reach it as one.
	if decodeErr != nil || !ok || !lowercaseUUID.MatchString(id) || !utf8.ValidString(name) || strings.ContainsRune(name, 0) {
		return "", "", fmt.Errorf("%w: cursor is not one this API returned", ErrInvalid)
	}
	return name, id, nil
}

func (s *Service) Client(ctx context.Context, profileID, id string) (Client, error) {
	if !lowercaseUUID.MatchString(id) {
		return Client{}, ErrClientNotFound
	}
	rows, err := s.pool.Query(ctx, `SELECT `+clientColumns+` FROM clients WHERE profile_id = $1 AND id = $2`, profileID, id)
	if err != nil {
		return Client{}, fmt.Errorf("read client: %w", err)
	}
	c, err := pgx.CollectExactlyOneRow(rows, scanClient)
	if errors.Is(err, pgx.ErrNoRows) {
		return Client{}, ErrClientNotFound
	}
	if err != nil {
		return Client{}, fmt.Errorf("read client: %w", err)
	}
	return c, nil
}

// SaveClient upserts by the id the caller chose, so sending the same request twice saves one client. Invoices
// made earlier keep their own copy.
func (s *Service) SaveClient(ctx context.Context, profileID, id string, d ClientDetails) (Client, bool, error) {
	if err := d.checkSaved(); err != nil {
		return Client{}, false, err
	}
	if !lowercaseUUID.MatchString(id) {
		return Client{}, false, fmt.Errorf("%w: clientId must be a UUID", ErrInvalid)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return Client{}, false, fmt.Errorf("save client: %w", err)
	}
	defer tx.Rollback(ctx)
	// The profile row lock makes concurrent saves count one after another, so none passes the cap on a stale count.
	if _, err := tx.Exec(ctx, "SELECT 1 FROM profiles WHERE id = $1 FOR UPDATE", profileID); err != nil {
		return Client{}, false, fmt.Errorf("lock profile: %w", err)
	}
	// An id that belongs to another profile neither inserts (the conflict) nor updates (the WHERE), so no row comes back.
	var c Client
	var created bool
	err = tx.QueryRow(ctx, `
		INSERT INTO clients (id, profile_id, name, email, address, country, tax_id, reference, reminders)
		SELECT $2, $1, $3, NULLIF($4, ''), NULLIF($5, ''), NULLIF($6, ''), NULLIF($7, ''), NULLIF($9, ''), $10
		WHERE (SELECT count(*) FROM clients WHERE profile_id = $1) < $8
		   OR EXISTS (SELECT 1 FROM clients WHERE id = $2)
		ON CONFLICT (id) DO UPDATE SET name = excluded.name, email = excluded.email, address = excluded.address,
		    country = excluded.country, tax_id = excluded.tax_id, reference = excluded.reference,
		    reminders = excluded.reminders, updated_at = now()
		    WHERE clients.profile_id = excluded.profile_id
		RETURNING `+clientColumns+`, xmax = 0`, profileID, id, d.Name, d.Email, d.Address, d.Country, d.TaxID, MaxClients,
		d.Reference, d.Reminders).
		Scan(&c.ID, &c.Name, &c.Email, &c.Address, &c.Country, &c.TaxID, &c.Reference, &c.Reminders, &c.UpdatedAt, &created)
	if errors.Is(err, pgx.ErrNoRows) {
		var taken bool
		if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM clients WHERE id = $1)`, id).Scan(&taken); err != nil {
			return Client{}, false, fmt.Errorf("save client: %w", err)
		}
		if taken {
			return Client{}, false, ErrClientNotFound
		}
		return Client{}, false, fmt.Errorf("%w: a profile has at most %d clients", ErrInvalid, MaxClients)
	}
	if err != nil {
		return Client{}, false, fmt.Errorf("save client: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return Client{}, false, fmt.Errorf("save client: %w", err)
	}
	return c, created, nil
}

// Invoices made earlier keep their own copy.
func (s *Service) DeleteClient(ctx context.Context, profileID, id string) error {
	if !lowercaseUUID.MatchString(id) {
		return ErrClientNotFound
	}
	tag, err := s.pool.Exec(ctx, `DELETE FROM clients WHERE profile_id = $1 AND id = $2`, profileID, id)
	if err != nil {
		return fmt.Errorf("delete client: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrClientNotFound
	}
	return nil
}
