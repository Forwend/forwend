package settlement

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/ethereum/go-ethereum"
	"github.com/forwend/forwend/apps/backend/internal/invoice"
	"math/big"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/ethereum/go-ethereum/rpc"
	"github.com/forwend/forwend/apps/backend/internal/activity"
	"github.com/forwend/forwend/apps/backend/internal/address"
	"github.com/forwend/forwend/apps/backend/internal/chaintest"
	"github.com/forwend/forwend/apps/backend/internal/ledger"
	"github.com/forwend/forwend/apps/backend/internal/search"
	"github.com/forwend/forwend/apps/backend/internal/watcher"
	"github.com/jackc/pgx/v5"
)

func (e env) deployReceiver(t *testing.T, id string) string {
	t.Helper()
	var receive string
	var expires, deadline int64
	if err := e.pool.QueryRow(t.Context(), "SELECT receive_address, expires_at, settle_deadline FROM invoices WHERE id = $1", id).Scan(&receive, &expires, &deadline); err != nil {
		t.Fatal(err)
	}
	e.anvil.AsAuthority(strings.ToLower(common.Address(address.Factory).Hex()),
		"deploy((bytes32,address,address,uint256,uint64,uint64,uint256))",
		fmt.Sprintf("(%s,%s,%s,5000000,%d,%d,%d)", id, wallet, e.token, expires, deadline, chaintest.ChainID))
	return receive
}

func TestAuthorityRefundReducesHeldFundsWithoutInventingSettlement(t *testing.T) {
	e := setup(t)
	id, receive := e.paidInvoice(t)
	e.deployReceiver(t, id)
	e.anvil.AsAuthority(receive, "refund(address,uint256)", wallet, "1000000")
	e.anvil.Mine(2)
	if err := e.watch.Scan(t.Context()); err != nil {
		t.Fatal(err)
	}
	if complete, err := e.watch.Receiver(t.Context(), id); err != nil || !complete {
		t.Fatalf("receiver evidence: complete=%v, %v", complete, err)
	}
	var observations int
	var checkpoint string
	if err := e.pool.QueryRow(t.Context(), "SELECT count(*) FROM receiver_outflows WHERE invoice_id = $1 AND kind = 'refund'", id).Scan(&observations); err != nil || observations != 1 {
		t.Fatalf("observations=%d, %v", observations, err)
	}
	if err := e.pool.QueryRow(t.Context(), "SELECT balance::text FROM receiver_scans WHERE invoice_id = $1", id).Scan(&checkpoint); err != nil || checkpoint != "5000000" {
		t.Fatalf("checkpoint=%s, %v", checkpoint, err)
	}
	if err := e.ledger.ProcessChain(t.Context(), e.chainID); err != nil {
		t.Fatal(err)
	}
	var held, payable, receiver string
	if err := e.pool.QueryRow(t.Context(), `SELECT
  (-coalesce(sum(x.amount) FILTER (WHERE x.account = 'payer_held'), 0))::text,
  (-coalesce(sum(x.amount) FILTER (WHERE x.account = 'recipient_payable'), 0))::text,
  coalesce(sum(x.amount) FILTER (WHERE x.account = 'receiver'), 0)::text
  FROM ledger_entries x JOIN ledger_transactions t ON t.id = x.transaction_id WHERE t.invoice_id = $1`, id).Scan(&held, &payable, &receiver); err != nil {
		t.Fatal(err)
	}
	if held != "0" || payable != "5000000" || receiver != "5000000" {
		t.Fatalf("confirmed authority refund missing from ledger: held=%s payable=%s receiver=%s; want 0,5000000,5000000", held, payable, receiver)
	}
	if e.balance(t, wallet) != 1000000 || e.balance(t, receive) != 5000000 {
		t.Fatal("independent chain balances disagree")
	}
}

