package webhook

import (
	"context"
	"errors"
	"fmt"
	"regexp"
	"slices"
	"strings"
	"unicode/utf8"

	"github.com/forwend/forwend/apps/backend/internal/auth"
	"github.com/forwend/forwend/apps/backend/internal/profile"
	"github.com/jackc/pgx/v5"
)

// MaxDescription is the longest description an endpoint takes.
const MaxDescription = 200

var lowercaseUUID = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)

const endpointColumns = `id::text, coalesce(store_id::text, ''), url, description, events, enabled, livemode, created_at,
	updated_at`

func scanEndpoint(row pgx.CollectableRow) (Endpoint, error) {
	var e Endpoint
	err := row.Scan(&e.ID, &e.StoreID, &e.URL, &e.Description, &e.Events, &e.Enabled, &e.Livemode, &e.CreatedAt,
		&e.UpdatedAt)
	return e, err
}

// MaxEndpoints is a profile's most webhook endpoints.
const MaxEndpoints = 16

// Save creates the endpoint with the id the caller picks, with its first secret, or replaces every field of the
// profile's endpoint with that id. created is true for a new one. The caller has checked the user's access to the
// profile and the fresh sign-in (D-63); Save checks the access again as it writes.
func (s *Service) Save(ctx context.Context, profileID, user, id string, d Details) (e Endpoint, created bool,
	err error) {
	if s.key == nil {
		return Endpoint{}, false, ErrNotConfigured
	}
	if !lowercaseUUID.MatchString(id) {
		return Endpoint{}, false, fmt.Errorf("%w: endpointId must be a lowercase UUID", ErrInvalid)
	}
	if err := checkURL(d.URL); err != nil {
		return Endpoint{}, false, err
	}
	d.Description = strings.TrimSpace(d.Description)
	if !utf8.ValidString(d.Description) || utf8.RuneCountInString(d.Description) > MaxDescription ||
		!profile.PlainText(d.Description, false) {
		return Endpoint{}, false, fmt.Errorf("%w: description must be at most %d characters of plain text", ErrInvalid,
			MaxDescription)
	}
	invalid := len(d.Events) == 0
	for _, t := range d.Events {
		invalid = invalid || !slices.Contains(EventTypes, t)
	}
	if invalid {
		return Endpoint{}, false, fmt.Errorf("%w: events must be one or more of %v", ErrInvalid, EventTypes)
	}
	// Each once, in EventTypes' order.
	d.Events = slices.DeleteFunc(slices.Clone(EventTypes), func(t string) bool { return !slices.Contains(d.Events, t) })
	d.StoreID = strings.ToLower(d.StoreID)

	err = pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		if err := auth.StillCan(ctx, tx, profileID, user, auth.Webhooks); err != nil {
			return err
		}
		var kind string
		var stored, known bool
		var endpoints int
		// The profile lock makes the count and the insert one step.
		if err := tx.QueryRow(ctx, `SELECT kind, EXISTS (SELECT 1 FROM stores WHERE profile_id = p.id AND id::text = $2),
			    (SELECT count(*) FROM webhook_endpoints WHERE profile_id = p.id),
			    EXISTS (SELECT 1 FROM webhook_endpoints WHERE profile_id = p.id AND id::text = $3)
			FROM profiles p WHERE id = $1 FOR UPDATE`, profileID, d.StoreID, id).Scan(&kind, &stored, &endpoints, &known); err != nil {
			return fmt.Errorf("read profile: %w", err)
		}
		switch {
		case kind == profile.Personal:
			return ErrPersonal
		case !known && endpoints >= MaxEndpoints:
			// Each event writes a delivery per endpoint inside the money transaction that raised it.
			return fmt.Errorf("%w: a profile has at most %d webhook endpoints", ErrInvalid, MaxEndpoints)
		case kind == profile.Merchant && d.StoreID != "" && !stored:
			return fmt.Errorf("%w: storeId must be one of the profile's stores", ErrInvalid)
		case kind != profile.Merchant && d.StoreID != "":
			return fmt.Errorf("%w: storeId: only a merchant profile has stores", ErrInvalid)
		}
		// A new endpoint takes the profile's mode (D-120); one of the other mode is not found, as in the list.
		rows, err := tx.Query(ctx, `INSERT INTO webhook_endpoints (id, profile_id, store_id, url, description, events,
			    enabled, livemode)
			VALUES ($1, $2, NULLIF($3, '')::uuid, $4, $5, $6, $7, (SELECT livemode FROM profiles WHERE id = $2))
			ON CONFLICT (id) DO UPDATE SET store_id = excluded.store_id, url = excluded.url,
			    description = excluded.description, events = excluded.events, enabled = excluded.enabled,
			    updated_at = now()
			WHERE webhook_endpoints.profile_id = excluded.profile_id AND webhook_endpoints.livemode = excluded.livemode
			RETURNING `+endpointColumns+`, xmax = 0`, id, profileID, d.StoreID, d.URL, d.Description, d.Events,
			d.Enabled)
		if err != nil {
			return fmt.Errorf("save webhook endpoint: %w", err)
		}
		e, err = pgx.CollectExactlyOneRow(rows, func(row pgx.CollectableRow) (Endpoint, error) {
			var e Endpoint
			err := row.Scan(&e.ID, &e.StoreID, &e.URL, &e.Description, &e.Events, &e.Enabled, &e.Livemode,
				&e.CreatedAt, &e.UpdatedAt, &created)
			return e, err
		})
		if errors.Is(err, pgx.ErrNoRows) { // another profile's id
			return ErrNotFound
		} else if err != nil {
			return fmt.Errorf("save webhook endpoint: %w", err)
		}
		if _, err := tx.Exec(ctx, `INSERT INTO webhook_delivery_profiles(profile_id) VALUES($1) ON CONFLICT DO NOTHING`, profileID); err != nil {
			return err
		}
		if created {
			return s.addSecret(ctx, tx, id)
		}
		return nil
	})
	return e, created, err
}

