package settlement

import (
	"errors"
	"math/big"
	"slices"
	"strings"
	"testing"

	"github.com/ethereum/go-ethereum/common"
	"github.com/forwend/forwend/apps/backend/internal/address"
	"github.com/forwend/forwend/apps/backend/internal/chaintest"
	"github.com/forwend/forwend/apps/backend/internal/ledger"
)

func (e env) paymentHash(t *testing.T, id string) string {
	t.Helper()
	var hash string
	if err := e.pool.QueryRow(t.Context(), "SELECT tx_hash FROM chain_transfers WHERE invoice_id = $1", id).Scan(&hash); err != nil {
		t.Fatal(err)
	}
	return hash
}

func (e env) refundStatus(t *testing.T, id string) string {
	t.Helper()
	var status string
	if err := e.pool.QueryRow(t.Context(), "SELECT refund_status FROM invoices WHERE id = $1", id).Scan(&status); err != nil {
		t.Fatal(err)
	}
	return status
}

// round is the worker's: the watcher records what the chain did, then the ledger books it.
func (e env) round(t *testing.T) {
	t.Helper()
	e.anvil.Mine(2)
	if err := e.watch.Scan(t.Context()); err != nil {
		t.Fatal(err)
	}
	if err := e.ledger.ProcessChain(t.Context(), e.chainID); err != nil {
		t.Fatal(err)
	}
}

// send runs the calls as the refund authority, as `cast send` with the printed signature and arguments.
func (e env) send(r Return) {
	for _, c := range r.Calls {
		e.anvil.AsAuthority(strings.ToLower(c.To.Hex()), c.Signature, c.Args...)
	}
}

