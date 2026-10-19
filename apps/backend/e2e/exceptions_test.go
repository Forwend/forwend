//go:build e2e

package e2e

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/ensp1re/forwend/apps/backend/internal/chaintest"
	"github.com/ensp1re/forwend/apps/backend/internal/ledger"
	"github.com/ethereum/go-ethereum/ethclient"
)

// mailbox is a fake Resend: it records every send and answers like Resend does.
type mailbox struct {
	*httptest.Server
	mu   sync.Mutex
	sent []sentMail
}

type sentMail struct{ to, subject, key string }

func newMailbox(t *testing.T) *mailbox {
	m := &mailbox{}
	m.Server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			To      []string `json:"to"`
			Subject string   `json:"subject"`
		}
		_ = json.NewDecoder(r.Body).Decode(&body)
		m.mu.Lock()
		m.sent = append(m.sent, sentMail{to: strings.Join(body.To, ","), subject: body.Subject, key: r.Header.Get("Idempotency-Key")})
		m.mu.Unlock()
		_, _ = w.Write([]byte(`{"id": "fake"}`))
	}))
	t.Cleanup(m.Close)
	return m
}

func (m *mailbox) mails() []sentMail {
	m.mu.Lock()
	defer m.mu.Unlock()
	return append([]sentMail{}, m.sent...)
}

