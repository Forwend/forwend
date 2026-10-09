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

// errStopped ends a run early in tests that simulate the signer being killed.
var errStopped = errors.New("signer stopped")

// Signer runs settlement intents. Run one Signer per executor key: two would race for nonces.
type Signer struct {
	pool    *pgxpool.Pool
	key     *ecdsa.PrivateKey
	sender  common.Address
	clients map[uint64]*ethclient.Client
	// stopAfter simulates a crash in tests: "save" stops after the signed settle is saved, "send" after it is sent.
	stopAfter string
}

func NewSigner(pool *pgxpool.Pool, key *ecdsa.PrivateKey, clients map[uint64]*ethclient.Client) *Signer {
	return &Signer{pool: pool, key: key, sender: crypto.PubkeyToAddress(key.PublicKey), clients: clients}
}

// intent is one settlement intent with its invoice's terms.
type intent struct {
	id                 int64
	status             string
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

// Run works through every pending or sent intent. One intent's failure doesn't stop the others.
func (s *Signer) Run(ctx context.Context) error {
	rows, err := s.pool.Query(ctx, `SELECT id FROM settlement_intents
		WHERE status IN ('pending', 'sent') AND next_attempt_at <= now() ORDER BY id`)
	if err != nil {
		return fmt.Errorf("list settlement intents: %w", err)
	}
	ids, err := pgx.CollectRows(rows, pgx.RowTo[int64])
	if err != nil {
		return fmt.Errorf("list settlement intents: %w", err)
	}
	var errs []error
	for _, id := range ids {
		if err := s.settle(ctx, id); errors.Is(err, errStopped) {
			return err
		} else if err != nil {
			errs = append(errs, fmt.Errorf("settlement intent %d: %w", id, err))
		}
	}
	return errors.Join(errs...)
}

func (s *Signer) settle(ctx context.Context, id int64) error {
	in, err := s.load(ctx, id)
	if err != nil {
		return err
	}
	// Database checks: the terms must be the ones the payer saw and pay the profile wallet.
	terms, reason := check(in)
	if reason != "" {
		return s.refuse(ctx, in, reason)
	}
	client, ok := s.clients[in.chainID]
	if !ok {
		return fmt.Errorf("no RPC for chain %d", in.chainID)
	}
	// Chain checks.
	st, err := factoryStatus(ctx, client, terms)
	if err != nil {
		return err
	}
	if st.Settled {
		return s.confirm(ctx, in)
	}
	if !strings.EqualFold(st.Receiver.Hex(), in.receive) {
		return s.refuse(ctx, in, "factory.predict gives another address than the stored receive address")
	}
	if in.status == "sent" {
		return s.reconcile(ctx, client, in)
	}
	switch {
	case !st.OnIntendedChain:
		return s.refuse(ctx, in, "RPC is not on the invoice's chain")
	case st.Settler != s.sender:
		return s.refuse(ctx, in, "the settler is "+st.Settler.Hex()+", not this executor (deadline passed?)")
	case st.Balance.Cmp(in.amount) < 0:
		return s.refuse(ctx, in, "receive address holds "+st.Balance.String()+", less than the amount")
	case !st.Settleable:
		return s.refuse(ctx, in, "factory.status says not settleable (paused or unsafe terms)")
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

	receiver := common.HexToAddress(in.receive)
	tx, err := s.sign(ctx, client, in.chainID, receiver, settleSelector)
	if err != nil {
		return err
	}
	raw, err := tx.MarshalBinary()
	if err != nil {
		return fmt.Errorf("encode settle: %w", err)
	}
	// Saved before it is sent: a crash after this point resends these bytes, never a new settle.
	if _, err := s.pool.Exec(ctx, `UPDATE settlement_intents SET status = 'sent', sender = $2, nonce = $3, tx_hash = $4,
		raw_tx = $5, attempts = attempts + 1, updated_at = now() WHERE id = $1 AND status = 'pending'`,
		in.id, strings.ToLower(s.sender.Hex()), int64(tx.Nonce()), tx.Hash().Hex(), raw); err != nil {
		return fmt.Errorf("save settle transaction: %w", err)
	}
	slog.Info("settle signed", "invoice", in.invoiceID, "tx", tx.Hash().Hex(), "nonce", tx.Nonce())
	if s.stopAfter == "save" {
		return errStopped
	}
	in.status, in.rawTx = "sent", raw
	nonce, hash := int64(tx.Nonce()), tx.Hash().Hex()
	in.nonce, in.txHash = &nonce, &hash
	return s.reconcile(ctx, client, in)
}

// reconcile finishes a sent settle: confirmed if mined, sent again (the same bytes) if it is not on the chain yet,
// back to pending if its nonce was used by another transaction.
func (s *Signer) reconcile(ctx context.Context, client *ethclient.Client, in intent) error {
	hash := common.HexToHash(*in.txHash)
	if r, err := client.TransactionReceipt(ctx, hash); err == nil {
		if r.Status == types.ReceiptStatusSuccessful {
			return s.confirm(ctx, in)
		}
		return s.refuse(ctx, in, "settle transaction "+*in.txHash+" reverted")
	} else if !errors.Is(err, ethereum.NotFound) {
		return fmt.Errorf("read settle receipt: %w", err)
	}
	mined, err := client.NonceAt(ctx, s.sender, nil)
	if err != nil {
		return fmt.Errorf("read executor nonce: %w", err)
	}
	if int64(mined) > *in.nonce {
		// Our nonce went to another transaction and ours is gone: sign a new settle next run.
		_, err := s.pool.Exec(ctx, `UPDATE settlement_intents SET status = 'pending', nonce = NULL, tx_hash = NULL,
			raw_tx = NULL, updated_at = now() WHERE id = $1 AND status = 'sent'`, in.id)
		return err
	}
	tx := new(types.Transaction)
	if err := tx.UnmarshalBinary(in.rawTx); err != nil || tx.Hash() != hash {
		return fmt.Errorf("saved settle transaction %s does not decode to its hash", *in.txHash)
	}
	if err := client.SendTransaction(ctx, tx); err != nil && !strings.Contains(strings.ToLower(err.Error()), "known") {
		return fmt.Errorf("send settle: %w", err)
	}
	if s.stopAfter == "send" {
		return errStopped
	}
	r, err := s.await(ctx, client, hash)
	switch {
	case err != nil:
		return err
	case r == nil:
		return nil // not mined yet: the next run reconciles again
	case r.Status != types.ReceiptStatusSuccessful:
		return s.refuse(ctx, in, "settle transaction "+*in.txHash+" reverted")
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

// refuse stops an intent without sending anything; an operator reads the reason.
func (s *Signer) refuse(ctx context.Context, in intent, reason string) error {
	slog.Warn("settlement refused", "invoice", in.invoiceID, "reason", reason)
	_, err := s.pool.Exec(ctx, `UPDATE settlement_intents SET status = 'refused', reason = $2, updated_at = now()
		WHERE id = $1`, in.id, reason)
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
		SELECT si.id, si.status, si.nonce, si.tx_hash, si.raw_tx, i.id, i.payment_status, i.chain_id, i.token_contract,
		       i.recipient_address, i.factory_address, i.receive_address,
		       (SELECT w.address FROM profile_wallets w WHERE w.profile_id = i.profile_id AND w.chain_family = i.chain_family),
		       i.amount::text, i.expires_at, i.settle_deadline
		FROM settlement_intents si JOIN invoices i ON i.id = si.invoice_id WHERE si.id = $1`, id).Scan(
		&in.id, &in.status, &in.nonce, &in.txHash, &in.rawTx, &in.invoiceID, &in.payment, &in.chainID, &in.token,
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
