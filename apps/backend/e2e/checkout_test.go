//go:build e2e

package e2e

import (
	"net/http"
	"testing"

	"github.com/ethereum/go-ethereum/ethclient"
	"github.com/forwend/forwend/apps/backend/internal/chaintest"
	"github.com/forwend/forwend/apps/backend/internal/ledger"
)

func TestCheckoutPurchaseSettlesWithoutIssuingAnInvoice(t *testing.T) {
	ctx := t.Context()
	st := newStack(t)
	profile, store, merchantWallet := st.merchant(t)
	start(t, st.bin, "worker", st.loop)
	start(t, st.bin, "signer", append(st.loop, "EXECUTOR_PRIVATE_KEY="+chaintest.Key))
	st.waitScanned(t)
	base := st.api + "/v1/profiles/" + profile
	body := `{"storeId":"` + store + `","amountUsd":"5.00","reference":"order-42",
		"items":[{"description":"Coffee","quantity":"2","unitPrice":"2.50"}]}`
	status, session := post(t, base+"/checkout-sessions", st.privy, "purchase-42", body)
	if status != http.StatusCreated {
		t.Fatalf("checkout creation: %d %v", status, session)
	}
	id := session["sessionId"].(string)
	public := authed(t, base+"/payments/"+id, st.privy)["hostedUrl"].(string)
	pay := public[len("http://localhost:3000/pay/"):]
	inv := get(t, st.api+"/v1/invoices/"+pay)
	receive := inv["receiveAddress"].(string)
	st.anvil.Transfer(st.token, receive, amount)
	waitFor(t, "checkout detected", func() bool {
		return authed(t, base+"/payments/"+id, st.privy)["paymentStatus"] == "detected"
	})
	if status, body := post(t, base+"/checkout-sessions/"+id+"/expire", st.privy, "", ""); status != http.StatusConflict {
		t.Fatalf("expiration during confirmation: %d %v", status, body)
	}
	st.anvil.Mine(2)
	waitFor(t, "checkout settlement", func() bool {
		st.anvil.Mine(1)
		return authed(t, base+"/payments/"+id, st.privy)["settlementStatus"] == "settled"
	})
	session = authed(t, base+"/checkout-sessions/"+id, st.privy)
	payment := session["payment"].(map[string]any)
	if session["status"] != "complete" || payment["paymentStatus"] != "paid" || payment["number"] != nil || payment["documentKind"] != "none" {
		t.Fatalf("completed checkout: %v", session)
	}
	var booked, sequence string
	if err := st.conn.QueryRow(ctx, `SELECT coalesce(sum(e.amount), 0)::text, (SELECT invoice_seq::text FROM profiles WHERE id = $2)
		FROM ledger_entries e JOIN ledger_transactions x ON x.id = e.transaction_id WHERE x.invoice_id = $1
		AND e.account = 'receiver'`, id, profile).Scan(&booked, &sequence); err != nil || booked != "0" || sequence != "0" {
		t.Fatalf("receiver ledger %s, invoice sequence %s, error %v", booked, sequence, err)
	}
	balances := ledger.BalanceFrom(map[uint64]*ethclient.Client{chaintest.ChainID: ethclient.NewClient(st.anvil.RPC)})
	for holder, want := range map[string]string{receive: "0", merchantWallet: amount} {
		got, _, err := balances(ctx, chaintest.ChainID, st.token, holder)
		if err != nil || got.String() != want {
			t.Fatalf("chain balance %s: %v, %v; want %s", holder, got, err, want)
		}
	}
	if status, replay := post(t, base+"/checkout-sessions", st.privy, "purchase-42", body); status != http.StatusOK || replay["sessionId"] != id {
		t.Fatalf("post-payment retry: %d %v", status, replay)
	}
}
