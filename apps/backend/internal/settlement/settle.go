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

	"github.com/ensp1re/forwend/apps/backend/internal/address"
	"github.com/ensp1re/forwend/apps/backend/internal/ledger"
	"github.com/ethereum/go-ethereum"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/common/hexutil"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/ethereum/go-ethereum/ethclient"
)

// ReceiptWait is how long one run waits for a sent transaction; an unmined one is reconciled on the next run.
const ReceiptWait = time.Minute

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
