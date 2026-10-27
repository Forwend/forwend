package tests

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"math/big"
	"net/http"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/forwend/forwend/apps/backend/internal/invoice"
	"github.com/forwend/forwend/apps/backend/internal/ledger"
	"github.com/forwend/forwend/apps/backend/internal/ledger/ledgertest"
	"github.com/forwend/forwend/apps/backend/internal/link"
)

func TestLinkPurchaseRetrySurvivesTemplateChangesAndDisable(t *testing.T) {
	e := invoiceAPI(t)
	const alice = "did:privy:alice"
	shop := e.merchant(t)
	const id = "eeeeeeee-0000-4000-8000-000000000042"
	path := "/v1/profiles/" + shop + "/links/" + id
	link := e.call(t, "PUT", path, alice, "", `{"title":"Coffee","amountUsd":"2"}`)
	pay := "/v1/links/" + link.body["slug"].(string) + "/pay"
	first := e.call(t, "POST", pay, "", "purchase-42", `{}`)
	if first.status != http.StatusCreated {
		t.Fatalf("first purchase: %d %v", first.status, first.body)
	}
	if changed := e.call(t, "PUT", path, alice, "", `{"title":"Tea","amountUsd":"9","active":false}`); changed.status != http.StatusOK {
		t.Fatalf("edit template: %d %v", changed.status, changed.body)
	}
	retry := e.call(t, "POST", pay, "", "purchase-42", `{}`)
	if retry.status != http.StatusOK || retry.body["payToken"] != first.body["payToken"] {
		t.Fatalf("retry after editing and disabling: %d %v", retry.status, retry.body)
	}
	inv := e.call(t, "GET", "/v1/invoices/"+retry.body["payToken"].(string), "", "", "")
	if inv.body["title"] != "Coffee" || inv.body["amount"] != "2000000" || inv.body["documentKind"] != "none" {
		t.Fatalf("purchase lost its original terms or issued an invoice: %v", inv.body)
	}
	if r := e.call(t, "POST", pay, "", "new-purchase", `{}`); r.status != http.StatusConflict {
		t.Fatalf("disabled link accepted another purchase: %d %v", r.status, r.body)
	}
}

func TestLinkQuotesPreventRepricingUncommittedRetries(t *testing.T) {
	e := invoiceAPI(t)
	const alice = "did:privy:alice"
	shop := e.merchant(t)
	path := "/v1/profiles/" + shop + "/links/eeeeeeee-0000-4000-8000-000000000048"
	template := e.call(t, "PUT", path, alice, "", `{"title":"Coffee","amountUsd":"50"}`)
	slug := template.body["slug"].(string)
	public := "/v1/links/" + slug
	quote := e.call(t, "GET", public, "", "", "")
	version := quote.body["version"].(string)
	e.call(t, "POST", public+"/visits", "", "", "")
	if read := e.call(t, "GET", public, "", "", ""); read.body["version"] != version {
		t.Fatal("a visit changed the quoted offer")
	}
	body := `{"expectedAmountUsd":"50.00","expectedVersion":"` + version + `"}`
	committed := e.call(t, "POST", public+"/pay", "", "committed", body)
	if committed.status != http.StatusCreated {
		t.Fatalf("quoted checkout: %d %v", committed.status, committed.body)
	}
	e.call(t, "PUT", path, alice, "", `{"title":"Tea","amountUsd":"100"}`)
	if retry := e.call(t, "POST", public+"/pay", "", "committed", body); retry.status != http.StatusOK || retry.body["payToken"] != committed.body["payToken"] {
		t.Fatalf("committed quoted retry: %d %v", retry.status, retry.body)
	}
	for key, request := range map[string]string{
		"uncommitted":   body,
		"changed-offer": `{"expectedAmountUsd":"100.00","expectedVersion":"` + version + `"}`,
	} {
		if r := e.call(t, "POST", public+"/pay", "", key, request); r.status != http.StatusConflict || errorCode(r) != "link_changed" {
			t.Fatalf("uncommitted retry silently repriced: %d %v", r.status, r.body)
		}
	}
	var count int
	if err := e.pool.QueryRow(t.Context(), "SELECT count(*) FROM invoices WHERE profile_id = $1", shop).Scan(&count); err != nil || count != 1 {
		t.Fatalf("rejected quotes created %d payment rows, %v", count, err)
	}
}