// PLAN 11.10.3: support returns an overpayment to the address that paid, once, and the money stays locked until then.
func TestSupportReturnsAnOverpaymentToItsSenderOnce(t *testing.T) {
	e := setup(t)
	ctx := t.Context()
	id, receive := e.paidInvoice(t)
	hash := e.paymentHash(t, id)
	payToken := strings.Repeat("ab", 32)
	if _, err := e.pool.Exec(ctx, "UPDATE invoices SET pay_token = $2 WHERE id = $1", id, payToken); err != nil {
		t.Fatal(err)
	}
	for _, ref := range []string{receive, hash, "https://forwend.com/pay/" + payToken, "https://forwend.com/embed/" + payToken + "?layout=full", payToken} {
		want := []CaseOption{{ID: id, ChainID: e.chainID}}
		if got, err := CaseOptions(ctx, e.pool, " "+ref+" "); err != nil || !slices.Equal(got, want) {
			t.Fatalf("case %s: %v, %v", ref, got, err)
		}
	}
	h, err := ReadHeld(ctx, e.pool, e.client, id)
	if err != nil {
		t.Fatal(err)
	}
	if h.Held.Int64() != 1000000 || h.Refundable.Int64() != 1000000 || !slices.Equal(h.Reasons, []string{ledger.HeldOverpaid}) ||
		len(h.Payments) != 1 || h.Payments[0].From != chaintest.Sender || h.Deployed {
		t.Fatalf("held %s refundable %s reasons %v payments %v deployed %v", h.Held, h.Refundable, h.Reasons, h.Payments, h.Deployed)
	}

	r, err := QueueReturn(ctx, e.pool, e.client, id, hash, nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	if r.To != common.HexToAddress(chaintest.Sender) || r.Amount.Int64() != 1000000 || len(r.Calls) != 2 || len(r.Warnings) != 0 {
		t.Fatalf("return %+v", r)
	}
	if _, err := QueueReturn(ctx, e.pool, e.client, id, hash, nil, nil); !errors.Is(err, ErrReturnQueued) {
		t.Fatalf("a second return of the same money: %v", err)
	}
	// The signer settles the paid amount meanwhile: booking it must not unlock the queued return.
	e.final(t, e.signer(t))
	e.round(t)
	var settlement string
	if err := e.pool.QueryRow(ctx, "SELECT settlement_status FROM invoices WHERE id = $1", id).Scan(&settlement); err != nil {
		t.Fatal(err)
	}
	if got := e.refundStatus(t, id); settlement != "settled" || got != "refund_pending" {
		t.Fatalf("after the settlement: settlement %s, refund %s", settlement, got)
	}
	e.send(r)
	e.round(t)
	if got := e.refundStatus(t, id); got != "refunded" {
		t.Fatalf("after the refund landed: %s", got)
	}
	if h, err := ReadHeld(ctx, e.pool, e.client, id); err != nil || h.Held.Sign() != 0 || h.Balance.Sign() != 0 {
		t.Fatalf("after: held %s balance %s, %v", h.Held, h.Balance, err)
	}
}

func TestSupportReturnRefusesWhatTheMoneyCantDo(t *testing.T) {
	e := setup(t)
	ctx := t.Context()
	id, receive := e.pay(t, 8)
	_, otherReceive := e.create(t, 10)
	hash := e.paymentHash(t, id)
	other := common.HexToAddress("0x000000000000000000000000000000000000dead")
	for _, c := range []struct {
		name   string
		tx     string
		to     *common.Address
		amount int64
		want   error
	}{
		{"an unknown payment", "0x" + strings.Repeat("ab", 32), nil, 0, ErrUnknownPayment},
		{"the receiver itself", hash, ptr(common.HexToAddress(receive)), 0, ErrDestination},
		{"the zero address", hash, &common.Address{}, 0, ErrDestination},
		{"the token", hash, ptr(common.HexToAddress(e.token)), 0, ErrDestination},
		{"the factory", hash, ptr(common.Address(address.Factory)), 0, ErrDestination},
		{"another invoice's receiver", hash, ptr(common.HexToAddress(otherReceive)), 0, ErrDestination},
		{"more than is held", hash, nil, 2000000, ErrTooMuch},
		{"under 0.10 USD", hash, nil, 99999, ErrTooLittle},
	} {
		var amount *big.Int
		if c.amount != 0 {
			amount = big.NewInt(c.amount)
		}
		if _, err := QueueReturn(ctx, e.pool, e.client, id, c.tx, c.to, amount); !errors.Is(err, c.want) {
			t.Errorf("%s: %v, want %v", c.name, err, c.want)
		}
	}
	if got := e.refundStatus(t, id); got != "held" {
		t.Fatalf("a refused return locked the money: %s", got)
	}

	// An exchange payer's own address, after support checked their proof (D-118); 0.10 USD is the least it sends.
	r, err := QueueReturn(ctx, e.pool, e.client, id, hash, &other, big.NewInt(100000))
	if err != nil || r.To != other || r.Amount.Int64() != 100000 || len(r.Warnings) != 1 {
		t.Fatalf("return to another address: %+v, %v", r, err)
	}
	if err := ReleaseReturn(ctx, e.pool, id); err != nil {
		t.Fatal(err)
	}
	// A contract destination, such as an exchange's or an app's, is allowed after a warning.
	contract := common.HexToAddress(e.anvil.DeployToken())
	if r, err := QueueReturn(ctx, e.pool, e.client, id, hash, &contract, big.NewInt(100000)); err != nil ||
		!slices.ContainsFunc(r.Warnings, func(w string) bool { return strings.Contains(w, "contract") }) {
		t.Fatalf("return to a contract: %+v, %v", r, err)
	}
	if err := ReleaseReturn(ctx, e.pool, id); err != nil {
		t.Fatal(err)
	}
	if err := ReleaseReturn(ctx, e.pool, id); !errors.Is(err, ErrNoReturnQueued) {
		t.Fatalf("a second release: %v", err)
	}
	if got := e.refundStatus(t, id); got != "held" {
		t.Fatalf("after release: %s", got)
	}
	// Support's actions on the payer's money stay in the invoice's history (D-92).
	var rows []string
	if err := e.pool.QueryRow(ctx, `SELECT array_agg(kind || ' ' || actor || ' ' || coalesce(data->>'amount', '') || ' ' ||
		coalesce(data->>'to', '') ORDER BY id) FROM history_events WHERE invoice_id = $1 AND kind LIKE 'invoice.return_%'`,
		id).Scan(&rows); err != nil {
		t.Fatal(err)
	}
	want := []string{"invoice.return_queued system 100000 " + strings.ToLower(other.Hex()), "invoice.return_released system  ",
		"invoice.return_queued system 100000 " + strings.ToLower(contract.Hex()), "invoice.return_released system  "}
	if !slices.Equal(rows, want) {
		t.Fatalf("history %q; want %q", rows, want)
	}
}

// The contract keeps an expired partial payment until its deadline, so the owner can still reopen the invoice (R-130).
func TestSupportReturnsAnExpiredPartialPaymentOnlyAfterItsDeadline(t *testing.T) {
	e := setup(t)
	ctx := t.Context()
	id, receive := e.createFor(t, 9, 60)
	e.anvil.Transfer(e.token, receive, "2000000")
	e.round(t)
	e.anvil.Wait(120)
	e.round(t) // Anvil's finalized block is two behind: the second round books the expiry
	e.round(t)
	hash := e.paymentHash(t, id)
	if _, err := QueueReturn(ctx, e.pool, e.client, id, hash, nil, nil); !errors.Is(err, ErrNotYet) {
		t.Fatalf("before the deadline: %v", err)
	}
	e.anvil.Wait(86400)
	e.anvil.Mine(1)
	r, err := QueueReturn(ctx, e.pool, e.client, id, hash, nil, nil)
	if err != nil || r.Amount.Int64() != 2000000 {
		t.Fatalf("after the deadline: %+v, %v", r, err)
	}
	e.send(r)
	e.round(t)
	if got := e.refundStatus(t, id); got != "refunded" {
		t.Fatalf("after the refund landed: %s", got)
	}
}

// Past the deadline of an invoice never settled, the contract lets the whole balance out, so the ledger is the only
// guard of the creator's money: a refund sent but not booked yet must stop the next return.
func TestSupportWaitsForASentRefundToBeBookedBeforeTheNextReturn(t *testing.T) {
	e := setup(t)
	ctx := t.Context()
	id, _ := e.paidInvoice(t)
	hash := e.paymentHash(t, id)
	e.anvil.Wait(3600 + 86400 + 60)
	e.anvil.Mine(1)
	r, err := QueueReturn(ctx, e.pool, e.client, id, hash, nil, nil)
	if err != nil || r.Amount.Int64() != 1000000 {
		t.Fatalf("first return: %+v, %v", r, err)
	}
	e.send(r)
	// Released by mistake before the watcher booked the refund.
	if err := ReleaseReturn(ctx, e.pool, id); err != nil {
		t.Fatal(err)
	}
	if _, err := QueueReturn(ctx, e.pool, e.client, id, hash, nil, nil); !errors.Is(err, ErrUnbooked) {
		t.Fatalf("a second return before the first was booked: %v", err)
	}
	e.round(t)
	if got := e.refundStatus(t, id); got != "refunded" {
		t.Fatalf("after the refund was booked: %s", got)
	}
}

func ptr[T any](v T) *T { return &v }