func (s *Service) addSecret(ctx context.Context, tx pgx.Tx, endpointID string) error {
	sealed, err := s.seal(endpointID, newSecret())
	if err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, "INSERT INTO webhook_secrets (endpoint_id, sealed) VALUES ($1, $2)", endpointID,
		sealed); err != nil {
		return fmt.Errorf("add webhook secret: %w", err)
	}
	return nil
}

// ofProfileMode keeps an endpoint, by id with its profile as $2, to the profile's mode: the dashboard reaches one mode
// at a time (R-221), and only signed-in owners and Admins manage endpoints.
const ofProfileMode = "livemode = (SELECT livemode FROM profiles WHERE id = $2)"

// List is the profile's endpoints of its mode (R-221), newest first.
func (s *Service) List(ctx context.Context, profileID string) ([]Endpoint, error) {
	rows, err := s.pool.Query(ctx, `SELECT `+endpointColumns+` FROM webhook_endpoints WHERE profile_id = $1
		AND livemode = (SELECT livemode FROM profiles WHERE id = $1) ORDER BY created_at DESC, id`, profileID)
	if err != nil {
		return nil, fmt.Errorf("list webhook endpoints: %w", err)
	}
	endpoints, err := pgx.CollectRows(rows, scanEndpoint)
	if err != nil {
		return nil, fmt.Errorf("list webhook endpoints: %w", err)
	}
	return endpoints, nil
}

// Delete removes the profile's endpoint and its secrets.
func (s *Service) Delete(ctx context.Context, profileID, id string) error {
	if !lowercaseUUID.MatchString(id) {
		return ErrNotFound
	}
	tag, err := s.pool.Exec(ctx, "DELETE FROM webhook_endpoints WHERE id = $1 AND profile_id = $2 AND "+ofProfileMode, id,
		profileID)
	if err != nil {
		return fmt.Errorf("delete webhook endpoint: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// Secrets are the endpoint's working secrets, newest first: during a rotation's overlap, the old one too.
// The caller has checked the fresh sign-in (D-63).
func (s *Service) Secrets(ctx context.Context, profileID, id string) ([]Secret, error) {
	if s.key == nil {
		return nil, ErrNotConfigured
	}
	// The dashboard reaches the profile's mode only (R-221); deliveries read every endpoint's secrets.
	if err := s.owned(ctx, profileID, id); err != nil {
		return nil, err
	}
	return s.secrets(ctx, s.pool, profileID, id)
}

type queryer interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
}

func (s *Service) secrets(ctx context.Context, q queryer, profileID, id string) ([]Secret, error) {
	rows, err := q.Query(ctx, `SELECT s.sealed, s.created_at, s.expires_at FROM webhook_secrets s
		JOIN webhook_endpoints e ON e.id = s.endpoint_id
		WHERE e.id = $1 AND e.profile_id = $2 AND (s.expires_at IS NULL OR s.expires_at > now())
		ORDER BY s.id DESC`, id, profileID)
	if err != nil {
		return nil, fmt.Errorf("read webhook secrets: %w", err)
	}
	type sealedSecret struct {
		Sealed []byte
		Secret
	}
	list, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (sealedSecret, error) {
		var s sealedSecret
		err := row.Scan(&s.Sealed, &s.CreatedAt, &s.ExpiresAt)
		return s, err
	})
	if err != nil {
		return nil, fmt.Errorf("read webhook secrets: %w", err)
	}
	if len(list) == 0 {
		return nil, ErrNotFound
	}
	out := make([]Secret, len(list))
	for i, l := range list {
		if l.Secret.Text, err = s.open(id, l.Sealed); err != nil {
			return nil, err
		}
		out[i] = l.Secret
	}
	return out, nil
}

// Rotate gives the endpoint a new secret; the one it replaces keeps signing for Overlap, so a receiver can switch
// without missing an event. The answer is read in the same transaction: a key that can't open the secrets rotates
// nothing. The caller has checked the fresh sign-in (D-63); Rotate checks the access again as it writes.
func (s *Service) Rotate(ctx context.Context, profileID, user, id string) ([]Secret, error) {
	if s.key == nil {
		return nil, ErrNotConfigured
	}
	if !lowercaseUUID.MatchString(id) {
		return nil, ErrNotFound
	}
	var out []Secret
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		if err := auth.StillCan(ctx, tx, profileID, user, auth.Webhooks); err != nil {
			return err
		}
		tag, err := tx.Exec(ctx, "SELECT 1 FROM webhook_endpoints WHERE id = $1 AND profile_id = $2 AND "+ofProfileMode+
			" FOR UPDATE", id, profileID)
		if err != nil {
			return fmt.Errorf("lock webhook endpoint: %w", err)
		}
		if tag.RowsAffected() == 0 {
			return ErrNotFound
		}
		if _, err := tx.Exec(ctx, `UPDATE webhook_secrets SET expires_at = now() + $2 * interval '1 second'
			WHERE endpoint_id = $1 AND expires_at IS NULL`, id, int64(Overlap.Seconds())); err != nil {
			return fmt.Errorf("rotate webhook secret: %w", err)
		}
		if err := s.addSecret(ctx, tx, id); err != nil {
			return err
		}
		out, err = s.secrets(ctx, tx, profileID, id)
		return err
	})
	return out, err
}
