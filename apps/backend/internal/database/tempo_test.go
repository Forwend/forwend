package database

import (
	"context"
	"database/sql"
	"io/fs"
	"testing"

	"github.com/forwend/forwend/apps/backend/internal/database/databasetest"
	"github.com/pressly/goose/v3"
)

func TestTempoDefaultForExistingProfiles(t *testing.T) {
	for _, enabled := range []bool{false, true} {
		name := "previously disabled"
		if enabled {
			name = "previously enabled"
		}
		t.Run(name, func(t *testing.T) {
			ctx := context.Background()
			conn, err := sql.Open("pgx", databasetest.New(t))
			if err != nil {
				t.Fatal(err)
			}
			defer conn.Close()
			files, err := fs.Sub(migrations, "migrations")
			if err != nil {
				t.Fatal(err)
			}
			provider, err := goose.NewProvider(goose.DialectPostgres, conn, files)
			if err != nil {
				t.Fatal(err)
			}
			if _, err := provider.UpTo(ctx, 73); err != nil {
				t.Fatal(err)
			}
			exec := func(q string, args ...any) {
				t.Helper()
				if _, err := conn.ExecContext(ctx, q, args...); err != nil {
					t.Fatal(err)
				}
			}
			exec(`UPDATE chains SET enabled = $1 WHERE chain_id = 42431`, enabled)
			exec(`UPDATE tokens SET enabled = $1 WHERE chain_id = 42431`, enabled)
			exec(`WITH u AS (INSERT INTO users (privy_user_id) VALUES ('did:privy:tempo') RETURNING id)
    INSERT INTO profiles (user_id, kind) SELECT id, unnest(ARRAY['personal', 'freelancer']) FROM u`)
			exec(`INSERT INTO profile_tokens_off (profile_id, chain_id, token_contract)
    SELECT id, 42431, '0x20c0000000000000000000006a37da5c996874be' FROM profiles WHERE kind = 'freelancer'`)
			if _, err := provider.Up(ctx); err != nil {
				t.Fatal(err)
			}
			check := func(kind string, want bool) {
				t.Helper()
				var off bool
				err := conn.QueryRowContext(ctx, `SELECT EXISTS (
     SELECT 1 FROM profile_tokens_off o JOIN profiles p ON p.id = o.profile_id
     WHERE p.kind = $1 AND o.chain_id = 42431)`, kind).Scan(&off)
				if err != nil || off != want {
					t.Fatalf("%s off: %v, %v; want %v", kind, off, err, want)
				}
			}
			check("personal", !enabled)
			check("freelancer", true)
			exec(`INSERT INTO profiles (user_id, kind) SELECT id, 'merchant' FROM users`)
			check("merchant", true)
		})
	}
}
