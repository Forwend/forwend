package settlement

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"

	"github.com/ensp1re/forwend/apps/backend/internal/ledger"
	"github.com/ethereum/go-ethereum"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/ethereum/go-ethereum/ethclient"
)

// reconcile finishes a sent settle. Our own receipt decides first: a settle that succeeded and logged the receiver's
// Settled event is ours, keeps its hash and is booked once its block is final, whatever a lagging node says about
// settled() meanwhile. Without a receipt, unmined decides. A settle that reverted is recorded without our hash when
// the receiver is settled at the finalized block (another settler), waits while it is settled only at latest, and is
// otherwise signed again.
func (s *Signer) reconcile(ctx context.Context, client *ethclient.Client, in intent) error {
	tx := new(types.Transaction)
	hash := common.HexToHash(*in.txHash)
	receive := common.HexToAddress(in.receive)
	if err := tx.UnmarshalBinary(in.rawTx); err != nil || tx.Hash() != hash || tx.To() == nil || *tx.To() != receive ||
		!bytes.Equal(tx.Data(), settleSelector) || tx.ChainId().Uint64() != in.chainID {
		return fmt.Errorf("saved transaction %s is not this receiver's settle on chain %d", *in.txHash, in.chainID)
	}
	r, err := client.TransactionReceipt(ctx, hash)
	if errors.Is(err, ethereum.NotFound) {
		if r, err = s.unmined(ctx, client, in, tx); err != nil || r == nil {
			return err
		}
	} else if err != nil {
		return fmt.Errorf("read settle receipt: %w", err)
	}
	if settledBy(r, receive) {
		return s.confirmIfFinal(ctx, client, in, r)
	}
	final, err := receiverSettled(ctx, client, receive, finalized)
	if err != nil {
		return err
	}
	if final {
		in.txHash = nil
		return s.confirm(ctx, in)
	}
	if now, err := receiverSettled(ctx, client, receive, nil); err != nil || now {
		return err
	}
	return s.retry(ctx, in, fmt.Sprintf("settle %s mined with status %d but the receiver is not settled", hash.Hex(), r.Status))
}

// unmined handles a saved settle without a receipt: not sent yet, waiting to be mined, dropped, or mined in a block
// the answering node has not seen. Reads at one finalized block decide for good: the receiver settled there while our
// nonce is still unused there is another settler's work (recorded without our hash); our nonce used there while the
// receiver is not settled means ours can never mine (signed again). Otherwise the saved bytes are sent again while
// their nonce is free and nobody settled, and the receipt is returned once mined. nil, nil ends this run's look.
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
		return nil, s.confirm(ctx, in)
	case final:
		// Ours, with a node that lags on receipts, or our nonce went to another transaction: wait for the receipt.
		slog.Warn("settlement waits for the receipt of its settle", "invoice", in.invoiceID, "tx", tx.Hash().Hex())
		return nil, nil
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
	if err := client.SendTransaction(ctx, tx); err != nil && !strings.Contains(strings.ToLower(err.Error()), "known") {
		return nil, fmt.Errorf("send settle: %w", err)
	}
	if s.stopAfter == "send" {
		return nil, errStopped
	}
	return s.await(ctx, client, tx.Hash())
}

// confirmIfFinal records the settlement once the receiver is settled at the finalized block (D-45) and, for our own
// settle r, once r's block is final too, with our hash; without r the settlement has no hash of ours. Until then the
// intent stays as it is and the next run looks again; a reorg that drops our settle before that leaves it without a
// receipt, handled like an unsent one.
func (s *Signer) confirmIfFinal(ctx context.Context, client *ethclient.Client, in intent, r *types.Receipt) error {
	head, err := client.HeaderByNumber(ctx, finalized)
	if err != nil {
		return fmt.Errorf("read finalized block: %w", err)
	}
	if r != nil && r.BlockNumber.Cmp(head.Number) > 0 {
		return nil
	}
	final, err := receiverSettled(ctx, client, common.HexToAddress(in.receive), head.Number)
	if err != nil || !final {
		return err
	}
	if r == nil {
		in.txHash = nil
	}
	return s.confirm(ctx, in)
}

// confirm records the settlement once: the intent, the ledger and the invoice, in one transaction.
func (s *Signer) confirm(ctx context.Context, in intent) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("confirm settlement: %w", err)
	}
	defer tx.Rollback(ctx)
	var status string
	if err := tx.QueryRow(ctx, "SELECT status FROM settlement_intents WHERE id = $1 FOR UPDATE", in.id).Scan(&status); err != nil {
		return fmt.Errorf("confirm settlement: %w", err)
	}
	if status == "confirmed" {
		return nil
	}
	if err := ledger.BookSettlement(ctx, tx, in.invoiceID, in.amount); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `
		WITH i AS (UPDATE settlement_intents SET status = 'confirmed', tx_hash = $3, updated_at = now() WHERE id = $1)
		UPDATE invoices SET settlement_status = 'settled' WHERE id = $2`, in.id, in.invoiceID, in.txHash); err != nil {
		return fmt.Errorf("confirm settlement: %w", err)
	}
	slog.Info("settled", "invoice", in.invoiceID, "amount", in.amount.String())
	return tx.Commit(ctx)
}

// retry puts the intent back to pending for a temporary condition, with a growing wait (1 min doubling, at most
// 1 h). A saved settle that can no longer mine is dropped so a new one is signed.
func (s *Signer) retry(ctx context.Context, in intent, reason string) error {
	slog.Warn("settlement waits", "invoice", in.invoiceID, "reason", reason)
	// Only from the status this attempt loaded: a stale attempt never moves an intent that went on.
	_, err := s.pool.Exec(ctx, `UPDATE settlement_intents SET status = 'pending', sender = NULL, nonce = NULL,
		tx_hash = NULL, raw_tx = NULL, reason = $2, attempts = attempts + 1, updated_at = now(),
		next_attempt_at = now() + least(interval '1 minute' * power(2, least(attempts, 6)), interval '1 hour')
		WHERE id = $1 AND status = $3`, in.id, reason, in.status)
	return err
}

// refuse stops an intent for good without sending anything; an operator reads the reason. Only for terms that
// don't match, or a settler other than this executor.
func (s *Signer) refuse(ctx context.Context, in intent, reason string) error {
	slog.Warn("settlement refused", "invoice", in.invoiceID, "reason", reason)
	_, err := s.pool.Exec(ctx, `UPDATE settlement_intents SET status = 'refused', reason = $2, updated_at = now()
		WHERE id = $1 AND status = $3`, in.id, reason, in.status)
	return err
}
