package apikey

import (
	"context"
	"errors"
	"fmt"

	"github.com/ensp1re/forwend/apps/backend/internal/auth"
	"github.com/jackc/pgx/v5"
)

// Caller is who a request's key acts for.
type Caller struct {
	KeyID, ProfileID string
	Access           auth.Access
}

// Authenticate finds the working key whose text this is (R-144); its last use is kept to the minute.
func (s *Service) Authenticate(ctx context.Context, text string) (Caller, error) {
	hash, ok := hashOf(text)
	if !ok {
		return Caller{}, ErrUnknownKey
	}
	var c Caller
	var store string
	var scopes []string
	var stale bool
	err := s.pool.QueryRow(ctx, `SELECT id::text, profile_id::text, coalesce(store_id::text, ''), scopes,
		    last_used_at IS NULL OR last_used_at < now() - interval '1 minute'
		FROM api_keys WHERE secret_hash = $1 AND `+working, hash).Scan(&c.KeyID, &c.ProfileID, &store, &scopes, &stale)
	if errors.Is(err, pgx.ErrNoRows) {
		return Caller{}, ErrUnknownKey
	}
	if err != nil {
		return Caller{}, fmt.Errorf("read API key: %w", err)
	}
	if stale {
		if _, err := s.pool.Exec(ctx, "UPDATE api_keys SET last_used_at = now() WHERE id = $1", c.KeyID); err != nil {
			return Caller{}, fmt.Errorf("keep API key use: %w", err)
		}
	}
	c.Access.Scopes = []auth.Permission{}
	for _, p := range scopes {
		c.Access.Scopes = append(c.Access.Scopes, auth.Permission(p))
	}
	if store != "" {
		c.Access.Stores = []string{store}
	}
	return c, nil
}
