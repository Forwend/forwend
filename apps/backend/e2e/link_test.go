//go:build e2e

package e2e

import (
	"net/http"
	"strings"
	"testing"

	"github.com/ethereum/go-ethereum/ethclient"
	"github.com/forwend/forwend/apps/backend/internal/chaintest"
	"github.com/forwend/forwend/apps/backend/internal/ledger"
)

func TestReusableLinkReservationsExpireAndPurchasesSettleIndependently(t *testing.T) {
	ctx := t.Context()
	st := newStack(t, false)
	profile, store, merchantWallet := st.merchant(t)
	start(t, st.bin, "worker", st.loop)
	start(t, st.bin, "signer", append(st.loop, "EXECUTOR_PRIVATE_KEY="+chaintest.Key))
	st.waitScanned(t)
	if _, err := st.conn.Exec(ctx, "UPDATE stores SET default_expires_in = 900 WHERE id = $1", store); err != nil {
		t.Fatal(err)
	}
	base := st.api + "/v1/profiles/" + profile
	linkPath := base + "/links/eeeeeeee-0000-4000-8000-000000000060"
	save := func(cap string) map[string]any {
		t.Helper()
		req, _ := http.NewRequest(http.MethodPut, linkPath, strings.NewReader(`{"storeId":"`+store+`",
			"title":"Coffee","amountUsd":"5","maxPayments":`+cap+`}`))
		req.Header.Set("Authorization", "Bearer "+token(t, st.privy))
		status, result := do(t, req)
		if status != http.StatusCreated && status != http.StatusOK {
			t.Fatalf("save link: %d %v", status, result)
		}
		return result
	}
	template := save("1")
	payURL := st.api + "/v1/links/" + template["slug"].(string) + "/pay"
	pay := func(key string) (int, map[string]any) {
		t.Helper()
		req, _ := http.NewRequest(http.MethodPost, payURL, strings.NewReader(`{}`))
		req.Header.Set("Idempotency-Key", key)
		return do(t, req)
	}
	status, first := pay("abandoned")
	if status != http.StatusCreated {
		t.Fatalf("reserve first purchase: %d %v", status, first)
	}
	firstToken := first["payToken"].(string)
	firstReceive := get(t, st.api+"/v1/invoices/"+firstToken)["receiveAddress"].(string)
	if status, result := pay("blocked"); status != http.StatusConflict {
		t.Fatalf("reserved link accepted another purchase: %d %v", status, result)
	}
	st.anvil.Wait(1000)
	st.anvil.Mine(3)
	waitFor(t, "canonical expiration releases the reservation", func() bool {
		return authed(t, linkPath, st.privy)["reserved"] == 0.0
	})
	if _, err := st.conn.Exec(ctx, "UPDATE stores SET default_expires_in = 3600 WHERE id = $1", store); err != nil {
		t.Fatal(err)
	}
	save("null")
	ids, receivers := []string{}, []string{}
	for _, key := range []string{"customer-a", "customer-b"} {
		status, purchase := pay(key)
		if status != http.StatusCreated {
			t.Fatalf("new purchase: %d %v", status, purchase)
		}
		ids = append(ids, purchase["paymentId"].(string))
		inv := get(t, st.api+"/v1/invoices/"+purchase["payToken"].(string))
		receivers = append(receivers, inv["receiveAddress"].(string))
	}
	if ids[0] == ids[1] || receivers[0] == receivers[1] {
		t.Fatal("independent customers shared a purchase or receive address")
	}
	for _, receive := range receivers {
		st.anvil.Transfer(st.token, receive, amount)
	}
	st.anvil.Mine(3)
	waitFor(t, "both purchases settle", func() bool {
		st.anvil.Mine(1)
		for _, id := range ids {
			if authed(t, base+"/payments/"+id, st.privy)["settlementStatus"] != "settled" {
				return false
			}
		}
		return true
	})
	st.anvil.Transfer(st.token, firstReceive, "1000000")
	st.anvil.Mine(3)
	waitFor(t, "late payment remains a payer liability", func() bool {
		return get(t, st.api+"/v1/invoices/"+firstToken)["refundStatus"] == "held"
	})
	usage := authed(t, linkPath, st.privy)
	if usage["paid"] != 2.0 || usage["reserved"] != 0.0 {
		t.Fatalf("link usage mixes paid, held or expired attempts: %v", usage)
	}
	balances := ledger.BalanceFrom(map[uint64]*ethclient.Client{chaintest.ChainID: ethclient.NewClient(st.anvil.RPC)})
	for holder, want := range map[string]string{merchantWallet: "10000000", firstReceive: "1000000", receivers[0]: "0", receivers[1]: "0"} {
		got, _, err := balances(ctx, chaintest.ChainID, st.token, holder)
		if err != nil || got.String() != want {
			t.Fatalf("independent chain balance %s: %v, %v; want %s", holder, got, err, want)
		}
	}
	var held, sequence string
	if err := st.conn.QueryRow(ctx, `SELECT (-coalesce(sum(e.amount), 0))::text,
		(SELECT invoice_seq::text FROM profiles WHERE id = $1)
		FROM ledger_entries e JOIN ledger_transactions x ON x.id = e.transaction_id
		JOIN invoices i ON i.id = x.invoice_id WHERE i.profile_id = $1 AND e.account = 'payer_held'`, profile).
		Scan(&held, &sequence); err != nil || held != "1000000" || sequence != "0" {
		t.Fatalf("held liability %s, invoice sequence %s, error %v", held, sequence, err)
	}
}