func TestOfflinePurchaseAndExternalSettlementBookInChainOrder(t *testing.T) {
	e := setup(t)
	id, receive := e.create(t, 41)
	e.anvil.Transfer(e.token, receive, "6000000")
	e.deployReceiver(t, id)
	actual := e.anvil.Send(receive, "settle()")
	e.anvil.Mine(2)
	if err := e.watch.Scan(t.Context()); err != nil {
		t.Fatal(err)
	}
	for range 2 {
		if complete, err := e.watch.Receiver(t.Context(), id); err != nil || !complete {
			t.Fatalf("complete=%v, %v", complete, err)
		}
		if err := e.ledger.ProcessChain(t.Context(), e.chainID); err != nil {
			t.Fatal(err)
		}
	}
	got := e.invoice(t, id)
	if got.PaymentStatus != "paid" || got.SettlementStatus != "settled" || !strings.EqualFold(got.SettlementTxHash, actual) {
		t.Fatalf("offline purchase: payment=%s settlement=%s hash=%s; want paid,settled,%s", got.PaymentStatus, got.SettlementStatus, got.SettlementTxHash, actual)
	}
	var bookings, intents, events int
	if err := e.pool.QueryRow(t.Context(), `SELECT
  (SELECT count(*) FROM ledger_transactions WHERE invoice_id = $1 AND kind = 'settlement'),
  (SELECT count(*) FROM settlement_intents WHERE invoice_id = $1),
  (SELECT count(*) FROM history_events WHERE invoice_id = $1 AND kind = 'invoice.settled')`, id).Scan(&bookings, &intents, &events); err != nil {
		t.Fatal(err)
	}
	if bookings != 1 || intents != 0 || events != 1 {
		t.Fatalf("bookings=%d intents=%d events=%d; want 1,0,1", bookings, intents, events)
	}
	if e.balance(t, wallet) != 5000000 || e.balance(t, receive) != 1000000 {
		t.Fatal("independent balances disagree")
	}
}

func TestReturnedPartialFundingCannotAccumulateIntoPaid(t *testing.T) {
	e := setup(t)
	id, receive := e.createFor(t, 42, 60*24*3600)
	e.deployReceiver(t, id)
	e.anvil.Wait(24 * 3600)
	e.anvil.Transfer(e.token, receive, "3000000")
	e.anvil.Wait(31 * 24 * 3600)
	e.anvil.AsAuthority(receive, "refund(address,uint256)", chaintest.Sender, "3000000")
	e.anvil.Transfer(e.token, receive, "2000000")
	e.anvil.Mine(2)
	if err := e.watch.Scan(t.Context()); err != nil {
		t.Fatal(err)
	}
	if complete, err := e.watch.Receiver(t.Context(), id); err != nil || !complete {
		t.Fatalf("complete=%v, %v", complete, err)
	}
	if err := e.ledger.ProcessChain(t.Context(), e.chainID); err != nil {
		t.Fatal(err)
	}
	got := e.invoice(t, id)
	if got.PaymentStatus != "expired_partially_paid" {
		t.Fatalf("early receiver deadline passed: payment=%s; want expired_partially_paid", got.PaymentStatus)
	}
	var payable string
	var proof bool
	if err := e.pool.QueryRow(t.Context(), `SELECT
  (-coalesce((SELECT sum(e.amount) FROM ledger_entries e JOIN ledger_transactions t ON t.id = e.transaction_id
               WHERE t.invoice_id = $1 AND e.account = 'recipient_payable'),0))::text,
  EXISTS (SELECT 1 FROM receiver_funding WHERE invoice_id = $1)`, id).Scan(&payable, &proof); err != nil {
		t.Fatal(err)
	}
	if payable != "0" || proof || e.balance(t, receive) != 2000000 {
		t.Fatalf("payable=%s proof=%v; want zero payable, 2 held and no full funding proof", payable, proof)
	}
}

