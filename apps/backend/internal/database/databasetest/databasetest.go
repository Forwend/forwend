package databasetest

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"sync"
	"testing"

	"github.com/forwend/forwend/apps/backend/internal/config"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// New creates an empty database, dropped when the test ends. It strips DATABASE_URL's pool_ parameters: plain pgx
// connections would send them to Postgres as settings.
func New(t *testing.T) string {
	t.Helper()
	u, err := create("")
	if err != nil {
		t.Fatal(err)
	}
	return cleanup(t, u)
}

// Migrated is New with every migration applied. It copies a template database migrated once per set of migration
// files, which takes a fraction of migrating each test's database. migrate is database.Migrate: its own tests use this
// package, so it can't import database.
func Migrated(t *testing.T, migrate func(context.Context, string) error) string {
	t.Helper()
	name, err := tmpl.get(migrate, false)
	if err != nil {
		t.Fatal(err)
	}
	u, err := create(name)
	var pgErr *pgconn.PgError
	// Another checkout with other migrations replaced the template meanwhile: build ours again.
	if errors.As(err, &pgErr) && pgErr.Code == "3D000" {
		if name, err = tmpl.get(migrate, true); err == nil {
			u, err = create(name)
		}
	}
	if err != nil {
		t.Fatal(err)
	}
	return cleanup(t, u)
}

func cleanup(t *testing.T, u *url.URL) string {
	t.Cleanup(func() {
		if err := exec(context.Background(), "DROP DATABASE "+strings.TrimPrefix(u.Path, "/")+" WITH (FORCE)"); err != nil {
			t.Error(err)
		}
	})
	return u.String()
}

// create makes a database, copied from the from database unless it is "", and returns its URL.
func create(from string) (*url.URL, error) {
	suffix := make([]byte, 6)
	_, _ = rand.Read(suffix)
	name := "test_" + hex.EncodeToString(suffix)
	query := "CREATE DATABASE " + name
	if from != "" {
		query += " TEMPLATE " + from
	}
	if err := exec(context.Background(), query); err != nil {
		return nil, err
	}
	u, err := admin()
	if err != nil {
		return nil, err
	}
	u.Path = "/" + name
	return u, nil
}

// admin is DATABASE_URL without its pool_ parameters.
func admin() (*url.URL, error) {
	raw, err := config.LoadDatabaseURL()
	if err != nil {
		return nil, err
	}
	u, err := url.Parse(raw)
	if err != nil {
		return nil, err
	}
	q := u.Query()
	for k := range q {
		if strings.HasPrefix(k, "pool_") {
			q.Del(k)
		}
	}
	u.RawQuery = q.Encode()
	return u, nil
}

func exec(ctx context.Context, query string, args ...any) error {
	u, err := admin()
	if err != nil {
		return err
	}
	conn, err := pgx.Connect(ctx, u.String())
	if err != nil {
		return fmt.Errorf("connect to Postgres (locally: pnpm --filter @forwend/backend postgres:up): %w", err)
	}
	defer conn.Close(ctx)
	_, err = conn.Exec(ctx, query, args...)
	return err
}

const templatePrefix = "test_template_"

// The advisory lock key for building the template: one process builds it while the others wait, then find it.
const templateLock = 7_461_302_115

var tmpl template

type template struct {
	sync.Mutex
	name string
}

// get returns the migrated template's name, building it when this process has none yet or rebuild is set.
func (m *template) get(migrate func(context.Context, string) error, rebuild bool) (string, error) {
	m.Lock()
	defer m.Unlock()
	if m.name != "" && !rebuild {
		return m.name, nil
	}
	name, err := build(migrate)
	if err != nil {
		return "", fmt.Errorf("migrated template database: %w", err)
	}
	m.name = name
	return name, nil
}

func build(migrate func(context.Context, string) error) (string, error) {
	ctx := context.Background()
	sum, err := migrationsSum()
	if err != nil {
		return "", err
	}
	name := templatePrefix + sum[:16]
	u, err := admin()
	if err != nil {
		return "", err
	}
	conn, err := pgx.Connect(ctx, u.String())
	if err != nil {
		return "", fmt.Errorf("connect to Postgres (locally: pnpm --filter @forwend/backend postgres:up): %w", err)
	}
	defer conn.Close(ctx)
	if _, err := conn.Exec(ctx, "SELECT pg_advisory_lock($1)", templateLock); err != nil {
		return "", err
	}
	defer func() { _, _ = conn.Exec(ctx, "SELECT pg_advisory_unlock($1)", templateLock) }()
	var exists bool
	if err := conn.QueryRow(ctx, "SELECT EXISTS (SELECT 1 FROM pg_database WHERE datname = $1)", name).
		Scan(&exists); err != nil {
		return "", err
	}
	if exists {
		return name, nil
	}
	// Templates of older migration sets, and a build a crash left half done, would otherwise pile up.
	rows, err := conn.Query(ctx, "SELECT datname FROM pg_database WHERE starts_with(datname, $1)", templatePrefix)
	if err != nil {
		return "", err
	}
	stale, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		return "", err
	}
	for _, old := range stale {
		if _, err := conn.Exec(ctx, "DROP DATABASE "+old+" WITH (FORCE)"); err != nil {
			return "", err
		}
	}
	// Built under another name and renamed when done, so a crash never leaves a half-migrated template in use.
	building := name + "_building"
	if _, err := conn.Exec(ctx, "CREATE DATABASE "+building); err != nil {
		return "", err
	}
	u.Path = "/" + building
	if err := migrate(ctx, u.String()); err != nil {
		return "", err
	}
	for _, query := range []string{
		"SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '" + building + "'",
		"ALTER DATABASE " + building + " RENAME TO " + name,
		// Nobody connects to it, so copying it never waits on a session.
		"ALTER DATABASE " + name + " WITH ALLOW_CONNECTIONS false",
	} {
		if _, err := conn.Exec(ctx, query); err != nil {
			return "", err
		}
	}
	return name, nil
}

// migrationsSum names the template by the migration files, so a changed or added one builds a new template.
func migrationsSum() (string, error) {
	_, file, _, _ := runtime.Caller(0)
	dir := filepath.Join(filepath.Dir(file), "..", "migrations")
	names, err := filepath.Glob(filepath.Join(dir, "*.sql"))
	if err != nil || len(names) == 0 {
		return "", fmt.Errorf("read migrations in %s: %v", dir, err)
	}
	sort.Strings(names)
	h := sha256.New()
	for _, name := range names {
		body, err := os.ReadFile(name)
		if err != nil {
			return "", err
		}
		h.Write([]byte(filepath.Base(name)))
		h.Write(body)
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}
