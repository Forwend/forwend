package settlement

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"log/slog"
	"math/big"
	"strings"
	"time"

	"github.com/ethereum/go-ethereum"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/common/hexutil"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/ethereum/go-ethereum/ethclient"
	"github.com/forwend/forwend/apps/backend/internal/ledger"
	"github.com/forwend/forwend/apps/backend/internal/watcher"
	"github.com/jackc/pgx/v5"
)

// reconcile: our receipt (any version) with the Settled log decides first, whatever a lagging node says. A reverted
// settle is recorded without our hash if settled at the finalized block, waits if only at latest, else is re-signed.
func (s *Signer) reconcile(ctx context.Context, client *ethclient.Client, in intent) error {
	tx := new(types.Transaction)
	hash := common.HexToHash(*in.txHash)
	receive := common.HexToAddress(in.receive)
	if err := tx.UnmarshalBinary(in.rawTx); err != nil || tx.Hash() != hash || tx.To() == nil || *tx.To() != receive ||
		!bytes.Equal(tx.Data(), settleSelector) || tx.ChainId().Uint64() != in.chainID {
		return fmt.Errorf("saved transaction %s is not this receiver's settle on chain %d", *in.txHash, in.chainID)
	}
	var r *types.Receipt
	for _, h := range append([]string{*in.txHash}, in.replaced...) { // one nonce: at most one of them is mined
		got, err := client.TransactionReceipt(ctx, common.HexToHash(h))
		if errors.Is(err, ethereum.NotFound) {
			continue
		}
		if err != nil {
			return fmt.Errorf("read settle receipt: %w", err)
		}
		r = got
		break
	}
	if r == nil || !settledBy(r, receive) {
		if _, err := s.pool.Exec(ctx, `UPDATE settlement_intents SET receipt_tx_hash = NULL,
 receipt_block = NULL, receipt_time = NULL WHERE id = $1`, in.id); err != nil {
			return err
		}
	}
	var err error
	if r == nil {
		if r, err = s.unmined(ctx, client, in, tx); err != nil || r == nil {
			return err
		}
	}
	if settledBy(r, receive) {
		mined := r.TxHash.Hex()
		in.txHash = &mined
		return s.confirmIfFinal(ctx, client, in, r)
	}
	final, err := receiverSettled(ctx, client, receive, finalized)
	if err != nil {
		return err
	}
	if final {
		in.txHash = nil
		return s.confirm(ctx, in, nil)
	}
	if now, err := receiverSettled(ctx, client, receive, nil); err != nil || now {
		return err
	}
	return s.retry(ctx, in, fmt.Sprintf("settle %s mined with status %d but the receiver is not settled", r.TxHash.Hex(), r.Status))
}