func TestRepeatedAuthorityReturnsConsumeHeldThenPayableAndBlockReopen(t *testing.T) {
	e := setup(t)
	id, receive := e.paidInvoice(t)
	e.deployReceiver(t, id)
	e.anvil.Wait(2 * 24 * 3600)
	for _, amount := range []string{"1000000", "2000000", "3000000"} {
		destination := chaintest.Sender
		if amount == "1000000" {
			destination = wallet
		}
		e.anvil.AsAuthority(receive, "refund(address,uint256)", destination, amount)
	}
	e.anvil.Mine(2)
	if err := e.watch.Scan(t.Context()); err != nil {
		t.Fatal(err)
	}
	for range 2 {
		if complete, err := e.watch.Receiver(t.Context(), id); err != nil || !complete {
			t.Fatalf("coverage complete=%v: %v", complete, err)
		}
		if err := e.ledger.ProcessChain(t.Context(), e.chainID); err != nil {
			t.Fatal(err)
		}
	}
	got, err := ledger.ReadAmounts(t.Context(), e.pool, id)
	if err != nil {
		t.Fatal(err)
	}
	if got.Receiver.Sign() != 0 || got.Payable.Sign() != 0 || got.Held.Sign() != 0 || got.Refunded.String() != "6000000" || got.Settled.Sign() != 0 || got.Unreconciled {
		t.Fatalf("returns: %+v", got)
	}
	var count, exceptions int
	if err := e.pool.QueryRow(t.Context(), `SELECT count(*), count(*) FILTER (WHERE policy_exception = 'refund_consumed_payable')
   FROM receiver_outflows WHERE invoice_id = $1 AND ledger_transaction_id IS NOT NULL`, id).Scan(&count, &exceptions); err != nil || count != 3 || exceptions != 2 {
		t.Fatalf("bookings=%d exceptions=%d: %v", count, exceptions, err)
	}
	tx, err := e.pool.Begin(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(t.Context())
	if err := ledger.Reopen(t.Context(), tx, id, e.anvil.Now()+3600); err == nil {
		t.Fatal("returned money reopened")
	}
	if e.balance(t, receive) != 0 || e.balance(t, wallet) != 1000000 {
		t.Fatal("return chain balances differ")
	}
	var profile string
	if err := e.pool.QueryRow(t.Context(), "SELECT profile_id FROM invoices WHERE id = $1", id).Scan(&profile); err != nil {
		t.Fatal(err)
	}
	page, err := activity.NewService(e.pool).Transfers(t.Context(), profile, "", 100, "", search.Query{})
	if err != nil || len(page.Items) != 1 || page.Items[0].Classification() != activity.ClassUnclassified || page.Items[0].Payment != nil {
		t.Fatalf("refund-to-wallet misclassified: %+v %v", page, err)
	}
	// A known full payment stays historically paid after a return; further deposits belong to the payer.
	e.anvil.Transfer(e.token, receive, "1000000")
	e.anvil.Mine(2)
	if err := e.watch.Scan(t.Context()); err != nil {
		t.Fatal(err)
	}
	if _, err := e.watch.Receiver(t.Context(), id); err != nil {
		t.Fatal(err)
	}
	if err := e.ledger.ProcessChain(t.Context(), e.chainID); err != nil {
		t.Fatal(err)
	}
	got, err = ledger.ReadAmounts(t.Context(), e.pool, id)
	if err != nil || got.Held.String() != "1000000" || got.Payable.Sign() != 0 || got.Receiver.String() != "1000000" {
		t.Fatalf("later funds: %+v %v", got, err)
	}
	if err := e.signer(t).Run(t.Context()); err != nil {
		t.Fatal(err)
	}
	var sent bool
	if err := e.pool.QueryRow(t.Context(), "SELECT raw_tx IS NOT NULL FROM settlement_intents WHERE invoice_id = $1", id).Scan(&sent); err != nil && err != pgx.ErrNoRows {
		t.Fatal(err)
	}
	if sent {
		t.Fatal("settlement signed against refunded payable")
	}
}

func TestReceiverCatchupDoesNotExpectFutureSettlementBeforeDeployment(t *testing.T) {
	e := setupChain(t, chaintest.StartArchive(t))
	id, receive := e.create(t, 43)
	if err := e.anvil.RPC.Call(nil, "anvil_mine", 10020); err != nil {
		t.Fatal(err)
	}
	e.anvil.Transfer(e.token, receive, "5000000")
	e.deployReceiver(t, id)
	e.anvil.Send(receive, "settle()")
	e.anvil.Mine(2)
	if err := e.watch.Scan(t.Context()); err != nil {
		t.Fatal(err)
	}
	caughtUp := false
	for range 6 {
		var err error
		caughtUp, err = e.watch.Receiver(t.Context(), id)
		if err != nil {
			t.Fatal(err)
		}
		if caughtUp {
			break
		}
	}
	if !caughtUp {
		t.Fatal("initial bounded catchup did not finish")
	}

	if err := e.ledger.ProcessChain(t.Context(), e.chainID); err != nil {
		t.Fatal(err)
	}
	if _, err := e.pool.Exec(t.Context(), `INSERT INTO chain_transfers (invoice_id,chain_id,chain_family,token_contract,tx_hash,
   log_index,block_hash,block_number,block_time,from_address,to_address,amount,status)
   SELECT id,chain_id,chain_family,token_contract,'0x' || repeat('43',32),0,'0x' || repeat('43',32),1,1,
   recipient_address,receive_address,1,'confirmed' FROM invoices WHERE id = $1`, id); err != nil {
		t.Fatal(err)
	}
	if complete, err := e.watch.Receiver(t.Context(), id); err != nil || complete {
		t.Fatalf("rewind complete=%v: %v", complete, err)
	}
	if complete, err := e.watch.Receiver(t.Context(), id); err != nil || complete {
		t.Fatalf("predeployment chunk complete=%v: %v", complete, err)
	}
	var progress uint64
	if err := e.pool.QueryRow(t.Context(), "SELECT scanned_block FROM receiver_scans WHERE invoice_id = $1", id).Scan(&progress); err != nil || progress != watcher.MaxRange {
		t.Fatalf("coverage=%d: %v", progress, err)
	}
	complete := false
	for range 6 {
		var err error
		complete, err = e.watch.Receiver(t.Context(), id)
		if err != nil {
			t.Fatal(err)
		}
		if complete {
			break
		}
	}
	if !complete {
		t.Fatal("bounded historical catchup did not finish")
	}
	var conflicts, outflows int
	if err := e.pool.QueryRow(t.Context(), `SELECT (SELECT count(*) FROM receiver_conflicts WHERE invoice_id = $1),
   (SELECT count(*) FROM receiver_outflows WHERE invoice_id = $1 AND ledger_transaction_id IS NOT NULL)`, id).Scan(&conflicts, &outflows); err != nil || conflicts != 1 || outflows != 1 {
		t.Fatalf("conflicts=%d booked=%d: %v", conflicts, outflows, err)
	}
	a, err := ledger.ReadAmounts(t.Context(), e.pool, id)
	if err != nil || !a.Unreconciled || a.Receiver.Sign() != 0 || a.Settled.String() != "5000000" {
		t.Fatalf("source conflict was hidden: %+v %v", a, err)
	}
}

func TestUnloggedFundingReturnStaysObservedWithoutInventedBooking(t *testing.T) {
	e := setup(t)
	id, receive := e.create(t, 44)
	e.deployReceiver(t, id)
	// Model an accepted-token balance credit without an ERC20 Transfer log, as a native credit can behave.
	slot := crypto.Keccak256Hash(common.LeftPadBytes(common.HexToAddress(receive).Bytes(), 32), make([]byte, 32))
	if err := e.anvil.RPC.Call(nil, "anvil_setStorageAt", e.token, slot.Hex(), fmt.Sprintf("0x%064x", 1000000)); err != nil {
		t.Fatal(err)
	}
	e.anvil.Wait(2 * 86400)
	e.anvil.AsAuthority(receive, "refund(address,uint256)", wallet, "1000000")
	e.anvil.Mine(2)
	if err := e.watch.Scan(t.Context()); err != nil {
		t.Fatal(err)
	}
	if complete, err := e.watch.Receiver(t.Context(), id); err != nil || !complete {
		t.Fatalf("complete=%v: %v", complete, err)
	}
	if err := e.ledger.ProcessChain(t.Context(), e.chainID); err != nil {
		t.Fatal(err)
	}
	a, err := ledger.ReadAmounts(t.Context(), e.pool, id)
	if err != nil || !a.Unreconciled || a.ObservedRefunded.String() != "1000000" || a.Refunded.Sign() != 0 || a.Receiver.Sign() != 0 {
		t.Fatalf("untracked credit: %+v %v", a, err)
	}
	var bookings int
	if err := e.pool.QueryRow(t.Context(), "SELECT count(*) FROM ledger_transactions WHERE invoice_id = $1", id).Scan(&bookings); err != nil || bookings != 0 {
		t.Fatalf("invented booking=%d %v", bookings, err)
	}
	if e.balance(t, receive) != 0 || e.balance(t, wallet) != 1000000 {
		t.Fatal("actual return balances differ")
	}
}

func TestAuthoritySettlementOfHeldFundsIsAnExceptionWithoutPaid(t *testing.T) {
	e := setup(t)
	id, receive := e.create(t, 45)
	e.anvil.Transfer(e.token, receive, "1000000")
	e.anvil.Wait(2 * 86400)
	e.anvil.Transfer(e.token, receive, "4000000")
	e.deployReceiver(t, id)
	e.anvil.AsAuthority(receive, "settle()")
	e.anvil.Mine(2)
	if err := e.watch.Scan(t.Context()); err != nil {
		t.Fatal(err)
	}
	if _, err := e.watch.Receiver(t.Context(), id); err != nil {
		t.Fatal(err)
	}
	for range 2 {
		if err := e.ledger.ProcessChain(t.Context(), e.chainID); err != nil {
			t.Fatal(err)
		}
	}
	got := e.invoice(t, id)
	if got.PaymentStatus == "paid" || got.SettlementStatus != "settled" {
		t.Fatalf("held settlement fabricated payment: %+v", got)
	}
	a, err := ledger.ReadAmounts(t.Context(), e.pool, id)
	if err != nil || !a.HasPolicyException || a.Unreconciled || a.Settled.String() != "5000000" || a.Held.Sign() != 0 || a.Payable.Sign() != 0 || a.Receiver.Sign() != 0 {
		t.Fatalf("held settlement: %+v %v", a, err)
	}
	var profile string
	if err := e.pool.QueryRow(t.Context(), "SELECT profile_id FROM invoices WHERE id = $1", id).Scan(&profile); err != nil {
		t.Fatal(err)
	}
	page, err := activity.NewService(e.pool).Transfers(t.Context(), profile, "", 100, "", search.Query{})
	if err != nil || len(page.Items) != 1 || page.Items[0].Classification() != activity.ClassPaymentException || !page.Items[0].Labelable() {
		t.Fatalf("held settlement disguised as income: %+v %v", page, err)
	}
	var paidEvents, settledEvents int
	if err := e.pool.QueryRow(t.Context(), `SELECT count(*) FILTER (WHERE kind = 'invoice.paid'),count(*) FILTER (WHERE kind = 'invoice.settled')
 FROM history_events WHERE invoice_id = $1`, id).Scan(&paidEvents, &settledEvents); err != nil || paidEvents != 0 || settledEvents != 0 {
		t.Fatalf("false ordinary events paid=%d settled=%d: %v", paidEvents, settledEvents, err)
	}
	if e.balance(t, wallet) != 5000000 || e.balance(t, receive) != 0 {
		t.Fatal("actual held settlement balances differ")
	}
}

func TestNativeRecoveryDoesNotCreateAcceptedTokenRefund(t *testing.T) {
	e := setup(t)
	id, receive := e.create(t, 46)
	e.deployReceiver(t, id)
	if err := e.anvil.RPC.Call(nil, "anvil_setBalance", receive, "0x100000"); err != nil {
		t.Fatal(err)
	}
	e.anvil.AsAuthority(receive, "recover(address,address,uint256)", common.Address{}.Hex(), wallet, "1048576")
	e.anvil.Mine(2)
	if complete, err := e.watch.Receiver(t.Context(), id); err != nil || !complete {
		t.Fatalf("complete=%v: %v", complete, err)
	}
	if err := e.ledger.ProcessChain(t.Context(), e.chainID); err != nil {
		t.Fatal(err)
	}
	a, err := ledger.ReadAmounts(t.Context(), e.pool, id)
	if err != nil || a.Unreconciled || a.Refunded.Sign() != 0 || a.ObservedRefunded.Sign() != 0 || a.Receiver.Sign() != 0 {
		t.Fatalf("native recovery booked as token: %+v %v", a, err)
	}
	var amount, reason, token string
	if err := e.pool.QueryRow(t.Context(), "SELECT amount::text,reconciliation_error,token_contract FROM receiver_outflows WHERE invoice_id = $1", id).Scan(&amount, &reason, &token); err != nil || amount != "1048576" || reason != "different_asset" || token != strings.ToLower(common.Address{}.Hex()) {
		t.Fatalf("native source=%s %s %s %v", amount, reason, token, err)
	}
}

func TestReceiverFinalizedReorgKeepsEvidenceAndRequiresReview(t *testing.T) {
	e := setup(t)
	id, receive := e.paidInvoice(t)
	e.deployReceiver(t, id)
	e.anvil.AsAuthority(receive, "refund(address,uint256)", wallet, "1000000")
	e.anvil.Mine(2)
	if _, err := e.watch.Receiver(t.Context(), id); err != nil {
		t.Fatal(err)
	}
	if err := e.ledger.ProcessChain(t.Context(), e.chainID); err != nil {
		t.Fatal(err)
	}
	e.anvil.Reorg(3)
	e.anvil.Mine(2)
	if _, err := e.watch.Receiver(t.Context(), id); err == nil {
		t.Fatal("changed finalized history accepted")
	}
	a, err := ledger.ReadAmounts(t.Context(), e.pool, id)
	if err != nil || !a.Unreconciled || a.Refunded.String() != "1000000" || a.Receiver.String() != "5000000" {
		t.Fatalf("finalized history silently rewritten: %+v %v", a, err)
	}
}

func TestOneAuthorityTransactionRefundsTwiceWithDistinctTransferProofs(t *testing.T) {
	e := setup(t)
	id, receive := e.create(t, 47)
	e.anvil.Transfer(e.token, receive, "7000000")
	e.deployReceiver(t, id)
	dir := t.TempDir()
	source, err := os.ReadFile("testdata/RefundBatch.sol")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(filepath.Join(dir, "src"), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "src/RefundBatch.sol"), source, 0600); err != nil {
		t.Fatal(err)
	}
	cmd := exec.Command("forge", "inspect", "src/RefundBatch.sol:RefundBatch", "deployedBytecode", "--root", dir)
	output, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("compile authority fixture: %v %s", err, output)
	}
	factory := common.Address(address.Factory)
	authority, err := e.client.CallContract(t.Context(), ethereum.CallMsg{To: &factory, Data: crypto.Keccak256([]byte("refundAuthority()"))[:4]}, nil)
	if err != nil || len(authority) != 32 {
		t.Fatalf("authority: %x %v", authority, err)
	}
	authorityAddress := common.BytesToAddress(authority).Hex()
	if err := e.anvil.RPC.Call(nil, "anvil_setCode", authorityAddress, strings.TrimSpace(string(output))); err != nil {
		t.Fatal(err)
	}
	e.anvil.Send(authorityAddress, "refundTwice(address,address,uint256)", receive, wallet, "1000000")
	e.anvil.Mine(2)
	if err := e.watch.Scan(t.Context()); err != nil {
		t.Fatal(err)
	}
	proxy := e.anvil.Proxy()
	proxy.Stale(func(c chaintest.Call) json.RawMessage {
		if c.Method != "eth_getLogs" {
			return nil
		}
		var logs []types.Log
		if err := e.anvil.RPC.CallContext(t.Context(), &logs, c.Method, c.Params[0]); err != nil {
			t.Error(err)
			return nil
		}
		slices.Reverse(logs)
		raw, err := json.Marshal(logs)
		if err != nil {
			t.Error(err)
		}
		return raw
	})
	client, err := rpc.Dial(proxy.URL)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(client.Close)
	e.watch = watcher.NewChain(e.pool, e.chainID, client)
	for range 2 {
		if complete, err := e.watch.Receiver(t.Context(), id); err != nil || !complete {
			t.Fatalf("complete=%v: %v", complete, err)
		}
		if err := e.ledger.ProcessChain(t.Context(), e.chainID); err != nil {
			t.Fatal(err)
		}
	}
	var count, proofs, transactions int
	if err := e.pool.QueryRow(t.Context(), `SELECT count(*),count(DISTINCT transfer_log_index),count(DISTINCT tx_hash)
   FROM receiver_outflows WHERE invoice_id = $1 AND kind = 'refund' AND ledger_transaction_id IS NOT NULL`, id).Scan(&count, &proofs, &transactions); err != nil || count != 2 || proofs != 2 || transactions != 1 {
		t.Fatalf("source matches count=%d proofs=%d transactions=%d %v", count, proofs, transactions, err)
	}
	a, err := ledger.ReadAmounts(t.Context(), e.pool, id)
	if err != nil || a.Unreconciled || a.Refunded.String() != "2000000" || a.Payable.String() != "5000000" || a.Held.Sign() != 0 || a.Receiver.String() != "5000000" {
		t.Fatalf("batch returns: %+v %v", a, err)
	}
	if e.balance(t, wallet) != 2000000 || e.balance(t, receive) != 5000000 {
		t.Fatal("batch return chain balances differ")
	}
}