// TestExceptionsCancelAndEmail is the phase 9 gate (R-83) with the real binaries on Anvil: partial -> top-up -> paid ->
// settled; an expired partial payment held; a late deposit held; money after a cancel held; nothing held is ever
// settled, the ledger matches the chain, and each owner email and the payer's receipt are sent exactly once, also
// across a worker restart.
func TestExceptionsCancelAndEmail(t *testing.T) {
	ctx := context.Background()
	st := newStack(t)
	mail := newMailbox(t)
	// Fresh slices: an append to st.loop could write into the other's backing array (the signer's key into the worker).
	worker := append(append([]string{}, st.loop...), "RESEND_API_KEY=test", "RESEND_API_URL="+mail.URL,
		"PUBLIC_WEB_URL=http://localhost:3000")
	stopWorker := start(t, st.bin, "worker", worker)
	start(t, st.bin, "signer", append(append([]string{}, st.loop...), "EXECUTOR_PRIVATE_KEY="+chaintest.Key))
	st.waitScanned(t)

	pays := map[string]string{} // each invoice's pay link token (D-86)
	create := func(key string) (id, receive string) {
		t.Helper()
		body := fmt.Sprintf(`{"chainId": %d, "token": %q, "amount": %q}`, chaintest.ChainID, st.token, amount)
		status, made := post(t, st.api+"/v1/profiles/"+st.profile+"/invoices", st.privy, key, body)
		if status != http.StatusCreated {
			t.Fatalf("create %s: %d %v", key, status, made)
		}
		pays[made["invoiceId"].(string)] = made["payToken"].(string)
		return made["invoiceId"].(string), made["receiveAddress"].(string)
	}
	state := func(id string) string {
		inv := get(t, st.api+"/v1/invoices/"+pays[id])
		if inv["settlementStatus"] == "settled" {
			return "settled"
		}
		return inv["paymentStatus"].(string)
	}
	reach := func(id, want string) {
		t.Helper()
		waitFor(t, id[:10]+" "+want, func() bool { st.anvil.Mine(1); return state(id) == want })
	}
	a, aReceive := create("a") // INV-0001: partial, then the rest
	b, bReceive := create("b") // INV-0002: partial, then the checkout closes
	c, cReceive := create("c") // INV-0003: nothing on time, then money after the close
	d, dReceive := create("d") // INV-0004: canceled, then paid anyway

	// The payer asks for the receipt before paying (R-82).
	req, _ := http.NewRequest(http.MethodPut, st.api+"/v1/invoices/"+pays[a]+"/payer-email", strings.NewReader(`{"email": "payer@example.com"}`))
	if status, body := do(t, req); status != http.StatusOK {
		t.Fatalf("payer email: %d %v", status, body)
	}

	// A: 2 of 5 USDC, then the other 3: paid and settled to the wallet.
	st.anvil.Transfer(st.token, aReceive, "2000000")
	reach(a, ledger.PartiallyPaid)
	st.anvil.Transfer(st.token, aReceive, "3000000")
	reach(a, "settled")

	// D: canceled before any money (R-79); a payment after that is held, never settled.
	status, canceled := post(t, st.api+"/v1/profiles/"+st.profile+"/invoices/"+d+"/cancel", st.privy, "unused", "")
	if status != http.StatusOK || canceled["paymentStatus"] != ledger.Canceled {
		t.Fatalf("cancel: %d %v", status, canceled)
	}
	st.anvil.Transfer(st.token, dReceive, amount)

	// B: 1 of 5 USDC on time.
	st.anvil.Transfer(st.token, bReceive, "1000000")
	reach(b, ledger.PartiallyPaid)

	// A worker restart in the middle: a deploy. A's emails and D's go out before it, B's and C's after; nothing may be
	// sent twice or lost.
	waitFor(t, "A's and D's emails before the restart", func() bool { st.anvil.Mine(1); return len(mail.mails()) >= 4 })
	stopWorker()
	start(t, st.bin, "worker", worker)

	// Past every checkout's close on chain: B's partial payment is held (D-26), C expires with nothing.
	st.anvil.Wait(2 * 3600)
	reach(b, ledger.ExpiredPartiallyPaid)
	reach(c, ledger.Expired)
	// C: money after the close is late and held.
	st.anvil.Transfer(st.token, cReceive, amount)

	held := func(id string) int64 {
		var n int64
		if err := st.conn.QueryRow(ctx, `SELECT -coalesce(sum(e.amount), 0)::bigint FROM ledger_entries e
			JOIN ledger_transactions x ON x.id = e.transaction_id WHERE x.invoice_id = $1 AND e.account = 'payer_held'`,
			id).Scan(&n); err != nil {
			t.Fatal(err)
		}
		return n
	}
	waitFor(t, "every held amount booked", func() bool {
		st.anvil.Mine(1)
		return held(b) == 1000000 && held(c) == 5000000 && held(d) == 5000000
	})
	if got := state(d); got != ledger.Canceled {
		t.Fatalf("canceled invoice reads %s after a payment", got)
	}

	// Nothing held was settled: one settlement, A's; the ledger's held money is what each receive address holds.
	var settles int
	if err := st.conn.QueryRow(ctx, "SELECT count(*) FROM settlement_intents").Scan(&settles); err != nil || settles != 1 {
		t.Fatalf("%d settlement intents (%v), want A's alone", settles, err)
	}
	balance := ledger.BalanceFrom(map[uint64]*ethclient.Client{chaintest.ChainID: ethclient.NewClient(st.anvil.RPC)})
	for receive, want := range map[string]int64{aReceive: 0, bReceive: 1000000, cReceive: 5000000, dReceive: 5000000, wallet: 5000000} {
		got, _, err := balance(ctx, chaintest.ChainID, st.token, receive)
		if err != nil || got.Int64() != want {
			t.Fatalf("balance of %s: %v %v, want %d", receive, got, err, want)
		}
	}

	// Each email once: the owner's paid, settled and three held, and the payer's receipt.
	want := map[string]string{
		"owner@example.com|INV-0001 paid: 5.00 USDC":               "",
		"owner@example.com|INV-0001: 5.00 USDC is in your wallet":  "",
		"payer@example.com|Your receipt for INV-0001":              "",
		"owner@example.com|INV-0002: 1.00 USDC held for the payer": "",
		"owner@example.com|INV-0003: 5.00 USDC held for the payer": "",
		"owner@example.com|INV-0004: 5.00 USDC held for the payer": "",
	}
	for deadline := time.Now().Add(60 * time.Second); len(mail.mails()) < len(want); time.Sleep(200 * time.Millisecond) {
		if time.Now().After(deadline) {
			rows, _ := st.conn.Query(ctx, `SELECT id, kind, invoice_id, attempts, published_at IS NOT NULL, failed_at IS NOT NULL
				FROM outbox_events ORDER BY id`)
			for rows.Next() {
				var id int64
				var kind, inv string
				var attempts int
				var published, failed bool
				_ = rows.Scan(&id, &kind, &inv, &attempts, &published, &failed)
				t.Logf("outbox %d %s %s attempts %d published %v failed %v", id, kind, inv[:10], attempts, published, failed)
			}
			rows.Close()
			t.Fatalf("emails %v, want %d", mail.mails(), len(want))
		}
		st.anvil.Mine(1)
	}
	time.Sleep(2 * time.Second) // a few more worker rounds: anything sent twice would show now
	got := mail.mails()
	seen, idempotency := map[string]bool{}, map[string]bool{}
	ids := map[string]string{"INV-0001": a, "INV-0002": b, "INV-0003": c, "INV-0004": d}
	for _, m := range got {
		k := m.to + "|" + m.subject
		if _, ok := want[k]; !ok || seen[k] {
			t.Fatalf("unexpected or repeated email %q in %v", k, got)
		}
		seen[k] = true
		// One Idempotency-Key per email, naming its invoice, so Resend would drop a repeat of it.
		number := strings.Fields(strings.TrimPrefix(m.subject, "Your receipt for "))[0]
		if idempotency[m.key] || !strings.HasPrefix(m.key, "forwend-"+ids[strings.TrimSuffix(number, ":")]+"-") {
			t.Fatalf("email %q: key %q repeated or not its invoice's", k, m.key)
		}
		idempotency[m.key] = true
	}
	if len(got) != len(want) {
		t.Fatalf("%d emails, want %d: %v", len(got), len(want), got)
	}
	t.Logf("emails: %v", got)
}