func TestScopedLinkEditWithoutStoreKeepsItsOriginalStore(t *testing.T) {
	e := invoiceAPI(t)
	const alice, bob = "did:privy:alice", "did:privy:bob"
	shop := e.merchant(t)
	first := storeIDs(t, e, shop)[0]
	base := "/v1/profiles/" + shop
	e.call(t, "PUT", base+"/stores/"+storeB, alice, "", `{"name":"Other","defaultExpiresIn":3600}`)
	path := base + "/links/eeeeeeee-0000-4000-8000-000000000049"
	e.call(t, "PUT", path, alice, "", `{"storeId":"`+storeB+`","title":"Coffee","amountUsd":"2"}`)
	e.exec(t, `INSERT INTO profile_members (profile_id, user_id, role)
		SELECT $1, id, 'developer' FROM users WHERE privy_user_id = $2`, shop, bob)
	e.exec(t, `INSERT INTO member_stores (profile_id, user_id, store_id)
		SELECT $1, id, unnest($3::uuid[]) FROM users WHERE privy_user_id = $2`, shop, bob, []string{first, storeB})
	for _, role := range []string{"developer", "finance"} {
		e.exec(t, "UPDATE profile_members SET role = $2 WHERE profile_id = $1", shop, role)
		if r := e.call(t, "PUT", path, bob, "", `{"title":"Updated","amountUsd":"2"}`); r.status != http.StatusOK || r.body["storeId"] != storeB {
			t.Fatalf("%s edit changed or rejected original store: %d %v", role, r.status, r.body)
		}
	}
}

