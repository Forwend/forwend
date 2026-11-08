package tests

import (
	"context"
	"encoding/hex"
	"errors"
	"fmt"
	"math/big"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/forwend/forwend/apps/backend/internal/address"
	"github.com/forwend/forwend/apps/backend/internal/invoice"
	"github.com/forwend/forwend/apps/backend/internal/ledger/ledgertest"
)

// quote is a chain's network fee in USD, or err for a chain that can't be priced.
type quote struct {
	usd *big.Rat
	err error
}

func (q *quote) NetworkFee(context.Context, uint64) (*big.Rat, error) { return q.usd, q.err }

// R-227: a new invoice's network fee is in its terms. The owner pays it by default, deducted at settlement; the
// client pays it on top when the invoice or the profile says so.
func TestInvoicesCarryTheirNetworkFee(t *testing.T) {
	q := &quote{usd: big.NewRat(5, 100)}
	e := invoiceAPIPriced(t, 0, webhookKey, nil, invoice.Pricing{Quotes: q})
	const alice = "did:privy:alice"
	fees := func(r reply) string {
		t.Helper()
		if r.status != http.StatusCreated {
			t.Fatalf("create: %d %v", r.status, r.body)
		}
		b := r.body
		return b["amount"].(string) + " " + b["networkFee"].(string) + " " + b["platformFee"].(string) + " " +
			b["netAmount"].(string) + " " + b["feesPaidBy"].(string)
	}
	owner := e.post(t, alice, e.aliceProfile, "fee-1", basicBody)
	if got := fees(owner); got != "5000000 50000 0 4950000 owner" {
		t.Fatalf("owner pays: %s", got)
	}
	// The stored terms, fees included, compute the receive address the API gave.
	var id, recipient string
	var network, platform, amount string
	var exp, deadline uint64
	if err := e.pool.QueryRow(context.Background(), `SELECT id, recipient_address, amount::text, network_fee::text,
		platform_fee::text, expires_at, settle_deadline FROM invoices WHERE id = $1`, owner.body["invoiceId"]).
		Scan(&id, &recipient, &amount, &network, &platform, &exp, &deadline); err != nil {
		t.Fatal(err)
	}
	n := func(s string) *big.Int { v, _ := new(big.Int).SetString(s, 10); return v }
	receive, err := address.Receive(address.Terms{InvoiceID: [32]byte(unhex(t, id)), Recipient: [20]byte(unhex(t, recipient)),
		Token: [20]byte(unhex(t, usdc)), Amount: n(amount), ExpiresAt: exp, SettleDeadline: deadline,
		IntendedChainID: 84532, NetworkFee: n(network), PlatformFee: n(platform)})
	if err != nil || "0x"+hex.EncodeToString(receive[:]) != owner.body["receiveAddress"] {
		t.Fatalf("receive address %v, the stored terms compute %x (%v)", owner.body["receiveAddress"], receive, err)
	}

	// The client pays on top; the lines still add up to the price.
	client := e.post(t, alice, e.aliceProfile, "fee-2", `{"chainId": 84532, "token": "`+usdc+`", "amount": "5000000",
		"feesPaidBy": "client", "lines": [{"description": "Logo", "quantity": "1", "unitPrice": "3000000"},
		{"description": "Icons", "quantity": "2", "unitPrice": "1000000"}]}`)
	if got := fees(client); got != "5050000 50000 0 5000000 client" {
		t.Fatalf("client pays: %s", got)
	}
	if r := e.post(t, alice, e.aliceProfile, "fee-3", `{"chainId": 84532, "token": "`+usdc+`", "amount": "5000000",
		"feesPaidBy": "payer"}`); r.status != http.StatusUnprocessableEntity {
		t.Fatalf("feesPaidBy payer: %d %v, want 422", r.status, r.body)
	}

	// The profile's choice applies when the request makes none; a form reads it with the quote.
	if r := e.call(t, "PUT", "/v1/profiles/"+e.aliceProfile+"/fees", alice, "", `{"feesPaidBy": "client"}`); r.status != http.StatusOK {
		t.Fatalf("set the profile's payer: %d %v", r.status, r.body)
	}
	if got := fees(e.post(t, alice, e.aliceProfile, "fee-4", basicBody)); got != "5050000 50000 0 5000000 client" {
		t.Fatalf("the profile's client pays: %s", got)
	}
	quoted := e.call(t, "GET", "/v1/profiles/"+e.aliceProfile+"/fees?chainId=84532&token="+usdc+"&amount=5000000",
		alice, "", "")
	options, _ := quoted.body["options"].([]any)
	if quoted.status != http.StatusOK || quoted.body["feesPaidBy"] != "client" || len(options) != 1 ||
		options[0].(map[string]any)["networkFee"] != "50000" || options[0].(map[string]any)["price"] != "5000000" {
		t.Fatalf("quote: %d %v", quoted.status, quoted.body)
	}

	// settle() takes at most a tenth of the amount in fees: an invoice past it is refused, never made.
	q.usd = big.NewRat(11, 100)
	if r := e.post(t, alice, e.aliceProfile, "fee-5", `{"chainId": 84532, "token": "`+usdc+`", "amount": "1000000",
		"feesPaidBy": "owner"}`); r.status != http.StatusUnprocessableEntity || !strings.Contains(fmt.Sprint(r.body["error"]), "network fee") {
		t.Fatalf("fees over a tenth: %d %v, want 422", r.status, r.body)
	}
	q.usd, q.err = nil, errors.New("rpc down")
	if r := e.post(t, alice, e.aliceProfile, "fee-6", basicBody); r.status != http.StatusServiceUnavailable ||
		errorCode(r) != "network_fee_unavailable" {
		t.Fatalf("a chain that can't be priced: %d %v, want 503 network_fee_unavailable", r.status, r.body)
	}
}

