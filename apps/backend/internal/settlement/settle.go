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
	"github.com/ethereum/go-ethereum/rpc"
	"github.com/forwend/forwend/apps/backend/internal/address"
	"github.com/forwend/forwend/apps/backend/internal/chain"
	"github.com/forwend/forwend/apps/backend/internal/ledger"
)

// ReceiptWait is how long one run waits for a sent transaction; an unmined one is reconciled on the next run.
const ReceiptWait = time.Minute

// CodeWait is how long one run waits for the RPC to show a receiver's code before it estimates settle gas.
const CodeWait = 10 * time.Second

// A node that hasn't seen the receiver's deploy estimates settle at 21,064 gas, which runs out. Real USDC used up to
// 135,632; the floor plus a fifth covers it. On Arbitrum the estimate at the deploy's block adds the L1 data cost.
const SettleGasFloor = 125_000

// TempoSettleGasFloor: Tempo prices storage far higher, and its testnet settle used 572,845 gas (deployments.json).
const TempoSettleGasFloor = 580_000

// An unmined settle is re-signed after this with a higher fee, so later settles on the chain aren't held up.
const ReplaceAfter = 3 * time.Minute

// Per user in 24 hours: tiny invoices paid back and forth would otherwise drain the executor's gas (SEC-03).
const SponsoredPerDay = 50

// Caps a replacement's fee cap at this many times a new settle's, so repeated bumps can't grow without end.
const MaxFeeFactor = 2