func TestLinkCreationReadsCapacityAfterAConcurrentReopenCommits(t *testing.T) {
	e := invoiceAPI(t)
	ctx := t.Context()
	shop := e.merchant(t)
	store := storeIDs(t, e, shop)[0]
	const linkID = "eeeeeeee-0000-4000-8000-000000000051"
	template := e.call(t, "PUT", "/v1/profiles/"+shop+"/links/"+linkID, "did:privy:alice", "", `{"title":"One seat","amountUsd":"5","maxPayments":1}`)
	inv, _, err := invoice.NewService(e.pool).Create(ctx, shop, "legacy-partial", invoice.Request{AmountUSD: "5", StoreID: store, LinkID: linkID})
	if err != nil {
		t.Fatal(err)
	}
	e.deposit(t, inv.ID, "2500000")
	e.exec(t, "UPDATE chain_cursors SET last_scanned_time = $1, last_finalized_time = $1", inv.ExpiresAt.Unix()+60)
	if err := ledger.NewService(e.pool, func(context.Context, uint64, string, string) (*big.Int, uint64, error) {
		return big.NewInt(2500000), 100, nil
	}, func(context.Context, uint64, string, string) (uint64, error) { return 0, nil }).Process(ctx, inv.ID); err != nil {
		t.Fatal(err)
	}
	current, err := invoice.NewService(e.pool).GetOfProfile(ctx, shop, inv.ID)
	if err != nil || current.PaymentStatus != ledger.ExpiredPartiallyPaid {
		t.Fatalf("closed partial setup: %s, %v", current.PaymentStatus, err)
	}
	ledgertest.Checkpoint(t, e.pool, inv.ID, 100, inv.ExpiresAt.Unix()+60, "2500000")
	reopening, err := e.pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer reopening.Rollback(ctx)
	for _, statement := range []string{"SELECT 1 FROM invoices WHERE id = $1 FOR UPDATE", "SELECT 1 FROM payment_links WHERE id = $1 FOR UPDATE"} {
		id := inv.ID
		if strings.Contains(statement, "payment_links") {
			id = linkID
		}
		if _, err := reopening.Exec(ctx, statement, id); err != nil {
			t.Fatal(err)
		}
	}
	result := make(chan error, 1)
	go func() {
		_, _, err := link.NewService(e.pool, invoice.NewService(e.pool)).Pay(ctx, template.body["slug"].(string), "new-purchase", link.PayRequest{})
		result <- err
	}()
	deadline := time.NewTimer(10 * time.Second)
	defer deadline.Stop()
	for {
		var waiting bool
		if err := e.pool.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE datname = current_database()
			AND wait_event_type = 'Lock' AND query LIKE '%payment_links%FOR UPDATE%')`).Scan(&waiting); err != nil {
			t.Fatal(err)
		}
		if waiting {
			break
		}
		select {
		case <-deadline.C:
			t.Fatal("new purchase did not wait for the reopening link")
		case <-time.After(10 * time.Millisecond):
		}
	}
	if err := ledger.Reopen(ctx, reopening, inv.ID, inv.SettleDeadline.Add(-invoice.ReopenMargin).Unix()); err != nil {
		t.Fatal(err)
	}
	if err := reopening.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	if err := <-result; !errors.Is(err, link.ErrFull) {
		t.Fatalf("purchase used a stale capacity snapshot: %v", err)
	}
}

func TestConcurrentLinkReservationRefusalSpendsNoCreationBudget(t *testing.T) {
	e := invoiceAPI(t)
	ctx := t.Context()
	shop := e.merchant(t)
	path := "/v1/profiles/" + shop + "/links/eeeeeeee-0000-4000-8000-000000000047"
	template := e.call(t, "PUT", path, "did:privy:alice", "", `{"title":"One seat","amountUsd":"2","maxPayments":1}`)
	slug := template.body["slug"].(string)
	service := link.NewService(e.pool, invoice.NewService(e.pool))
	var spent atomic.Int32
	entered, release := make(chan struct{}), make(chan struct{})
	var once sync.Once
	unblock := func() { once.Do(func() { close(release) }) }
	defer unblock()
	results := make(chan error, 2)
	go func() {
		_, _, err := service.Pay(ctx, slug, "first", link.PayRequest{Allow: func() time.Duration {
			spent.Add(1)
			close(entered)
			<-release
			return 0
		}})
		results <- err
	}()
	select {
	case <-entered:
	case err := <-results:
		t.Fatalf("first purchase stopped before the creation budget: %v", err)
	case <-time.After(10 * time.Second):
		t.Fatal("first purchase did not reach the creation budget")
	}
	go func() {
		_, _, err := service.Pay(ctx, slug, "second", link.PayRequest{Allow: func() time.Duration {
			spent.Add(1)
			return 0
		}})
		results <- err
	}()
	deadline := time.NewTimer(10 * time.Second)
	defer deadline.Stop()
	for {
		var waiting bool
		if err := e.pool.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE datname = current_database()
			AND wait_event_type = 'Lock' AND query LIKE '%profiles%FOR NO KEY UPDATE%')`).Scan(&waiting); err != nil {
			t.Fatal(err)
		}
		if waiting {
			break
		}
		select {
		case <-deadline.C:
			t.Fatal("second purchase did not wait for the first reservation")
		case <-time.After(10 * time.Millisecond):
		}
	}
	unblock()
	a, b := <-results, <-results
	if !(a == nil && errors.Is(b, link.ErrFull) || b == nil && errors.Is(a, link.ErrFull)) || spent.Load() != 1 {
		t.Fatalf("reservation results %v, %v; budget spent %d times, want once", a, b, spent.Load())
	}
}