// R-228: a settlement that paid fees shows them on its Transactions row and in the CSV, under the net it paid.
func TestTransactionsShowASettlementsFees(t *testing.T) {
	e := invoiceAPIPriced(t, 0, webhookKey, nil, invoice.Pricing{Quotes: &quote{usd: big.NewRat(5, 100)}})
	const alice = "did:privy:alice"
	made := e.post(t, alice, e.aliceProfile, "fee-1", basicBody)
	if made.status != http.StatusCreated {
		t.Fatalf("invoice: %d %v", made.status, made.body)
	}
	hash := "0x" + strings.Repeat("0", 63) + "1"
	e.exec(t, `INSERT INTO wallet_transfers (chain_id, chain_family, token_contract, wallet_address, direction,
		    counterparty, tx_hash, log_index, block_hash, block_number, block_time, amount, status)
		VALUES (84532, 'evm', $1, $2, 'in', $3, $4, 0, $4, 1, $5, 4950000, 'confirmed')`,
		usdc, aliceWallet, made.body["receiveAddress"], hash, time.Now().Unix())
	ledgertest.Settlement(t, e.pool, made.body["invoiceId"].(string), hash, false)
	path := "/v1/profiles/" + e.aliceProfile + "/transactions"
	items := e.call(t, "GET", path, alice, "", "").body["items"].([]any)
	row := items[0].(map[string]any)
	if row["amount"] != "4950000" || row["classification"] != "invoice" || row["payment"].(map[string]any)["fees"] != "50000" {
		t.Fatalf("the settlement's row %v, want the net 4950000 with fees 50000", row)
	}
	csv := strings.Split(e.call(t, "GET", path+".csv", alice, "", "").raw, "\r\n")
	if !strings.HasSuffix(csv[0], ",Payment ID,Settlement fees") || !strings.HasSuffix(csv[1], ","+made.body["invoiceId"].(string)+",0.050000") {
		t.Fatalf("export:\n%s\n%s", csv[0], csv[1])
	}
}

// D-122: a payment link may choose who pays its invoices' fees, over the profile's choice; its payer's invoice
// follows it, and a change to it is a new revision of what the payer pays.
func TestAPaymentLinkChoosesWhoPaysTheFees(t *testing.T) {
	e := invoiceAPIPriced(t, 0, webhookKey, nil, invoice.Pricing{Quotes: &quote{usd: big.NewRat(5, 100)}})
	const alice = "did:privy:alice"
	shop := e.merchant(t)
	path := "/v1/profiles/" + shop + "/links/eeeeeeee-0000-4000-8000-000000000046"
	made := e.call(t, "PUT", path, alice, "", `{"title": "Coffee", "amountUsd": "2", "feesPaidBy": "client"}`)
	if made.status != http.StatusCreated || made.body["feesPaidBy"] != "client" {
		t.Fatalf("link: %d %v", made.status, made.body)
	}
	paid := e.call(t, "POST", "/v1/links/"+made.body["slug"].(string)+"/pay", "", "purchase-1", `{}`)
	if paid.status != http.StatusCreated {
		t.Fatalf("pay: %d %v", paid.status, paid.body)
	}
	inv := e.call(t, "GET", "/v1/invoices/"+paid.body["payToken"].(string), "", "", "")
	if inv.body["feesPaidBy"] != "client" || inv.body["amount"] != "2050000" || inv.body["netAmount"] != "2000000" {
		t.Fatalf("the payer's invoice %v %v %v, want the client paying 2.05", inv.body["feesPaidBy"], inv.body["amount"],
			inv.body["netAmount"])
	}
	before := e.call(t, "GET", "/v1/links/"+made.body["slug"].(string), "", "", "").body["version"]
	if r := e.call(t, "PUT", path, alice, "", `{"title": "Coffee", "amountUsd": "2"}`); r.status != http.StatusOK || r.body["feesPaidBy"] != nil {
		t.Fatalf("back to the profile's choice: %d %v", r.status, r.body)
	}
	if after := e.call(t, "GET", "/v1/links/"+made.body["slug"].(string), "", "", "").body["version"]; after == before {
		t.Fatalf("who pays changed, the link's version stayed %v", after)
	}
}