// unmined decides for good at one finalized block: settled with our nonce unused there is another settler's work;
// our nonce used there while unsettled means ours never mines. Otherwise it resends, or replaces after ReplaceAfter.
func (s *Signer) unmined(ctx context.Context, client *ethclient.Client, in intent, tx *types.Transaction) (*types.Receipt, error) {
	sender, receive := common.HexToAddress(*in.sender), common.HexToAddress(in.receive)
	head, err := client.HeaderByNumber(ctx, finalized)
	if err != nil {
		return nil, fmt.Errorf("read finalized block: %w", err)
	}
	final, err := receiverSettled(ctx, client, receive, head.Number)
	if err != nil {
		return nil, err
	}
	used, err := client.NonceAt(ctx, sender, head.Number)
	if err != nil {
		return nil, fmt.Errorf("read executor nonce: %w", err)
	}
	taken := int64(used) > *in.nonce
	switch {
	case final && !taken:
		in.txHash = nil
		return nil, s.confirm(ctx, in, nil)
	case final:
		// Ours, with a node that lags on receipts, or our nonce went to another transaction: wait for the receipt.
		return nil, s.stall(ctx, in, "no receipt for any of its settle's hashes, but the receiver is settled and "+
			"the executor's nonce is used at the finalized block")
	case taken:
		return nil, s.retry(ctx, in, "the saved settle's nonce was used by another transaction")
	}
	mined, err := client.NonceAt(ctx, sender, nil)
	if err != nil {
		return nil, fmt.Errorf("read executor nonce: %w", err)
	}
	settled, err := receiverSettled(ctx, client, receive, nil)
	if err != nil || settled || int64(mined) > *in.nonce {
		return nil, err // settled, or the nonce used, after the finalized block: decided once that is final
	}
	// The bytes and terms come from the database: never send again, or re-sign with our key, a settle its sender didn't
	// sign or one to an address the terms don't compute. Reading receipts and confirming above need neither.
	if from, err := types.Sender(types.LatestSignerForChainID(tx.ChainId()), tx); err != nil ||
		from != common.HexToAddress(*in.sender) {
		return nil, fmt.Errorf("saved transaction %s is not signed by its sender", *in.txHash)
	}
	if _, reason := receiverTerms(in); reason != "" {
		return nil, fmt.Errorf("saved transaction %s: %s", *in.txHash, reason)
	}
	if sender == s.sender && int64(mined) < *in.nonce {
		if err := s.fillGap(ctx, client, in.chainID, mined); err != nil {
			return nil, err
		}
	}
	if sender == s.sender && time.Since(in.signedAt) >= s.replaceAfter {
		// Out of gas money a higher fee changes nothing: this version is kept until the executor is funded.
		if err := client.SendTransaction(ctx, tx); err != nil && strings.Contains(strings.ToLower(err.Error()), "insufficient funds") {
			return nil, fmt.Errorf("send settle: %w", err)
		}
		if tx, err = s.replace(ctx, client, in, tx); err != nil {
			return nil, err
		}
	}
	if err := client.SendTransaction(ctx, tx); err != nil && !holds(err) {
		// The nonce was used meanwhile, by a version of this settle (sent again above, it may mine first) or another
		// transaction: the next round decides, as when it is found used before sending.
		if now, nerr := client.NonceAt(ctx, sender, nil); nerr == nil && int64(now) > *in.nonce {
			return nil, nil
		}
		return nil, fmt.Errorf("send settle: %w", err)
	}
	if s.stopAfter == "send" {
		return nil, errStopped
	}
	if int64(mined) < *in.nonce {
		return nil, nil // a lower nonce mines first: waiting here would hold up the chain's other settles
	}
	return s.await(ctx, client, tx.Hash())
}

// "already known" on geth and reth, "AlreadyKnown" on Nethermind, "transaction already imported" on Anvil. Not just
// "known": "unknown account" is a real error.
func holds(err error) bool {
	msg := strings.ToLower(err.Error())
	for _, known := range []string{"already known", "alreadyknown", "already imported"} {
		if strings.Contains(msg, known) {
			return true
		}
	}
	return false
}