func TestLateReturnedOptionDoesNotChooseOrCloseAnotherOpenOption(t *testing.T) {
	e := setup(t)
	main, mainReceive := e.createFor(t, 48, 60*86400)
	id := fmt.Sprintf("0x%064x", 49)
	var expires, deadline uint64
	if err := e.pool.QueryRow(t.Context(), "SELECT expires_at,settle_deadline FROM invoices WHERE id = $1", main).Scan(&expires, &deadline); err != nil {
		t.Fatal(err)
	}
	terms := address.Terms{InvoiceID: [32]byte(common.FromHex(id)), Recipient: common.HexToAddress(wallet), Token: common.HexToAddress(e.token),
		Amount: big.NewInt(5000000), ExpiresAt: expires, SettleDeadline: deadline, IntendedChainID: e.chainID}
	predicted, err := address.Receive(terms)
	if err != nil {
		t.Fatal(err)
	}
	receive := strings.ToLower(common.Address(predicted).Hex())
	if _, err := e.pool.Exec(t.Context(), `INSERT INTO invoices (id,main_id,profile_id,chain_id,chain_family,token_contract,amount,
   expires_at,settle_deadline,recipient_address,receive_method,factory_address,receive_address,idempotency_key,request_hash)
   SELECT $2,id,profile_id,chain_id,chain_family,token_contract,amount,expires_at,settle_deadline,recipient_address,
   receive_method,factory_address,$3,idempotency_key,request_hash FROM invoices WHERE id = $1`, main, id, receive); err != nil {
		t.Fatal(err)
	}
	e.deployReceiver(t, main)
	e.anvil.Wait(31 * 86400)
	e.anvil.Transfer(e.token, mainReceive, "1000000")
	e.anvil.AsAuthority(mainReceive, "refund(address,uint256)", wallet, "1000000")
	e.anvil.Mine(2)
	observe := func() {
		t.Helper()
		if err := e.watch.Scan(t.Context()); err != nil {
			t.Fatal(err)
		}
		for _, option := range []string{main, id} {
			if _, err := e.watch.Receiver(t.Context(), option); err != nil {
				t.Fatal(err)
			}
		}
		if err := e.ledger.ProcessChain(t.Context(), e.chainID); err != nil {
			t.Fatal(err)
		}
	}
	observe()
	var chosen *string
	var status string
	if err := e.pool.QueryRow(t.Context(), "SELECT chosen_id,payment_status FROM invoices WHERE id = $1", main).Scan(&chosen, &status); err != nil || chosen != nil || status == "expired" {
		t.Fatalf("late return closed/selected checkout: chosen=%v status=%s %v", chosen, status, err)
	}
	a, err := ledger.ReadAmounts(t.Context(), e.pool, main)
	if err != nil || a.Unreconciled || a.Refunded.String() != "1000000" || a.Held.Sign() != 0 || a.Payable.Sign() != 0 {
		t.Fatalf("late option return: %+v %v", a, err)
	}
	e.anvil.Transfer(e.token, receive, "5000000")
	e.anvil.Mine(2)
	observe()
	if err := e.pool.QueryRow(t.Context(), "SELECT chosen_id FROM invoices WHERE id = $1", main).Scan(&chosen); err != nil || chosen == nil || *chosen != id {
		t.Fatalf("available option could not win: %v %v", chosen, err)
	}
	got := e.invoice(t, main)
	if got.PaymentStatus != "paid" {
		t.Fatalf("other option payment: %s", got.PaymentStatus)
	}
	if e.balance(t, mainReceive) != 0 || e.balance(t, receive) != 5000000 || e.balance(t, wallet) != 1000000 {
		t.Fatal("multi-option source balances differ")
	}
}

