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

	"github.com/ensp1re/forwend/apps/backend/internal/history"
	"github.com/ensp1re/forwend/apps/backend/internal/ledger"
	"github.com/ensp1re/forwend/apps/backend/internal/outbox"
	"github.com/ethereum/go-ethereum"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/ethereum/go-ethereum/ethclient"
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
		return s.confirm(ctx, in)
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
		return nil, s.confirm(ctx, in)
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
	if sender == s.sender && int64(mined) < *in.nonce {
		if err := s.fillGap(ctx, client, in.chainID, mined); err != nil {
			return nil, err
		}
	}
	if sender == s.sender && time.Since(in.signedAt) >= s.replaceAfter {
		if tx, err = s.replace(ctx, client, in, tx); err != nil {
			return nil, err
		}
	}
	if err := client.SendTransaction(ctx, tx); err != nil && !holds(err) {
		return nil, fmt.Errorf("send settle: %w", err)
	}
	if s.stopAfter == "send" {
		return nil, errStopped
	}
	return s.await(ctx, client, tx.Hash())
}

// "already known" on most nodes, "transaction already imported" on Anvil.
func holds(err error) bool {
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "known") || strings.Contains(msg, "already imported")
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
	tip, feeCap, err := s.fees(ctx, client, chainID)
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

// Records only once the receiver is settled at the finalized block (D-45) and r's block, if any, is final.
// A reorg that drops our settle first leaves it without a receipt, handled like an unsent one.
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

func (s *Signer) confirm(ctx context.Context, in intent) error {
	// D-15: like paid, settled needs the second RPC to agree.
	second := s.seconds[in.chainID]
	if second == nil {
		return fmt.Errorf("chain %d: no second RPC to confirm the settlement of invoice %s", in.chainID, in.invoiceID)
	}
	head, err := second.HeaderByNumber(ctx, finalized)
	if err != nil {
		return fmt.Errorf("second RPC: read finalized block: %w", err)
	}
	agreed, err := receiverSettled(ctx, second, common.HexToAddress(in.receive), head.Number)
	if err != nil {
		return err
	}
	if !agreed {
		slog.Warn("settlement waits for the second RPC", "invoice", in.invoiceID, "chain", in.chainID)
		return nil
	}
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
	if err := outbox.Queue(ctx, tx, outbox.Settled, in.invoiceID, nil); err != nil {
		return err
	}
	var settled history.Data
	if in.txHash != nil {
		settled.TxHash = *in.txHash
	}
	if err := history.Add(ctx, tx, in.invoiceID, history.Settled, history.System, settled); err != nil {
		return err
	}
	slog.Info("settled", "invoice", in.invoiceID, "amount", in.amount.String())
	return tx.Commit(ctx)
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
	// Only from the status this attempt loaded: a stale attempt never moves an intent that went on.
	_, err := s.pool.Exec(ctx, `UPDATE settlement_intents SET status = 'pending', sender = NULL, nonce = NULL,
		tx_hash = NULL, raw_tx = NULL, replaced_hashes = '{}', signed_at = NULL, reason = $2, wait = $4,
		attempts = attempts + 1, updated_at = now(), next_attempt_at = `+backoff+` WHERE id = $1 AND status = $3`,
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
