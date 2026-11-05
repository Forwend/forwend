//go:build e2e

package e2e

import (
	"bytes"
	"encoding/hex"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/ethereum/go-ethereum/ethclient"
	"github.com/forwend/forwend/apps/backend/internal/chaintest"
	"github.com/forwend/forwend/apps/backend/internal/ledger"
)

// What ops prints for the refund authority: each call's To and Data for the Safe's Transaction Builder, and the same
// call as a `cast send` line.
var (
	safeCall = regexp.MustCompile(`To\s+(0x[0-9a-fA-F]{40})\s+Data 0x([0-9a-fA-F]*)`)
	castLine = regexp.MustCompile(`cast send (0x[0-9a-fA-F]{40}) '([^']*)'((?: '[^']*')*)`)
	castArg  = regexp.MustCompile(`'([^']*)'`)
)

// Held money of every kind, and another token, goes back through ops case, ops return and the printed Safe calls,
// with the real binaries on Anvil (D-118, R-130, R-83). After each, the ledger equals the chain and the payer has it.
func TestReturnsThroughSupport(t *testing.T) {
	ctx := t.Context()
	st := newStack(t, false)
	start(t, st.bin, "worker", st.loop) // the signer starts later: a return is queued before A settles
	st.waitScanned(t)
	balance := ledger.BalanceFrom(map[uint64]*ethclient.Client{chaintest.ChainID: ethclient.NewClient(st.anvil.RPC)})

	create := func(key string) (id, receive string) {
		t.Helper()
		body := fmt.Sprintf(`{"chainId": %d, "token": %q, "amount": %q}`, chaintest.ChainID, st.token, amount)
		status, made := post(t, st.api+"/v1/profiles/"+st.profile+"/invoices", st.privy, key, body)
		if status != http.StatusCreated {
			t.Fatalf("create %s: %d %v", key, status, made)
		}
		return made["invoiceId"].(string), made["receiveAddress"].(string)
	}
	read := func(id string) (payment, settlement, refund string) {
		t.Helper()
		if err := st.conn.QueryRow(ctx, "SELECT payment_status, settlement_status, refund_status FROM invoices WHERE id = $1",
			id).Scan(&payment, &settlement, &refund); err != nil {
			t.Fatal(err)
		}
		return
	}
	reach := func(id, want string) {
		t.Helper()
		waitFor(t, id[:10]+" "+want, func() bool { st.anvil.Mine(1); p, _, _ := read(id); return p == want })
	}
	onChain := func(token, holder string) int64 {
		t.Helper()
		got, _, err := balance(ctx, chaintest.ChainID, token, holder)
		if err != nil {
			t.Fatal(err)
		}
		return got.Int64()
	}
	// The ledger's receiver balance equals the chain's, with held as given, once a worker round has booked it all.
	matches := func(id, receive string, held int64) {
		t.Helper()
		waitFor(t, id[:10]+" ledger equals chain", func() bool {
			st.anvil.Mine(1)
			a, err := ledger.ReadAmounts(ctx, st.conn, id)
			return err == nil && a.Held.Int64() == held && a.Receiver.Int64() == onChain(st.token, receive)
		})
	}
	run := func(args ...string) (string, error) {
		cmd := exec.Command(filepath.Join(st.bin, "ops"), args...)
		cmd.Env = append(append([]string{}, st.loop...), "PATH="+os.Getenv("PATH"), "HOME="+os.Getenv("HOME"))
		out, err := cmd.CombinedOutput()
		return string(out), err
	}
	ops := func(args ...string) string {
		t.Helper()
		out, err := run(args...)
		if err != nil {
			t.Fatalf("ops %v: %v\n%s", args, err, out)
		}
		return out
	}
	// caseShows is ops case's read of held money, as support sees it first.
	caseShows := func(id string, want ...string) {
		t.Helper()
		out := ops("case", id)
		for _, w := range want {
			if !strings.Contains(out, w) {
				t.Fatalf("ops case %s lacks %q:\n%s", id[:10], w, out)
			}
		}
	}
	// send runs each printed Safe call (its To and Data) as the refund authority, after checking the cast line for it
	// encodes the same bytes, then mines past finality.
	send := func(printed string) {
		t.Helper()
		calls, casts := safeCall.FindAllStringSubmatch(printed, -1), castLine.FindAllStringSubmatch(printed, -1)
		if len(calls) == 0 || len(calls) != len(casts) {
			t.Fatalf("%d Safe calls and %d cast lines printed:\n%s", len(calls), len(casts), printed)
		}
		for i, c := range calls {
			data, err := hex.DecodeString(c[2])
			if err != nil {
				t.Fatal(err)
			}
			var args []string
			for _, a := range castArg.FindAllStringSubmatch(casts[i][3], -1) {
				args = append(args, a[1])
			}
			encoded, err := chaintest.Calldata(casts[i][2], args...)
			if err != nil || !bytes.Equal(encoded, data) || !strings.EqualFold(casts[i][1], c[1]) {
				t.Fatalf("call %d: the Safe data and the cast line differ (%v):\n%s", i+1, err, printed)
			}
			st.anvil.AsAuthorityData(strings.ToLower(c[1]), data)
		}
		st.anvil.Mine(3)
	}
	// returned checks the payer got exactly that much back.
	payer := func() int64 { return onChain(st.token, chaintest.Sender) }
	returned := func(before, want int64) {
		t.Helper()
		if got := payer() - before; got != want {
			t.Fatalf("the payer got %d back, want %d", got, want)
		}
	}

	a, aReceive := create("a") // overpaid, returned while its settlement waits
	b, bReceive := create("b") // partly paid, closed, then money late: part returned before the deadline
	c, cReceive := create("c") // nothing on time, then money after the close
	d, dReceive := create("d") // partly paid, closed: returned only after the settle deadline
	e, eReceive := create("e") // canceled, then paid anyway

	// A: 6.00 for 5.00 holds 1.00 for the payer. The return is queued before the signer settles A.
	overpay := st.anvil.Transfer(st.token, aReceive, "6000000")
	reach(a, ledger.Paid)
	matches(a, aReceive, 1000000)
	caseShows(a, "Held for the payer: 1.00 USDC (overpaid)", "refundable now 1.00 USDC")
	printedA := ops("return", "-tx", overpay, a)
	if _, _, refund := read(a); refund != "refund_pending" {
		t.Fatalf("A's refund status %s after the return was queued", refund)
	}
	// The signer settles A's 5.00 while the return waits; the ledger keeps the return queued and the 1.00 held.
	start(t, st.bin, "signer", append(append([]string{}, st.loop...), "EXECUTOR_PRIVATE_KEY="+chaintest.Key))
	waitFor(t, "A settled", func() bool { st.anvil.Mine(1); _, s, _ := read(a); return s == "settled" })
	matches(a, aReceive, 1000000)
	_, _, refund := read(a)
	if got := onChain(st.token, wallet); refund != "refund_pending" || got != 5000000 {
		t.Fatalf("A while its return waits: refund %s, creator wallet %d", refund, got)
	}
	before := payer()
	send(printedA)
	matches(a, aReceive, 0)
	returned(before, 1000000)
	waitFor(t, "A refunded", func() bool { st.anvil.Mine(1); _, _, r := read(a); return r == "refunded" })

	// B, D: partly paid on time; E: canceled before any money, then paid.
	st.anvil.Transfer(st.token, bReceive, "1000000")
	partD := st.anvil.Transfer(st.token, dReceive, "1000000")
	reach(b, ledger.PartiallyPaid)
	reach(d, ledger.PartiallyPaid)
	if status, canceled := post(t, st.api+"/v1/profiles/"+st.profile+"/invoices/"+e+"/cancel", st.privy, "unused", ""); status != http.StatusOK ||
		canceled["paymentStatus"] != ledger.Canceled {
		t.Fatalf("cancel E: %d %v", status, canceled)
	}
	paidE := st.anvil.Transfer(st.token, eReceive, amount)

	// Past every checkout's close: B and D hold their part payments, C expires with nothing.
	st.anvil.Wait(2 * 3600)
	reach(b, ledger.ExpiredPartiallyPaid)
	reach(d, ledger.ExpiredPartiallyPaid)
	reach(c, ledger.Expired)

	// B: 5.00 more after the close holds 6.00 in all, of which the 1.00 above the amount is refundable now.
	lateB := st.anvil.Transfer(st.token, bReceive, amount)
	matches(b, bReceive, 6000000)
	caseShows(b, "Held for the payer: 6.00 USDC (expired, late)", "refundable now 1.00 USDC")
	// B can be reopened until its return is queued: the refusal below is the queued return's.
	if inv := authed(t, st.api+"/v1/profiles/"+st.profile+"/invoices/"+b, st.privy); inv["reopenUntil"] == nil {
		t.Fatalf("B isn't reopenable before its return: %v", inv)
	}
	printedB := ops("return", "-tx", lateB, b)
	if status, body := post(t, st.api+"/v1/profiles/"+st.profile+"/invoices/"+b+"/reopen", st.privy, "reopen-b", ""); status != http.StatusConflict {
		t.Fatalf("reopen while a return is queued: %d %v", status, body)
	}
	// B holds its amount and more on chain; while its return waits, signer and worker rounds settle none of it.
	for range 10 {
		st.anvil.Mine(1)
		time.Sleep(200 * time.Millisecond)
	}
	var settles int
	if err := st.conn.QueryRow(ctx, "SELECT count(*) FROM settlement_intents WHERE invoice_id = $1", b).Scan(&settles); err != nil || settles != 0 {
		t.Fatalf("B has %d settlement intents (%v) while its return waits", settles, err)
	}
	before = payer()
	send(printedB)
	matches(b, bReceive, 5000000)
	returned(before, 1000000)

	lateC := st.anvil.Transfer(st.token, cReceive, amount)
	matches(c, cReceive, 5000000)
	matches(d, dReceive, 1000000)
	matches(e, eReceive, 5000000)
	// D holds less than its amount: nothing of it comes out before the settle deadline.
	if out, err := run("return", "-tx", partD, d); err == nil || !strings.Contains(out, "returns nothing yet") {
		t.Fatalf("D returned before its deadline: %v\n%s", err, out)
	}

	// Past the settle deadlines: nothing was settled to the creator, so all of it is refundable.
	st.anvil.Wait(8 * 24 * 3600)
	st.anvil.Mine(3)
	for _, r := range []struct {
		id, receive, tx, reason string
		held                    int64
		shown                   string
	}{
		{c, cReceive, lateC, "late", 5000000, "5.00 USDC"},
		{d, dReceive, partD, "expired", 1000000, "1.00 USDC"},
		{e, eReceive, paidE, "canceled", 5000000, "5.00 USDC"},
	} {
		caseShows(r.id, "Held for the payer: "+r.shown+" ("+r.reason+")", "refundable now "+r.shown)
		before = payer()
		send(ops("return", "-tx", r.tx, r.id))
		matches(r.id, r.receive, 0)
		returned(before, r.held)
	}

	// Another token at E's address: ops case finds it by its transaction and the recover sends it back.
	other := st.anvil.DeployToken()
	st.anvil.Mint(other, "5000000")
	stray := st.anvil.Transfer(other, eReceive, "2000000")
	st.anvil.Mine(3)
	printed := ops("case", stray)
	if !strings.Contains(printed, "recover(address,address,uint256)") {
		t.Fatalf("case of another token:\n%s", printed)
	}
	send(printed)
	if got, back := onChain(other, eReceive), onChain(other, chaintest.Sender); got != 0 || back != 5000000 {
		t.Fatalf("other token: E's address holds %d, the payer has %d of 5.00", got, back)
	}

	// Only A ever settled, and the creator has only its amount.
	if err := st.conn.QueryRow(ctx, "SELECT count(*) FROM settlement_intents").Scan(&settles); err != nil || settles != 1 {
		t.Fatalf("%d settlement intents (%v), want A's alone", settles, err)
	}
	if got := onChain(st.token, wallet); got != 5000000 {
		t.Fatalf("creator wallet %d, want A's 5.00 alone", got)
	}
}