func TestLegacyAllocationConflictPreservesBalancesAndUnbookedReturn(t *testing.T) {
	e := setup(t)
	id, receive := e.createFor(t, 50, 60*86400)
	e.deployReceiver(t, id)
	e.anvil.Transfer(e.token, receive, "3000000")
	e.anvil.Wait(31 * 86400)
	e.anvil.AsAuthority(receive, "refund(address,uint256)", wallet, "3000000")
	e.anvil.Transfer(e.token, receive, "2000000")
	e.anvil.Mine(2)
	if err := e.watch.Scan(t.Context()); err != nil {
		t.Fatal(err)
	}
	// Existing primary-only allocations are immutable migration input; no complete receiver evidence existed yet.
	if err := e.ledger.Process(t.Context(), id); err != nil {
		t.Fatal(err)
	}
	before, err := ledger.ReadAmounts(t.Context(), e.pool, id)
	if err != nil {
		t.Fatal(err)
	}
	if before.Payable.String() != "5000000" || before.Receiver.String() != "5000000" {
		t.Fatalf("legacy setup: %+v", before)
	}
	if _, err := e.watch.Receiver(t.Context(), id); err != nil {
		t.Fatal(err)
	}
	if err := e.ledger.ProcessChain(t.Context(), e.chainID); err != nil {
		t.Fatal(err)
	}
	after, err := ledger.ReadAmounts(t.Context(), e.pool, id)
	if err != nil || !after.Unreconciled || after.ObservedRefunded.String() != "3000000" || after.Refunded.Sign() != 0 ||
		after.Payable.Cmp(before.Payable) != 0 || after.Receiver.Cmp(before.Receiver) != 0 {
		t.Fatalf("legacy allocations rewritten: %+v %v", after, err)
	}
	if e.balance(t, receive) != 2000000 || e.balance(t, wallet) != 3000000 {
		t.Fatal("legacy conflict chain evidence differs")
	}
}