func TestLinkRetriesKeepLegacyHashesAndTheExactPublicInput(t *testing.T) {
	e := invoiceAPI(t)
	ctx := t.Context()
	const alice = "did:privy:alice"
	shop := e.merchant(t)
	store := storeIDs(t, e, shop)[0]
	const id = "eeeeeeee-0000-4000-8000-000000000046"
	path := "/v1/profiles/" + shop + "/links/" + id
	template := e.call(t, "PUT", path, alice, "", `{"title":"Coffee","amountUsd":"2"}`)
	pay := "/v1/links/" + template.body["slug"].(string) + "/pay"
	legacy, _, err := invoice.NewService(e.pool).Create(ctx, shop, "link:"+id+":legacy", invoice.Request{
		AmountUSD: "2", StoreID: store, LinkID: id, Details: invoice.Details{Title: "Coffee"},
	})
	if err != nil {
		t.Fatal(err)
	}
	var hash []byte
	if err := e.pool.QueryRow(ctx, "SELECT request_hash FROM invoices WHERE id = $1", legacy.ID).Scan(&hash); err != nil {
		t.Fatal(err)
	}
	fixed := e.call(t, "POST", pay, "", "fixed", `{}`)
	e.call(t, "PUT", path, alice, "", `{"title":"Tea","minUsd":"1"}`)
	open := e.call(t, "POST", pay, "", "open", `{"amountUsd":"2.00"}`)
	e.call(t, "PUT", path, alice, "", `{"title":"Closed","minUsd":"10","active":false}`)
	for key, body := range map[string]string{"legacy": `{}`, "fixed": `{}`, "open": `{"amountUsd":"2.0"}`} {
		r := e.call(t, "POST", pay, "", key, body)
		want := map[string]any{"legacy": legacy.PayToken, "fixed": fixed.body["payToken"], "open": open.body["payToken"]}[key]
		if r.status != http.StatusOK || r.body["payToken"] != want {
			t.Fatalf("original %s retry: %d %v", key, r.status, r.body)
		}
	}
	service := link.NewService(e.pool, invoice.NewService(e.pool))
	for _, input := range []struct{ key, amount string }{
		{"fixed", "2"}, {"open", ""}, {"open", "3"},
	} {
		if _, _, err := service.Pay(ctx, template.body["slug"].(string), input.key, link.PayRequest{AmountUSD: input.amount}); !errors.Is(err, invoice.ErrConflict) {
			t.Fatalf("changed %s input: %v", input.key, err)
		}
	}
	var after []byte
	if err := e.pool.QueryRow(ctx, "SELECT request_hash FROM invoices WHERE id = $1", legacy.ID).Scan(&after); err != nil || !bytes.Equal(hash, after) {
		t.Fatalf("legacy fingerprint changed: %v", err)
	}
}

func TestLimitedLinkReservesTheLastPurchaseSlotOnce(t *testing.T) {
	e := invoiceAPI(t)
	const alice = "did:privy:alice"
	shop := e.merchant(t)
	const id = "eeeeeeee-0000-4000-8000-000000000043"
	path := "/v1/profiles/" + shop + "/links/" + id
	link := e.call(t, "PUT", path, alice, "", `{"title":"One seat","amountUsd":"2","maxPayments":1}`)
	pay := "/v1/links/" + link.body["slug"].(string) + "/pay"
	var wg sync.WaitGroup
	results := make(chan reply, 3)
	for n := range 3 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			results <- e.call(t, "POST", pay, "", fmt.Sprintf("purchase-%d", n), `{}`)
		}()
	}
	wg.Wait()
	close(results)
	created, full := 0, 0
	for r := range results {
		if r.status == http.StatusCreated {
			created++
		} else if r.status == http.StatusConflict && errorCode(r) == "link_full" {
			full++
		} else {
			t.Fatalf("concurrent purchase: %d %v", r.status, r.body)
		}
	}
	if created != 1 || full != 2 {
		t.Fatalf("last slot: %d created, %d full; want 1 and 2", created, full)
	}
	owner := e.call(t, "GET", path, alice, "", "")
	if owner.body["paid"] != 0.0 || owner.body["reserved"] != 1.0 {
		t.Fatalf("reservation counted as a paid purchase: %v", owner.body)
	}
}

