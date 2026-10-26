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
	const merchantWallet = "0x5555555555555555555555555555555555555555"
	var profile, store string
	if err := st.conn.QueryRow(ctx, `WITH p AS (INSERT INTO profiles (user_id, kind, name)
		SELECT user_id, 'merchant', 'Coffee shop' FROM profiles WHERE id = $1 RETURNING id),
		w AS (INSERT INTO profile_wallets (profile_id, provider, provider_wallet_id, chain_family, address)
		SELECT id, 'privy', 'checkout-wallet', 'evm', $2 FROM p),
		b AS (INSERT INTO profile_billing_details (profile_id, name, address, country, contact_email)
		SELECT p.id, d.name, d.address, d.country, d.contact_email FROM p JOIN profile_billing_details d ON d.profile_id = $1)
		SELECT id FROM p`, st.profile, merchantWallet).Scan(&profile); err != nil {
		t.Fatal(err)
	}
	if err := st.conn.QueryRow(ctx, "SELECT id FROM stores WHERE profile_id = $1", profile).Scan(&store); err != nil {
		t.Fatal(err)
	}
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