func TestConcurrentReceiverScanAndLegacyConflictBookingFinishTogether(t *testing.T) {
	e := setup(t)
	id, _ := e.create(t, 51)
	if _, err := e.pool.Exec(t.Context(), `WITH movement AS (INSERT INTO ledger_transactions (invoice_id,kind)
   VALUES ($1,'expiry') RETURNING id) INSERT INTO ledger_entries (transaction_id,account,amount)
   SELECT id,'payer_held',1 FROM movement UNION ALL SELECT id,'recipient_payable',-1 FROM movement`, id); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(t.Context(), 5*time.Second)
	defer cancel()
	failures := make(chan error, 6)
	for range 3 {
		go func() { _, err := e.watch.Receiver(ctx, id); failures <- err }()
		go func() { failures <- e.ledger.Process(ctx, id) }()
	}
	for range 6 {
		if err := <-failures; err != nil {
			t.Fatal(err)
		}
	}
	var reason string
	var complete bool
	if err := e.pool.QueryRow(t.Context(), "SELECT booking_error,history_complete FROM receiver_scans WHERE invoice_id = $1", id).Scan(&reason, &complete); err != nil || reason != "negative_legacy_balance" || !complete {
		t.Fatalf("concurrent outcome reason=%s complete=%v: %v", reason, complete, err)
	}
}

