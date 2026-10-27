//go:build e2e

package e2e

import (
	"encoding/csv"
	"math/big"
	"net/http"
	"strconv"
	"strings"
	"testing"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/ethclient"
	"github.com/forwend/forwend/apps/backend/internal/chaintest"
	"github.com/forwend/forwend/apps/backend/internal/ledger"
)

func TestCheckoutPurchaseSettlesWithOneRPCWithoutIssuingAnInvoice(t *testing.T) {
	ctx := t.Context()
	st := newStack(t, true)
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
	summary := authed(t, base+"/payments/"+id+"/reconciliation", st.privy)
	assets := summary["assets"].([]any)
	if len(assets) != 1 {
		t.Fatalf("reconciliation assets: %v", summary)
	}
	asset := assets[0].(map[string]any)
	if asset["closing"].(map[string]any)["receiver"] != "0" || asset["settled"] != amount || asset["unbookedOutflows"] != float64(0) || asset["unreconciledReceivers"] != float64(0) {
		t.Fatalf("reconciliation differs from chain and ledger: %v", asset)
	}
	req, err := http.NewRequest("GET", base+"/payments/"+id+"/movements.csv", nil)
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Authorization", "Bearer "+token(t, st.privy))
	response, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		t.Fatalf("export status: %d", response.StatusCode)
	}
	rows, err := csv.NewReader(response.Body).ReadAll()
	if err != nil || len(rows) != 3 {
		t.Fatalf("export rows: %v, %v", rows, err)
	}
	columns := map[string]int{}
	for i, name := range rows[0] {
		columns[name] = i
	}
	sum := new(big.Int)
	for _, row := range rows[1:] {
		field := func(name string) string { return row[columns[name]] }
		if field("Payment ID") != id || field("Invoice number") != "" || field("Order reference") != "order-42" || field("Source verified") != "true" {
			t.Fatalf("export identity/evidence: %v", row)
		}
		delta, ok := new(big.Int).SetString(field("Receiver delta (base units)"), 10)
		if !ok {
			t.Fatalf("export delta: %v", row)
		}
		sum.Add(sum, delta)
		var sourceAmount, sourceHash string
		var sourceIndex uint64
		if field("Movement kind") == "deposit" {
			err = st.conn.QueryRow(ctx, "SELECT amount::text,block_hash,log_index FROM chain_transfers WHERE invoice_id = $1 AND tx_hash = $2", id, field("Transaction hash")).Scan(&sourceAmount, &sourceHash, &sourceIndex)
		} else {
			err = st.conn.QueryRow(ctx, "SELECT amount::text,block_hash,transfer_log_index FROM receiver_outflows WHERE invoice_id = $1 AND tx_hash = $2", id, field("Transaction hash")).Scan(&sourceAmount, &sourceHash, &sourceIndex)
		}
		if err != nil || sourceAmount != field("Source amount (base units)") || sourceHash != field("Block hash") || strconv.FormatUint(sourceIndex, 10) != field("Token transfer log index") {
			t.Fatalf("export differs from observer source: %v, %v", row, err)
		}
		receipt, err := ethclient.NewClient(st.anvil.RPC).TransactionReceipt(ctx, common.HexToHash(field("Transaction hash")))
		if err != nil || receipt.BlockHash.Hex() != sourceHash {
			t.Fatalf("source receipt: %v", err)
		}
		found := false
		for _, log := range receipt.Logs {
			if uint64(log.Index) == sourceIndex && strings.EqualFold(log.Address.Hex(), st.token) && new(big.Int).SetBytes(log.Data).String() == sourceAmount {
				found = true
			}
		}
		if !found {
			t.Fatalf("source transfer absent from actual receipt: %v", row)
		}
	}
	if sum.String() != booked {
		t.Fatalf("export sum %s differs from ledger %s", sum, booked)
	}
	if status, replay := post(t, base+"/checkout-sessions", st.privy, "purchase-42", body); status != http.StatusOK || replay["sessionId"] != id {
		t.Fatalf("post-payment retry: %d %v", status, replay)
	}
}