func TestLinkStoreCannotMoveAndUnreadyMerchantCannotActivate(t *testing.T) {
	e := invoiceAPI(t)
	const alice = "did:privy:alice"
	shop := e.merchant(t)
	base := "/v1/profiles/" + shop
	e.call(t, "PUT", base+"/stores/"+storeB, alice, "", `{"name":"Other","defaultExpiresIn":3600}`)
	path := base + "/links/eeeeeeee-0000-4000-8000-000000000044"
	created := e.call(t, "PUT", path, alice, "", `{"title":"Coffee","amountUsd":"2"}`)
	if created.status != http.StatusCreated {
		t.Fatalf("create link: %d %v", created.status, created.body)
	}
	if r := e.call(t, "PUT", path, alice, "", `{"title":"Moved","amountUsd":"2","storeId":"`+storeB+`"}`); r.status != http.StatusUnprocessableEntity {
		t.Errorf("moved link to another store: %d %v", r.status, r.body)
	}
	unready := "/v1/profiles/" + e.walletless + "/links/eeeeeeee-0000-4000-8000-000000000045"
	if r := e.call(t, "PUT", unready, alice, "", `{"title":"Not ready","amountUsd":"2"}`); r.status != http.StatusConflict {
		t.Fatalf("unready merchant activated link: %d %v", r.status, r.body)
	}
	if r := e.call(t, "PUT", unready, alice, "", `{"title":"Draft","amountUsd":"2","active":false}`); r.status != http.StatusCreated {
		t.Fatalf("unready merchant cannot save a draft: %d %v", r.status, r.body)
	}
}

func TestLinkPurchaseMetadataAndSourceCannotBeRewritten(t *testing.T) {
	e := invoiceAPI(t)
	shop := e.merchant(t)
	const id = "eeeeeeee-0000-4000-8000-000000000050"
	saved := e.call(t, "PUT", "/v1/profiles/"+shop+"/links/"+id, "did:privy:alice", "", `{"title":"Coffee","amountUsd":"2"}`)
	if saved.status != http.StatusCreated {
		t.Fatalf("link: %d %v", saved.status, saved.body)
	}
	purchase := e.call(t, "POST", "/v1/links/"+saved.body["slug"].(string)+"/pay", "", "immutable-purchase", `{}`)
	if purchase.status != http.StatusCreated {
		t.Fatalf("purchase: %d %v", purchase.status, purchase.body)
	}
	payment := purchase.body["paymentId"].(string)
	for _, statement := range []string{
		"UPDATE link_checkout_requests SET amount_cents = 300 WHERE invoice_id = $1",
		"DELETE FROM link_checkout_requests WHERE invoice_id = $1",
		"UPDATE invoices SET link_id = NULL WHERE id = $1",
		"UPDATE invoices SET store_id = NULL WHERE id = $1",
	} {
		if _, err := e.pool.Exec(t.Context(), statement, payment); err == nil {
			t.Fatalf("accepted mutation: %s", statement)
		}
	}
	if _, err := e.pool.Exec(t.Context(), "TRUNCATE link_checkout_requests"); err == nil {
		t.Fatal("truncated retry identities")
	}
	for _, statement := range []string{
		"UPDATE payment_links SET store_id = NULL WHERE id = $1",
		"UPDATE payment_links SET slug = 'newslug12345' WHERE id = $1",
		"UPDATE payment_links SET livemode = NOT livemode WHERE id = $1",
	} {
		if _, err := e.pool.Exec(t.Context(), statement, id); err == nil {
			t.Fatalf("accepted identity mutation: %s", statement)
		}
	}
	retry := e.call(t, "POST", "/v1/links/"+saved.body["slug"].(string)+"/pay", "", "immutable-purchase", `{}`)
	if retry.status != http.StatusOK || retry.body["paymentId"] != payment {
		t.Fatalf("lost original purchase: %d %v", retry.status, retry.body)
	}
}