func TestBroadcastSettlementReconcilesAfterAnAuthorityReturn(t *testing.T) {
	e := setup(t)
	id, receive := e.paidInvoice(t)
	signer := e.signer(t)
	signer.stopAfter = "send"
	if err := signer.Run(t.Context()); !errors.Is(err, errStopped) {
		t.Fatalf("after broadcast: %v", err)
	}
	saved, _ := e.saved(t, id)
	e.anvil.Mine(1)
	e.anvil.AsAuthority(receive, "refund(address,uint256)", wallet, "1000000")
	e.anvil.Mine(2)
	if err := e.watch.Scan(t.Context()); err != nil {
		t.Fatal(err)
	}
	if _, err := e.watch.Receiver(t.Context(), id); err != nil {
		t.Fatal(err)
	}
	if err := e.signer(t).Run(t.Context()); err != nil {
		t.Fatal(err)
	}
	got := e.invoice(t, id)
	if got.SettlementStatus != "settled" || !strings.EqualFold(got.SettlementTxHash, saved) {
		t.Fatalf("broadcast transaction lost: %+v saved=%s", got, saved)
	}
	a, err := ledger.ReadAmounts(t.Context(), e.pool, id)
	if err != nil || a.Unreconciled || a.Settled.String() != "5000000" || a.Refunded.String() != "1000000" || a.Receiver.Sign() != 0 || a.Payable.Sign() != 0 || a.Held.Sign() != 0 {
		t.Fatalf("broadcast and return: %+v %v", a, err)
	}
	if e.balance(t, wallet) != 6000000 || e.balance(t, receive) != 0 {
		t.Fatal("broadcast plus return chain balances differ")
	}
}

