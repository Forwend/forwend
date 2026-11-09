package databasetest

import (
	"context"
	"strings"
	"sync"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Plans runs run with a pool to url that records the queries sent through it, then returns their plans read with
// sequential scans off, joined. A test checks that a query can use its index on tables too small for the planner to
// choose it.
func Plans(t *testing.T, url string, run func(*pgxpool.Pool)) string {
	t.Helper()
	ctx := context.Background()
	config, err := pgxpool.ParseConfig(url)
	if err != nil {
		t.Fatal(err)
	}
	sent := &recorder{}
	config.ConnConfig.Tracer = sent
	pool, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		t.Fatal(err)
	}
	run(pool)
	pool.Close()
	conn, err := pgx.Connect(ctx, config.ConnConfig.ConnString())
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close(ctx)
	if _, err := conn.Exec(ctx, "SET enable_seqscan = off"); err != nil {
		t.Fatal(err)
	}
	var plans []string
	for _, q := range sent.queries {
		verb, _, _ := strings.Cut(strings.ToUpper(strings.TrimSpace(q.sql)), " ")
		if verb != "SELECT" && verb != "WITH" && verb != "UPDATE" && verb != "INSERT" && verb != "DELETE" {
			continue
		}
		rows, err := conn.Query(ctx, "EXPLAIN "+q.sql, q.args...)
		if err != nil {
			t.Fatal(err)
		}
		lines, err := pgx.CollectRows(rows, pgx.RowTo[string])
		if err != nil {
			t.Fatal(err)
		}
		plans = append(plans, q.sql+"\n"+strings.Join(lines, "\n"))
	}
	return strings.Join(plans, "\n\n")
}

type query struct {
	sql  string
	args []any
}

type recorder struct {
	mu      sync.Mutex
	queries []query
}

func (r *recorder) TraceQueryStart(ctx context.Context, _ *pgx.Conn, data pgx.TraceQueryStartData) context.Context {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.queries = append(r.queries, query{data.SQL, data.Args})
	return ctx
}

func (*recorder) TraceQueryEnd(context.Context, *pgx.Conn, pgx.TraceQueryEndData) {}