// fillGap sends a zero-value self-transfer at nonce when nothing else will use it (a settle saved but never sent,
// settled meanwhile by the refund authority): a nonce gap holds every later transaction on the chain.
func (s *Signer) fillGap(ctx context.Context, client *ethclient.Client, chainID uint64, nonce uint64) error {
	pending, err := client.PendingNonceAt(ctx, s.sender)
	if err != nil || pending > nonce {
		return err
	}
	var saved bool
	if err := s.pool.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM settlement_intents si JOIN invoices i ON i.id = si.invoice_id
		WHERE i.chain_id = $1 AND si.sender = $2 AND si.nonce = $3 AND si.status = 'sent')`,
		int64(chainID), strings.ToLower(s.sender.Hex()), int64(nonce)).Scan(&saved); err != nil || saved {
		return err
	}
	tip, feeCap, err := Fees(ctx, client, chainID)
	if err != nil {
		return err
	}
	tx, err := types.SignTx(types.NewTx(&types.DynamicFeeTx{ChainID: new(big.Int).SetUint64(chainID), Nonce: nonce,
		GasTipCap: tip, GasFeeCap: feeCap, Gas: 21_000, To: &s.sender}),
		types.LatestSignerForChainID(new(big.Int).SetUint64(chainID)), s.key)
	if err != nil {
		return fmt.Errorf("sign nonce filler: %w", err)
	}
	slog.Warn("filling a nonce gap", "chain", chainID, "nonce", nonce, "tx", tx.Hash().Hex())
	if err := client.SendTransaction(ctx, tx); err != nil {
		return fmt.Errorf("send nonce filler: %w", err)
	}
	return nil
}

// FinalWait bounds how long a mined settle waits before its block is read again for finality.
const FinalWait = 10 * time.Minute

// Records only once the receiver is settled at the finalized block (D-45) and r's block, if any, is final.
// A reorg that drops our settle first leaves it without a receipt, handled like an unsent one.
func (s *Signer) confirmIfFinal(ctx context.Context, client *ethclient.Client, in intent, r *types.Receipt) error {
	head, err := client.HeaderByNumber(ctx, finalized)
	if err != nil {
		return fmt.Errorf("read finalized block: %w", err)
	}
	var block uint64 // the receipt's block time
	if r != nil {
		header, err := client.HeaderByHash(ctx, r.BlockHash)
		if err != nil {
			return fmt.Errorf("read settlement receipt block: %w", err)
		}
		if header.Number.Cmp(r.BlockNumber) != 0 {
			return fmt.Errorf("settlement receipt block number disagrees with header")
		}
		block = header.Time
		// This observation is display-only; finality and the booked settlement decide settled.
		if _, err := s.pool.Exec(ctx, `UPDATE settlement_intents SET receipt_tx_hash = $2,
 receipt_block = $3, receipt_time = $4 WHERE id = $1
 AND (receipt_tx_hash, receipt_block, receipt_time) IS DISTINCT FROM ($2, $3, $4)`, in.id, r.TxHash.Hex(),
			r.BlockNumber.Uint64(), block); err != nil {
			return err
		}
	}
	if r != nil && r.BlockNumber.Cmp(head.Number) > 0 {
		// The finalized block keeps pace with the clock: it reaches r's block about as far ahead as it trails it now.
		wait := min(time.Duration(block-min(head.Time, block))*time.Second, s.finalWait)
		_, err := s.pool.Exec(ctx, `UPDATE settlement_intents SET next_attempt_at = now() + $2 * interval '1 second'
			WHERE id = $1 AND status = 'sent'`, in.id, wait.Seconds())
		return err
	}
	final, err := receiverSettled(ctx, client, common.HexToAddress(in.receive), head.Number)
	if err != nil || !final {
		return err
	}
	if r == nil {
		in.txHash = nil
		return s.confirm(ctx, in, nil)
	}
	// The hash comes from the RPC, never computed in Go (Tempo's header differs): a stale receipt's block isn't recorded.
	var canonical struct{ Hash common.Hash }
	if err := client.Client().CallContext(ctx, &canonical, "eth_getBlockByNumber", hexutil.EncodeBig(r.BlockNumber), false); err != nil {
		return fmt.Errorf("read settlement block %s: %w", r.BlockNumber, err)
	}
	if canonical.Hash != r.BlockHash {
		return nil
	}
	return s.confirm(ctx, in, watcher.ReceiptOutflows(in.invoiceID, common.HexToAddress(in.receive), r, block, head.Number.Uint64()))
}

// confirm records our settle's events from its receipt, then books the invoice: the booked settlement confirms the
// intent. A receiver settled by another settler waits for the chain's scan to record its event.
func (s *Signer) confirm(ctx context.Context, in intent, outflows []watcher.Outflow) error {
	client := s.clients[in.chainID]
	if client == nil {
		return fmt.Errorf("no RPC for chain %d", in.chainID)
	}
	if len(outflows) > 0 {
		if err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
			return watcher.RecordOutflows(ctx, tx, in.chainID, outflows)
		}); err != nil {
			return fmt.Errorf("record settlement of invoice %s: %w", in.invoiceID, err)
		}
	}
	clients := map[uint64]*ethclient.Client{in.chainID: client}
	if err := ledger.NewService(s.pool, ledger.BalanceFrom(clients), ledger.DeployedFrom(clients)).Process(ctx, in.invoiceID); err != nil {
		return err
	}
	var confirmed bool
	if err := s.pool.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM receiver_outflows o WHERE o.invoice_id = $1
  AND o.kind = 'settlement' AND o.ledger_transaction_id IS NOT NULL)`, in.invoiceID).Scan(&confirmed); err != nil {
		return err
	}
	if confirmed {
		return nil
	}
	_, err := s.pool.Exec(ctx, `UPDATE settlement_intents SET reason = 'the receiver is settled; waiting for its settle to be booked',
  wait = $2, attempts = attempts + 1, next_attempt_at = `+backoff+`, updated_at = now()
  WHERE id = $1 AND status <> 'confirmed'`, in.id, waitRetry)
	return err
}