func TestReopenWaitsForCurrentCoverageBeforeDiscoveringAConfirmedReturn(t *testing.T) {
	e := setup(t)
	var profile string
	if err := e.pool.QueryRow(t.Context(), "SELECT id FROM profiles LIMIT 1").Scan(&profile); err != nil {
		t.Fatal(err)
	}
	service := invoice.NewService(e.pool)
	inv, _, err := service.Create(t.Context(), profile, "reopen-return-race", invoice.Request{ChainID: e.chainID, Token: e.token, Amount: "5000000"})
	if err != nil {
		t.Fatal(err)
	}
	e.anvil.Transfer(e.token, inv.ReceiveAddress, "1000000")
	e.anvil.Wait(3700)
	e.anvil.Transfer(e.token, inv.ReceiveAddress, "5000000")
	e.anvil.Mine(2)
	if err := e.watch.Scan(t.Context()); err != nil {
		t.Fatal(err)
	}
	if _, err := e.watch.Receiver(t.Context(), inv.ID); err != nil {
		t.Fatal(err)
	}
	if err := e.ledger.ProcessChain(t.Context(), e.chainID); err != nil {
		t.Fatal(err)
	}
	if position, err := ledger.ReadReopenPosition(t.Context(), e.pool, inv.ID); err != nil || position == nil {
		t.Fatalf("initial verified checkpoint unavailable: %v %v", position, err)
	}
	e.deployReceiver(t, inv.ID)
	e.anvil.AsAuthority(inv.ReceiveAddress, "refund(address,uint256)", wallet, "1000000")
	e.anvil.Mine(2)
	if err := e.watch.Scan(t.Context()); err != nil {
		t.Fatal(err)
	}
	if _, err := service.Reopen(t.Context(), profile, inv.ID); !errors.Is(err, ledger.ErrReconciliationPending) {
		t.Fatalf("stale coverage reopened funds: %v", err)
	}
	if _, err := e.watch.Receiver(t.Context(), inv.ID); err != nil {
		t.Fatal(err)
	}
	if err := e.ledger.ProcessChain(t.Context(), e.chainID); err != nil {
		t.Fatal(err)
	}
	if _, err := service.Reopen(t.Context(), profile, inv.ID); !errors.Is(err, invoice.ErrNotReopenable) {
		t.Fatalf("known return reopened: %v", err)
	}
	a, err := ledger.ReadAmounts(t.Context(), e.pool, inv.ID)
	if err != nil || a.Unreconciled || a.Held.String() != "5000000" || a.Payable.Sign() != 0 || a.Refunded.String() != "1000000" || a.HasPolicyException {
		t.Fatalf("stale checkpoint invented allocation: %+v %v", a, err)
	}
}
