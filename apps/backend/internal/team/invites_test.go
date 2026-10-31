package team

import (
	"context"
	"errors"
	"testing"

	"github.com/forwend/forwend/apps/backend/internal/auth"
	"github.com/forwend/forwend/apps/backend/internal/database"
	"github.com/forwend/forwend/apps/backend/internal/database/databasetest"
)

// R-139, D-93: the inviter is checked again under the profile lock, by the permission map, so a member who lost the
// team permission after the request's access check sends no invite.
func TestInviteChecksTheInviterAgain(t *testing.T) {
	ctx := context.Background()
	url := databasetest.Migrated(t, database.Migrate)
	pool, err := database.Open(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	var shop string
	if err := pool.QueryRow(ctx, `
		WITH u AS (INSERT INTO users (privy_user_id) VALUES ('did:privy:owner'), ('did:privy:dev') RETURNING id, privy_user_id)
		INSERT INTO profiles (user_id, kind, name) SELECT id, 'merchant', 'Shop' FROM u
		WHERE privy_user_id = 'did:privy:owner' RETURNING id::text`).Scan(&shop); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO profile_members (profile_id, user_id, role)
		SELECT $1, id, 'developer' FROM users WHERE privy_user_id = 'did:privy:dev'`, shop); err != nil {
		t.Fatal(err)
	}
	s := NewService(pool, nil)
	admin := Grant{Role: string(auth.Admin)}
	for user, want := range map[string]error{"did:privy:dev": auth.ErrForbidden, "did:privy:stranger": auth.ErrForbidden,
		"did:privy:owner": nil} {
		if _, err := s.Invite(ctx, shop, user, user[len("did:privy:"):]+"@example.com", admin); !errors.Is(err, want) {
			t.Errorf("%s invites: %v, want %v", user, err, want)
		}
	}
	if _, err := pool.Exec(ctx, "UPDATE profile_members SET role = 'admin'"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Invite(ctx, shop, "did:privy:dev", "dev2@example.com", admin); err != nil {
		t.Errorf("an Admin invites: %v", err)
	}
}