const backoff = "now() + least(interval '1 minute' * power(2, least(attempts, 6)), interval '1 hour')"

// Wait kinds stored with an intent for the invoice API (migration 00018); the reason text is for operators only.
const (
	waitRetry      = "retry"
	waitCap        = "cap"
	waitUnresolved = "unresolved"
)

// retry drops a saved settle that can no longer mine, with every version of it, so a new one is signed.
func (s *Signer) retry(ctx context.Context, in intent, reason string) error {
	return s.postpone(ctx, in, waitRetry, reason)
}

func (s *Signer) postpone(ctx context.Context, in intent, wait, reason string) error {
	slog.Warn("settlement waits", "invoice", in.invoiceID, "reason", reason)
	// Only from the status this attempt loaded: a stale attempt never moves an intent that went on. A dropped settle's
	// versions are kept in settlement_dropped: the executor signed them, and one may still have cost gas.
	_, err := s.pool.Exec(ctx, `WITH old AS (SELECT sender, nonce, tx_hash, raw_tx, replaced_hashes FROM settlement_intents
		    WHERE id = $1 AND status = $3 FOR UPDATE),
		moved AS (UPDATE settlement_intents SET status = 'pending', sender = NULL, nonce = NULL,
		tx_hash = NULL, raw_tx = NULL, replaced_hashes = '{}', signed_at = NULL, receipt_tx_hash = NULL, receipt_block = NULL, receipt_time = NULL, reason = $2, wait = $4,
		attempts = attempts + 1, updated_at = now(), next_attempt_at = `+backoff+` WHERE id = $1 AND status = $3 RETURNING id)
		INSERT INTO settlement_dropped (intent_id, sender, nonce, tx_hash, raw_tx, replaced_hashes, reason)
		SELECT $1, old.sender, old.nonce, old.tx_hash, old.raw_tx, old.replaced_hashes, $2 FROM old, moved
		WHERE old.tx_hash IS NOT NULL`,
		in.id, reason, in.status, wait)
	return err
}

// stall leaves the settle sent, shown in the operators' query (docs/backend/architecture.md#signer).
func (s *Signer) stall(ctx context.Context, in intent, reason string) error {
	slog.Warn("settlement unresolved", "invoice", in.invoiceID, "tx", *in.txHash, "reason", reason)
	_, err := s.pool.Exec(ctx, `UPDATE settlement_intents SET reason = $2, wait = $3, attempts = attempts + 1,
		updated_at = now(), next_attempt_at = `+backoff+` WHERE id = $1 AND status = 'sent'`, in.id, reason, waitUnresolved)
	return err
}

// refuse stops an intent for good without sending anything; an operator reads the reason. Only for terms that fail
// the database checks, or a receive address the factory doesn't predict.
func (s *Signer) refuse(ctx context.Context, in intent, reason string) error {
	slog.Warn("settlement refused", "invoice", in.invoiceID, "reason", reason)
	_, err := s.pool.Exec(ctx, `UPDATE settlement_intents SET status = 'refused', reason = $2, wait = NULL,
		updated_at = now() WHERE id = $1 AND status = $3`, in.id, reason, in.status)
	return err
}
