// Package settlement is the signer: it settles each paid invoice once, with the executor key, after checking the
// terms against the database and the chain (R-22). It signs only factory.deploy(terms) and receiver.settle().
package settlement

import (
	"bytes"
	"context"
	"crypto/ecdsa"
	"errors"
	"fmt"
	"log/slog"
	"math/big"
	"strings"
	"time"

	"github.com/ensp1re/forwend/apps/backend/internal/address"
	"github.com/ensp1re/forwend/apps/backend/internal/ledger"
	"github.com/ethereum/go-ethereum"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/common/hexutil"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/ethereum/go-ethereum/ethclient"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ReceiptWait is how long one run waits for a sent transaction; an unmined one is reconciled on the next run.
const ReceiptWait = time.Minute

// AttemptTimeout bounds one intent's work, so a provider that stops answering can't stall every other intent.
const AttemptTimeout = 3 * time.Minute

// errStopped ends a run early in tests that simulate the signer being killed.
var errStopped = errors.New("signer stopped")

// Signer runs settlement intents. Run one Signer per executor key: two would race for nonces.
type Signer struct {
	pool    *pgxpool.Pool
	key     *ecdsa.PrivateKey
	sender  common.Address
	clients map[uint64]*ethclient.Client
	// stopAfter simulates a crash in tests: "save" stops after the signed settle is saved, "send" after it is sent.
	stopAfter      string
	attemptTimeout time.Duration
}

func NewSigner(pool *pgxpool.Pool, key *ecdsa.PrivateKey, clients map[uint64]*ethclient.Client) *Signer {
	return &Signer{pool: pool, key: key, sender: crypto.PubkeyToAddress(key.PublicKey), clients: clients,
		attemptTimeout: AttemptTimeout}
}

// intent is one settlement intent with its invoice's terms.
type intent struct {
	id                 int64
	status             string
	sender             *string
	nonce              *int64
	txHash             *string
	rawTx              []byte
	invoiceID, payment string
	chainID            uint64
	token, recipient   string
	factory, receive   string
	wallet             *string
	amount             *big.Int
	expires, deadline  uint64
}

// Run works through every due pending or sent intent on the chains this signer serves (those with a client).
// One intent's failure doesn't stop the others.
func (s *Signer) Run(ctx context.Context) error {
	chains := make([]int64, 0, len(s.clients))
	for id := range s.clients {
		chains = append(chains, int64(id))
	}
	rows, err := s.pool.Query(ctx, `SELECT si.id FROM settlement_intents si JOIN invoices i ON i.id = si.invoice_id
		WHERE si.status IN ('pending', 'sent') AND si.next_attempt_at <= now() AND i.chain_id = ANY($1)
		ORDER BY si.id`, chains)
	if err != nil {
		return fmt.Errorf("list settlement intents: %w", err)
	}
	ids, err := pgx.CollectRows(rows, pgx.RowTo[int64])
	if err != nil {
		return fmt.Errorf("list settlement intents: %w", err)
	}
	var errs []error
	for _, id := range ids {
		attempt, cancel := context.WithTimeout(ctx, s.attemptTimeout)
		err := s.settle(attempt, id)
		cancel()
		if errors.Is(err, errStopped) {
			return err
		}
		if err != nil {
			errs = append(errs, fmt.Errorf("settlement intent %d: %w", id, err))
			// An RPC or database error: wait before the next try instead of hammering every run.
			if _, werr := s.pool.Exec(ctx, `UPDATE settlement_intents SET next_attempt_at = now() + interval '30 seconds'
				WHERE id = $1 AND status IN ('pending', 'sent')`, id); werr != nil {
				errs = append(errs, werr)
			}
		}
	}
	return errors.Join(errs...)
}

func (s *Signer) settle(ctx context.Context, id int64) error {
	in, err := s.load(ctx, id)
	if err != nil {
		return err
	}
	client, ok := s.clients[in.chainID]
	if !ok {
		return fmt.Errorf("no RPC for chain %d", in.chainID)
	}
	got, err := client.ChainID(ctx)
	if err != nil {
		return fmt.Errorf("read RPC chain id: %w", err)
	}
	if got.Uint64() != in.chainID {
		return fmt.Errorf("RPC for chain %d answers chain %d", in.chainID, got)
	}
	if in.status == "sent" {
		// Already signed: finish it whatever changed since; it may be on the chain.
		return s.reconcile(ctx, client, in)
	}
	// Database checks: the terms must be the ones the payer saw and pay the profile wallet.
	terms, reason := check(in)
	if reason != "" {
		return s.refuse(ctx, in, reason)
	}
	// Chain checks.
	st, err := factoryStatus(ctx, client, terms)
	if err != nil {
		return err
	}
	switch {
	case st.Settled: // settled outside our signer (the refund authority): record it once it is final
		return s.confirmIfFinal(ctx, client, in)
	case !strings.EqualFold(st.Receiver.Hex(), in.receive):
		return s.refuse(ctx, in, "factory.predict gives another address than the stored receive address")
	case st.Settler != s.sender:
		// Past the deadline only the refund authority may settle; keep watching for its settle, never send.
		return s.retry(ctx, in, "the settler is "+st.Settler.Hex()+", not this executor: waiting for the refund authority")
	case !st.OnIntendedChain:
		return s.retry(ctx, in, "RPC is not on the invoice's chain")
	case st.Balance.Cmp(in.amount) < 0:
		return s.retry(ctx, in, "receive address holds "+st.Balance.String()+", less than the amount")
	case !st.Settleable:
		return s.retry(ctx, in, "factory.status says not settleable (paused?)")
	}

	if !st.Deployed {
		data, _ := callData(deploySelector, terms)
		factory := common.Address(address.Factory)
		tx, err := s.sign(ctx, client, in.chainID, factory, data)
		if err != nil {
			return err
		}
		if err := client.SendTransaction(ctx, tx); err != nil {
			return fmt.Errorf("send deploy: %w", err)
		}
		// deploy is idempotent: after a crash here the next run sees the receiver deployed, or deploys again.
		if r, err := s.await(ctx, client, tx.Hash()); err != nil || r == nil || r.Status != types.ReceiptStatusSuccessful {
			return fmt.Errorf("deploy receiver %s: receipt %v, %w", in.receive, r, err)
		}
	}

	tx, err := s.sign(ctx, client, in.chainID, common.HexToAddress(in.receive), settleSelector)
	if err != nil {
		return err
	}
	raw, err := tx.MarshalBinary()
	if err != nil {
		return fmt.Errorf("encode settle: %w", err)
	}
	// Saved before it is sent: a crash after this point resends these bytes, never a new settle.
	tag, err := s.pool.Exec(ctx, `UPDATE settlement_intents SET status = 'sent', sender = $2, nonce = $3, tx_hash = $4,
		raw_tx = $5, reason = NULL, attempts = attempts + 1, updated_at = now() WHERE id = $1 AND status = 'pending'`,
		in.id, strings.ToLower(s.sender.Hex()), int64(tx.Nonce()), tx.Hash().Hex(), raw)
	if err != nil {
		return fmt.Errorf("save settle transaction: %w", err)
	}
	if tag.RowsAffected() != 1 {
		return fmt.Errorf("save settle transaction: intent %d is no longer pending", in.id)
	}
	slog.Info("settle signed", "invoice", in.invoiceID, "tx", tx.Hash().Hex(), "nonce", tx.Nonce())
	if s.stopAfter == "save" {
		return errStopped
	}
	sender, nonce, hash := strings.ToLower(s.sender.Hex()), int64(tx.Nonce()), tx.Hash().Hex()
	in.status, in.rawTx, in.sender, in.nonce, in.txHash = "sent", raw, &sender, &nonce, &hash
	return s.reconcile(ctx, client, in)
}

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
		WITH i AS (UPDATE settlement_intents SET status = 'confirmed', updated_at = now() WHERE id = $1)
		UPDATE invoices SET settlement_status = 'settled' WHERE id = $2`, in.id, in.invoiceID); err != nil {
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

// check compares the stored terms with the profile wallet and the address the compiled factory gives; it returns
// the terms, or why they are refused.
func check(in intent) (address.Terms, string) {
	switch {
	case in.payment != ledger.Paid:
		return address.Terms{}, "invoice is " + in.payment + ", not paid"
	case in.wallet == nil || !strings.EqualFold(*in.wallet, in.recipient):
		return address.Terms{}, "recipient is not the profile wallet"
	case !strings.EqualFold(in.factory, hexutil.Encode(address.Factory[:])):
		return address.Terms{}, "invoice factory is not the compiled factory"
	}
	terms := address.Terms{
		InvoiceID: [32]byte(common.FromHex(in.invoiceID)), Recipient: common.HexToAddress(in.recipient),
		Token: common.HexToAddress(in.token), Amount: in.amount, ExpiresAt: in.expires,
		SettleDeadline: in.deadline, IntendedChainID: in.chainID,
	}
	receive, err := address.Receive(terms)
	if err != nil || !bytes.Equal(receive[:], common.HexToAddress(in.receive).Bytes()) {
		return address.Terms{}, "terms do not compute the stored receive address"
	}
	return terms, ""
}

func (s *Signer) load(ctx context.Context, id int64) (intent, error) {
	var in intent
	var amount string
	err := s.pool.QueryRow(ctx, `
		SELECT si.id, si.status, si.sender, si.nonce, si.tx_hash, si.raw_tx, i.id, i.payment_status, i.chain_id, i.token_contract,
		       i.recipient_address, i.factory_address, i.receive_address,
		       (SELECT w.address FROM profile_wallets w WHERE w.profile_id = i.profile_id AND w.chain_family = i.chain_family),
		       i.amount::text, i.expires_at, i.settle_deadline
		FROM settlement_intents si JOIN invoices i ON i.id = si.invoice_id WHERE si.id = $1`, id).Scan(
		&in.id, &in.status, &in.sender, &in.nonce, &in.txHash, &in.rawTx, &in.invoiceID, &in.payment, &in.chainID, &in.token,
		&in.recipient, &in.factory, &in.receive, &in.wallet, &amount, &in.expires, &in.deadline)
	if err != nil {
		return intent{}, fmt.Errorf("read settlement intent %d: %w", id, err)
	}
	in.amount, _ = new(big.Int).SetString(amount, 10)
	return in, nil
}

// sign builds and signs a call from the executor, with the chain's own gas estimate (Tempo prices storage
// differently, S-5/S-6).
func (s *Signer) sign(ctx context.Context, client *ethclient.Client, chainID uint64, to common.Address, data []byte) (*types.Transaction, error) {
	nonce, err := client.PendingNonceAt(ctx, s.sender)
	if err != nil {
		return nil, fmt.Errorf("read executor nonce: %w", err)
	}
	gas, err := client.EstimateGas(ctx, ethereum.CallMsg{From: s.sender, To: &to, Data: data})
	if err != nil {
		return nil, fmt.Errorf("estimate gas: %w", err)
	}
	tip, err := client.SuggestGasTipCap(ctx)
	if err != nil {
		return nil, fmt.Errorf("read gas tip: %w", err)
	}
	head, err := client.HeaderByNumber(ctx, nil)
	if err != nil {
		return nil, fmt.Errorf("read base fee: %w", err)
	}
	if head.BaseFee == nil {
		return nil, fmt.Errorf("chain %d has no base fee (EIP-1559)", chainID)
	}
	feeCap := new(big.Int).Add(new(big.Int).Mul(head.BaseFee, big.NewInt(2)), tip)
	tx := types.NewTx(&types.DynamicFeeTx{
		ChainID: new(big.Int).SetUint64(chainID), Nonce: nonce, GasTipCap: tip, GasFeeCap: feeCap,
		Gas: gas + gas/5, To: &to, Data: data,
	})
	return types.SignTx(tx, types.LatestSignerForChainID(new(big.Int).SetUint64(chainID)), s.key)
}

// await polls for a receipt up to ReceiptWait; nil means not mined yet.
func (s *Signer) await(ctx context.Context, client *ethclient.Client, hash common.Hash) (*types.Receipt, error) {
	deadline := time.Now().Add(ReceiptWait)
	for {
		r, err := client.TransactionReceipt(ctx, hash)
		if err == nil {
			return r, nil
		}
		if !errors.Is(err, ethereum.NotFound) {
			return nil, fmt.Errorf("read receipt %s: %w", hash.Hex(), err)
		}
		if time.Now().After(deadline) {
			return nil, nil
		}
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(200 * time.Millisecond):
		}
	}
}
