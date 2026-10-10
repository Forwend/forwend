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

// reconcile finishes a sent settle. The receiver's own settled flag decides: confirmed once it is set. Otherwise
// the saved bytes are sent again if their nonce is still free, or the intent goes back to pending.
func (s *Signer) reconcile(ctx context.Context, client *ethclient.Client, in intent) error {
	tx := new(types.Transaction)
	hash := common.HexToHash(*in.txHash)
	receive := common.HexToAddress(in.receive)
	if err := tx.UnmarshalBinary(in.rawTx); err != nil || tx.Hash() != hash || tx.To() == nil || *tx.To() != receive ||
		!bytes.Equal(tx.Data(), settleSelector) || tx.ChainId().Uint64() != in.chainID {
		return fmt.Errorf("saved transaction %s is not this receiver's settle on chain %d", *in.txHash, in.chainID)
	}
	settled, err := receiverSettled(ctx, client, receive, nil)
	if err != nil {
		return err
	}
	if settled {
		return s.confirmIfFinal(ctx, client, in)
	}
	if r, err := client.TransactionReceipt(ctx, hash); err == nil {
		// Mined but the receiver isn't settled: it reverted (e.g. paused). Try again later with a new transaction.
		return s.retry(ctx, in, fmt.Sprintf("settle %s mined with status %d but the receiver is not settled", hash.Hex(), r.Status))
	} else if !errors.Is(err, ethereum.NotFound) {
		return fmt.Errorf("read settle receipt: %w", err)
	}
	mined, err := client.NonceAt(ctx, common.HexToAddress(*in.sender), nil)
	if err != nil {
		return fmt.Errorf("read executor nonce: %w", err)
	}
	if int64(mined) > *in.nonce {
		// The nonce went to another transaction and ours can never mine: sign a new settle.
		return s.retry(ctx, in, "the saved settle's nonce was used by another transaction")
	}
	if err := client.SendTransaction(ctx, tx); err != nil && !strings.Contains(strings.ToLower(err.Error()), "known") {
		return fmt.Errorf("send settle: %w", err)
	}
	if s.stopAfter == "send" {
		return errStopped
	}
	if r, err := s.await(ctx, client, hash); err != nil || r == nil {
		return err // not mined yet: the next run reconciles again
	}
	settled, err = receiverSettled(ctx, client, receive, nil)
	if err != nil {
		return err
	}
	if settled {
		return s.confirmIfFinal(ctx, client, in)
	}
	return s.retry(ctx, in, "settle "+hash.Hex()+" mined but the receiver is not settled")
}

// confirmIfFinal records the settlement only once the receiver is settled at the finalized block (D-45). Until then
// the intent stays as it is and the next run looks again; a reorg that drops the settle is reconciled as unsent.
func (s *Signer) confirmIfFinal(ctx context.Context, client *ethclient.Client, in intent) error {
	final, err := receiverSettled(ctx, client, common.HexToAddress(in.receive), finalized)
	if err != nil || !final {
		return err
	}
	if in.txHash != nil {
		// The receiver can be settled once; if our saved settle reverted or never mined, another settler (the refund
		// authority after the deadline) did it, and the settlement has no hash of ours.
		r, err := client.TransactionReceipt(ctx, common.HexToHash(*in.txHash))
		if err != nil && !errors.Is(err, ethereum.NotFound) {
			return fmt.Errorf("read settle receipt: %w", err)
		}
		if r == nil || r.Status != types.ReceiptStatusSuccessful {
			in.txHash = nil
		}
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