func (s *Signer) settle(ctx context.Context, id int64, release func()) error {
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
	st, err := factoryStatus(ctx, client, terms)
	if err != nil {
		return err
	}
	switch {
	case st.Settled: // settled outside our signer (the refund authority): record it once it is final
		return s.confirmIfFinal(ctx, client, in, nil)
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
	var funded bool
	if err := s.pool.QueryRow(ctx, `SELECT
  coalesce((SELECT -sum(e.amount) FROM ledger_entries e JOIN ledger_transactions t ON t.id = e.transaction_id
            WHERE t.invoice_id = $1 AND e.account = 'recipient_payable'), 0) >= $2
  AND NOT EXISTS (SELECT 1 FROM receiver_outflows o WHERE o.invoice_id = $1 AND o.kind = 'refund'
                  AND o.ledger_transaction_id IS NULL)
  AND NOT (`+ledger.UnreconciledSQL("$1")+`)`, in.invoiceID, in.amount.String()).Scan(&funded); err != nil {
		return err
	}
	if !funded {
		return s.postpone(ctx, in, waitUnresolved, "merchant payable was returned or receiver evidence is unresolved")
	}
	var used int
	if err := s.pool.QueryRow(ctx, `SELECT count(*) FROM settlement_intents si JOIN invoices i ON i.id = si.invoice_id
		JOIN profiles p ON p.id = i.profile_id
		WHERE p.user_id = (SELECT p.user_id FROM invoices i JOIN profiles p ON p.id = i.profile_id WHERE i.id = $1)
		  AND si.signed_at > now() - interval '24 hours'`, in.invoiceID).Scan(&used); err != nil {
		return fmt.Errorf("count the user's settlements: %w", err)
	}
	if used >= SponsoredPerDay {
		slog.Error("ALERT a user's settlements in 24 hours reached the sponsored limit", "invoice", in.invoiceID,
			"limit", SponsoredPerDay)
		return s.postpone(ctx, in, waitCap, "the user's sponsored settlements for 24 hours are used up")
	}

	receive := common.HexToAddress(in.receive)
	var after uint64      // the executor's next nonce after a deploy sent in this attempt
	var deployed *big.Int // that deploy's block
	if !st.Deployed {
		data, _ := callData(deploySelector, terms)
		factory := common.Address(address.Factory)
		tx, err := s.sign(ctx, client, in.chainID, factory, data, 0, 0, nil)
		if err != nil {
			return err
		}
		if tx, err = s.overStuck(ctx, client, in.chainID, tx); err != nil {
			return err
		}
		if err := client.SendTransaction(ctx, tx); err != nil {
			return fmt.Errorf("send deploy: %w", err)
		}
		// deploy is idempotent: after a crash here the next run sees the receiver deployed, or deploys again.
		r, err := s.await(ctx, client, tx.Hash())
		if err != nil || r == nil || r.Status != types.ReceiptStatusSuccessful {
			return fmt.Errorf("deploy receiver %s: receipt %v, %w", in.receive, r, err)
		}
		after, deployed = tx.Nonce()+1, r.BlockNumber
	}
	if err := s.awaitCode(ctx, client, receive, deployed); err != nil {
		return err
	}

	floor := uint64(SettleGasFloor)
	if token, err := feeToken(ctx, client, s.sender); err != nil {
		return err
	} else if token != (common.Address{}) {
		floor = TempoSettleGasFloor
	}
	tx, err := s.sign(ctx, client, in.chainID, receive, settleSelector, after, floor, deployed)
	if err != nil {
		return err
	}
	raw, err := tx.MarshalBinary()
	if err != nil {
		return fmt.Errorf("encode settle: %w", err)
	}
	// Saved before it is sent: a crash after this point resends these bytes, never a new settle.
	tag, err := s.pool.Exec(ctx, `UPDATE settlement_intents SET status = 'sent', sender = $2, nonce = $3, tx_hash = $4,
		raw_tx = $5, signed_at = now(), reason = NULL, wait = NULL, attempts = attempts + 1, updated_at = now()
		WHERE id = $1 AND status = 'pending'`,
		in.id, strings.ToLower(s.sender.Hex()), int64(tx.Nonce()), tx.Hash().Hex(), raw)
	if err != nil {
		return fmt.Errorf("save settle transaction: %w", err)
	}
	if tag.RowsAffected() != 1 {
		return fmt.Errorf("save settle transaction: intent %d is no longer pending", in.id)
	}
	release()
	slog.Info("settle signed", "invoice", in.invoiceID, "tx", tx.Hash().Hex(), "nonce", tx.Nonce())
	if s.stopAfter == "save" {
		return errStopped
	}
	sender, nonce, hash := strings.ToLower(s.sender.Hex()), int64(tx.Nonce()), tx.Hash().Hex()
	in.status, in.rawTx, in.sender, in.nonce, in.txHash, in.signedAt = "sent", raw, &sender, &nonce, &hash, time.Now()
	return s.reconcile(ctx, client, in)
}

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

// sign trusts the chain's own gas estimate (Tempo prices storage differently, S-5/S-6), with minGas as a floor.
// The nonce is never below after or the nonce after the last saved settle: a lagging node may miss our latest ones.
func (s *Signer) sign(ctx context.Context, client *ethclient.Client, chainID uint64, to common.Address, data []byte,
	after, minGas uint64, block *big.Int) (*types.Transaction, error) {
	nonce, err := client.PendingNonceAt(ctx, s.sender)
	if err != nil {
		return nil, fmt.Errorf("read executor nonce: %w", err)
	}
	var saved *int64
	if err := s.pool.QueryRow(ctx, `SELECT max(si.nonce) FROM settlement_intents si JOIN invoices i ON i.id = si.invoice_id
		WHERE i.chain_id = $1 AND si.sender = $2 AND si.tx_hash IS NOT NULL`,
		int64(chainID), strings.ToLower(s.sender.Hex())).Scan(&saved); err != nil {
		return nil, fmt.Errorf("read the last saved settle nonce: %w", err)
	}
	if saved != nil {
		after = max(after, uint64(*saved)+1)
	}
	nonce = max(nonce, after)
	msg := ethereum.CallMsg{From: s.sender, To: &to, Data: data}
	var gas uint64
	if block != nil {
		// At the deploy's block a node that answers has seen the receiver's code; on Arbitrum the estimate also counts
		// the L1 data gas, which the floor does not.
		gas, err = client.EstimateGasAtBlock(ctx, msg, block)
		if rpcErr := rpc.Error(nil); errors.As(err, &rpcErr) && rpcErr.ErrorCode() == 3 { // a revert fails at latest too
			return nil, fmt.Errorf("estimate gas at block %s: %w", block, err)
		}
		if err != nil {
			slog.Warn("no gas estimate at the deploy block; estimating at latest", "block", block, "err", chain.Redact(err))
		}
	}
	if block == nil || err != nil {
		if gas, err = client.EstimateGas(ctx, msg); err != nil {
			return nil, fmt.Errorf("estimate gas: %w", err)
		}
	}
	gas = max(gas, minGas)
	tip, feeCap, err := s.fees(ctx, client, chainID)
	if err != nil {
		return nil, err
	}
	tx := types.NewTx(&types.DynamicFeeTx{
		ChainID: new(big.Int).SetUint64(chainID), Nonce: nonce, GasTipCap: tip, GasFeeCap: feeCap,
		Gas: gas + gas/5, To: &to, Data: data,
	})
	return types.SignTx(tx, types.LatestSignerForChainID(new(big.Int).SetUint64(chainID)), s.key)
}

// replace raises tip and fee cap by at least an eighth (geth wants a tenth) and to at least today's fees, saved before
// it is sent with old's hash kept, since either may be mined. Over MaxFeeFactor it returns old, to be sent again as is.
func (s *Signer) replace(ctx context.Context, client *ethclient.Client, in intent, old *types.Transaction) (*types.Transaction, error) {
	tip, feeCap, err := s.fees(ctx, client, in.chainID)
	if err != nil {
		return nil, err
	}
	limit := new(big.Int).Mul(feeCap, big.NewInt(MaxFeeFactor))
	bump := func(x *big.Int) *big.Int {
		return new(big.Int).Div(new(big.Int).Add(new(big.Int).Mul(x, big.NewInt(9)), big.NewInt(7)), big.NewInt(8))
	}
	tip, feeCap = bigMax(tip, bump(old.GasTipCap())), bigMax(feeCap, bump(old.GasFeeCap()))
	if feeCap.Cmp(limit) > 0 {
		slog.Warn("stuck settle is at the max fee; sending it again", "invoice", in.invoiceID, "tx", old.Hash().Hex())
		return old, nil
	}
	// The limit may have to grow: on Arbitrum it counts L1 data cost, which rises with L1 prices.
	gas := old.Gas()
	if est, err := client.EstimateGas(ctx, ethereum.CallMsg{From: s.sender, To: old.To(), Data: old.Data()}); err == nil {
		gas = max(gas, est+est/5)
	}
	tx, err := types.SignTx(types.NewTx(&types.DynamicFeeTx{ChainID: old.ChainId(), Nonce: old.Nonce(), GasTipCap: tip,
		GasFeeCap: feeCap, Gas: gas, To: old.To(), Data: old.Data()}), types.LatestSignerForChainID(old.ChainId()), s.key)
	if err != nil {
		return nil, fmt.Errorf("sign replacement settle: %w", err)
	}
	raw, err := tx.MarshalBinary()
	if err != nil {
		return nil, fmt.Errorf("encode replacement settle: %w", err)
	}
	tag, err := s.pool.Exec(ctx, `UPDATE settlement_intents SET tx_hash = $2, raw_tx = $3,
		replaced_hashes = replaced_hashes || tx_hash, signed_at = now(), reason = NULL, wait = NULL, updated_at = now()
		WHERE id = $1 AND status = 'sent' AND tx_hash = $4`, in.id, tx.Hash().Hex(), raw, old.Hash().Hex())
	if err != nil {
		return nil, fmt.Errorf("save replacement settle: %w", err)
	}
	if tag.RowsAffected() != 1 {
		return nil, fmt.Errorf("save replacement settle: intent %d moved on", in.id)
	}
	slog.Info("stuck settle replaced", "invoice", in.invoiceID, "old", old.Hash().Hex(), "tx", tx.Hash().Hex(),
		"nonce", tx.Nonce(), "fee_cap", feeCap.String())
	if s.stopAfter == "save" {
		return nil, errStopped
	}
	return tx, nil
}

// overStuck: an unsaved transaction stuck at the next mined nonce (an earlier deploy) holds every later one.
// Deploy is idempotent, so this deploy takes its place at twice today's fee.
func (s *Signer) overStuck(ctx context.Context, client *ethclient.Client, chainID uint64, tx *types.Transaction) (*types.Transaction, error) {
	mined, err := client.NonceAt(ctx, s.sender, nil)
	if err != nil {
		return nil, fmt.Errorf("read executor nonce: %w", err)
	}
	pending, err := client.PendingNonceAt(ctx, s.sender)
	if err != nil || pending <= mined {
		return tx, err
	}
	var saved bool
	if err := s.pool.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM settlement_intents si JOIN invoices i ON i.id = si.invoice_id
		WHERE i.chain_id = $1 AND si.sender = $2 AND si.nonce = $3 AND si.status = 'sent')`,
		int64(chainID), strings.ToLower(s.sender.Hex()), int64(mined)).Scan(&saved); err != nil || saved {
		return tx, err
	}
	two := big.NewInt(2)
	slog.Warn("deploy replaces a stuck transaction", "chain", chainID, "nonce", mined)
	return types.SignTx(types.NewTx(&types.DynamicFeeTx{ChainID: tx.ChainId(), Nonce: mined,
		GasTipCap: new(big.Int).Mul(tx.GasTipCap(), two), GasFeeCap: new(big.Int).Mul(tx.GasFeeCap(), two),
		Gas: tx.Gas(), To: tx.To(), Data: tx.Data()}), types.LatestSignerForChainID(tx.ChainId()), s.key)
}

func bigMax(a, b *big.Int) *big.Int {
	if a.Cmp(b) >= 0 {
		return a
	}
	return b
}

// The executor pays the tip as signed, so one RPC host must not set it alone (D-15).
func (s *Signer) fees(ctx context.Context, client *ethclient.Client, chainID uint64) (tip, feeCap *big.Int, err error) {
	tip, feeCap, err = fees(ctx, client, chainID)
	if err != nil {
		return nil, nil, err
	}
	second := s.seconds[chainID]
	if second == nil {
		return nil, nil, fmt.Errorf("chain %d: no second RPC to check the gas tip", chainID)
	}
	other, err := second.SuggestGasTipCap(ctx)
	if err != nil {
		return nil, nil, fmt.Errorf("second RPC: read gas tip: %w", err)
	}
	if other.Cmp(tip) < 0 {
		feeCap, tip = new(big.Int).Add(new(big.Int).Sub(feeCap, tip), other), other
	}
	return tip, feeCap, nil
}

func fees(ctx context.Context, client *ethclient.Client, chainID uint64) (tip, feeCap *big.Int, err error) {
	tip, err = client.SuggestGasTipCap(ctx)
	if err != nil {
		return nil, nil, fmt.Errorf("read gas tip: %w", err)
	}
	head, err := client.HeaderByNumber(ctx, nil)
	if err != nil {
		return nil, nil, fmt.Errorf("read base fee: %w", err)
	}
	if head.BaseFee == nil {
		return nil, nil, fmt.Errorf("chain %d has no base fee (EIP-1559)", chainID)
	}
	return tip, new(big.Int).Add(new(big.Int).Mul(head.BaseFee, big.NewInt(2)), tip), nil
}

// awaitCode: a node that hasn't seen the deploy estimates settle far too low.
func (s *Signer) awaitCode(ctx context.Context, client *ethclient.Client, receiver common.Address, block *big.Int) error {
	deadline := time.Now().Add(s.codeWait)
	for {
		code, err := client.CodeAt(ctx, receiver, block)
		if err == nil && len(code) > 0 {
			return nil
		}
		if time.Now().After(deadline) {
			if err != nil {
				return fmt.Errorf("read receiver %s code: %w", receiver.Hex(), err)
			}
			return fmt.Errorf("the RPC shows no code at receiver %s yet", receiver.Hex())
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(500 * time.Millisecond):
		}
	}
}

// await polls for a receipt up to ReceiptWait; nil means not mined yet.
func (s *Signer) await(ctx context.Context, client *ethclient.Client, hash common.Hash) (*types.Receipt, error) {
	deadline := time.Now().Add(ReceiptWait)
	delay := time.Second
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
		case <-time.After(min(delay, time.Until(deadline))):
		}
		delay = min(2*delay, 4*time.Second)
	}
}
