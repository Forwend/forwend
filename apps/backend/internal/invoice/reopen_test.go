package invoice

import (
	"context"
	"errors"
	"fmt"
	"math/big"
	"testing"
	"time"

	"github.com/forwend/forwend/apps/backend/internal/ledger"
	"github.com/forwend/forwend/apps/backend/internal/ledger/ledgertest"
	"github.com/jackc/pgx/v5/pgxpool"
)

// closedPartly makes invoice n, which closed with 2 of 5 USDC paid; its receiver was deployed at deployedAt, 0 if not.
func closedPartly(t *testing.T, pool *pgxpool.Pool, s *Service, profile string, n int, deployedAt uint64) Invoice {
	t.Helper()
	ctx := context.Background()
	inv, _, err := s.Create(ctx, profile, fmt.Sprint("key-", n),
		Request{ChainID: 84532, Token: usdc, Amount: "5000000"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO chain_transfers (chain_id, chain_family, token_contract, invoice_id, tx_hash,
		    log_index, block_hash, block_number, block_time, from_address, to_address, amount, status)
		VALUES (84532, 'evm', $1, $2, $3, 0, $3, 1, $4, '0x00000000000000000000000000000000000000ff', $5, 2000000, 'confirmed')`,
		usdc, inv.ID, fmt.Sprintf("0x%064x", n), inv.ExpiresAt.Unix()-60, inv.ReceiveAddress); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `UPDATE chain_cursors SET last_scanned_block = 10, last_finalized_block = 10,
		last_finalized_time = $1`, inv.ExpiresAt.Unix()+60); err != nil {
		t.Fatal(err)
	}
	if err := ledger.NewService(pool, func(context.Context, uint64, string, string) (*big.Int, uint64, error) {
		return big.NewInt(2000000), 10, nil
	}, func(context.Context, uint64, string, string) (uint64, error) {
		return deployedAt, nil
	}).Process(ctx, inv.ID); err != nil {
		t.Fatal(err)
	}
	ledgertest.Checkpoint(t, pool, inv.ID, 10, inv.ExpiresAt.Unix()+60, "2000000")
	return inv
}

// R-130: reopening needs ReopenMargin before the settle deadline and no refund under way; the reopened close is that
// margin before the deadline.
func TestReopenNeedsADayBeforeTheSettleDeadline(t *testing.T) {
	pool, profile := open(t)
	ctx := context.Background()
	s := NewService(pool)
	inv := closedPartly(t, pool, s, profile, 1, 0)
	until := inv.SettleDeadline.Add(-ReopenMargin)
	s.now = func() time.Time { return until }
	if _, err := s.Reopen(ctx, profile, inv.ID); !errors.Is(err, ErrNotReopenable) {
		t.Fatalf("at the last moment: %v, want ErrNotReopenable", err)
	}
	s.now = func() time.Time { return until.Add(-time.Second) }
	refund := func(status string) {
		if _, err := pool.Exec(ctx, "UPDATE invoices SET refund_status = $2 WHERE id = $1", inv.ID, status); err != nil {
			t.Fatal(err)
		}
	}
	refund("refund_pending")
	if _, err := s.Reopen(ctx, profile, inv.ID); !errors.Is(err, ErrNotReopenable) {
		t.Fatalf("while refunding: %v, want ErrNotReopenable", err)
	}
	refund("held")
	reopened, err := s.Reopen(ctx, profile, inv.ID)
	if err != nil || !reopened.ClosesAt.Equal(until) || reopened.PaymentStatus != ledger.PartiallyPaid {
		t.Fatalf("a second before: %v, closes %v, %s", err, reopened.ClosesAt, reopened.PaymentStatus)
	}
}

// R-130: a receiver deployed early settles only until deployedAt + 30 days, so a reopen ends a day before that, or
// can't happen. Nor can it while the deploy time was never read.
func TestReopenEndsBeforeAnEarlyDeployStopsSettling(t *testing.T) {
	pool, profile := open(t)
	ctx := context.Background()
	s := NewService(pool)
	month := 30 * 24 * time.Hour
	early := closedPartly(t, pool, s, profile, 1, 0)
	// Settles until 3 days after the close, 4 days before its settle deadline.
	if _, err := pool.Exec(ctx, "UPDATE invoices SET receiver_deployed_at = $2 WHERE id = $1", early.ID,
		early.ExpiresAt.Add(3*24*time.Hour-month).Unix()); err != nil {
		t.Fatal(err)
	}
	tooEarly := closedPartly(t, pool, s, profile, 2, uint64(early.ExpiresAt.Add(24*time.Hour-month).Unix()))
	unread := closedPartly(t, pool, s, profile, 3, 0)
	if _, err := pool.Exec(ctx, "UPDATE invoices SET receiver_deployed_at = NULL WHERE id = $1",
		unread.ID); err != nil {
		t.Fatal(err)
	}
	s.now = func() time.Time { return early.ExpiresAt.Add(time.Minute) }

	until := early.ExpiresAt.Add(2 * 24 * time.Hour)
	if got, err := s.GetOfProfile(ctx, profile, early.ID); err != nil || !got.ReopenUntil.Equal(until) {
		t.Fatalf("offered close: %v, %v; want %v", got.ReopenUntil, err, until)
	}
	if got, err := s.Reopen(ctx, profile, early.ID); err != nil || !got.ClosesAt.Equal(until) {
		t.Fatalf("reopened close: %v, %v; want %v", got.ClosesAt, err, until)
	}
	for name, inv := range map[string]Invoice{"deployed too early": tooEarly, "deploy time never read": unread} {
		if got, err := s.GetOfProfile(ctx, profile, inv.ID); err != nil || !got.ReopenUntil.IsZero() {
			t.Errorf("%s: offered %v, %v; want none", name, got.ReopenUntil, err)
		}
		if _, err := s.Reopen(ctx, profile, inv.ID); !errors.Is(err, ErrNotReopenable) {
			t.Errorf("%s: %v, want ErrNotReopenable", name, err)
		}
	}
}

func TestReopenCannotTakeAnotherCustomersReservedLinkSlot(t *testing.T) {
	pool, profileID := open(t)
	ctx := t.Context()
	s := NewService(pool)
	closed := closedPartly(t, pool, s, profileID, 1, 0)
	const linkID = "eeeeeeee-0000-4000-8000-000000000050"
	if _, err := pool.Exec(ctx, `INSERT INTO payment_links (id, profile_id, slug, title, max_payments)
		VALUES ($1, $2, 'abcdefghijkl', 'One seat', 1)`, linkID, profileID); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, "UPDATE invoices SET link_id = $2 WHERE id = $1", closed.ID, linkID); err != nil {
		t.Fatal(err)
	}
	if _, _, err := s.Create(ctx, profileID, "another-purchase", Request{AmountUSD: "5", LinkID: linkID}); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Reopen(ctx, profileID, closed.ID); !errors.Is(err, ErrLinkAtCapacity) {
		t.Fatalf("reopening took capacity already reserved by another customer: %v", err)
	}
	if got, err := s.GetOfProfile(ctx, profileID, closed.ID); err != nil || !got.ReopenUntil.IsZero() {
		t.Fatalf("reopen offered without capacity: %v, %v", got.ReopenUntil, err)
	}
}

func TestLegacyLinkReopenAllowsConcurrentProfileCoordination(t *testing.T) {
	pool, profileID := open(t)
	ctx, cancel := context.WithTimeout(t.Context(), 2*time.Second)
	defer cancel()
	s := NewService(pool)
	closed := closedPartly(t, pool, s, profileID, 1, 0)
	const linkID = "eeeeeeee-0000-4000-8000-000000000052"
	if _, err := pool.Exec(ctx, `INSERT INTO payment_links (id, profile_id, slug, title, max_payments)
		VALUES ($1, $2, 'abcdefghijkl', 'One seat', 1)`, linkID, profileID); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, "UPDATE invoices SET link_id = $2 WHERE id = $1", closed.ID, linkID); err != nil {
		t.Fatal(err)
	}
	profileLock, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer profileLock.Rollback(t.Context())
	if _, err := profileLock.Exec(ctx, "SELECT 1 FROM profiles WHERE id = $1 FOR NO KEY UPDATE", profileID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Reopen(ctx, profileID, closed.ID); err != nil {
		t.Fatalf("reopen waited for the profile, which can deadlock with Revise: %v", err)
	}
}
