package send

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"regexp"
	"strings"
	"time"

	"github.com/ethereum/go-ethereum"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/common/hexutil"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/forwend/forwend/apps/backend/internal/chain"
	"github.com/forwend/forwend/apps/backend/internal/privy"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

var hashPattern = regexp.MustCompile(`^0x[0-9a-f]{64}$`)

const columns = `id::text, profile_id::text, chain_id, token_contract, from_address, to_address, to_profile_id::text,
	amount::text, status, tx_hash, failure, created_at, submitted_at, finished_at,
	(SELECT tk.symbol FROM tokens tk WHERE tk.chain_id = sends.chain_id AND tk.contract = sends.token_contract),
	(SELECT tk.decimals FROM tokens tk WHERE tk.chain_id = sends.chain_id AND tk.contract = sends.token_contract),
	network_fee::text, gas_limit, max_fee_per_gas::text, max_priority_fee_per_gas::text, approved_at, fee_paid::text,
	fee_asset, privy_transaction_id,
	(SELECT w.provider_wallet_id FROM profile_wallets w WHERE w.address = sends.from_address)`

func scan(row pgx.Row) (Send, error) {
	var s Send
	var chainID int64
	var amount, fee string
	var limit *int64
	var maxFee, tip, paid *string
	err := row.Scan(&s.ID, &s.ProfileID, &chainID, &s.Token, &s.From, &s.To, &s.ToProfileID, &amount, &s.Status,
		&s.TxHash, &s.Failure, &s.CreatedAt, &s.SubmittedAt, &s.FinishedAt, &s.Symbol, &s.Decimals, &fee, &limit, &maxFee,
		&tip, &s.ApprovedAt, &paid, &s.FeeAsset, &s.RelayID, &s.walletID)
	if paid != nil {
		s.FeePaid, _ = new(big.Int).SetString(*paid, 10)
	}
	s.ChainID = uint64(chainID)
	s.Amount, _ = new(big.Int).SetString(amount, 10)
	s.NetworkFee, _ = new(big.Int).SetString(fee, 10)
	if limit != nil && maxFee != nil && tip != nil {
		s.Gas = &Gas{Limit: uint64(*limit)}
		s.Gas.MaxFeePerGas, _ = new(big.Int).SetString(*maxFee, 10)
		s.Gas.MaxPriorityFeePerGas, _ = new(big.Int).SetString(*tip, 10)
	}
	return s, err
}

// Submit records the hash the browser got from signing the send (R-212). The same hash again is a no-op. Only an
// approved send takes one, including one whose hold ended while the browser was signing: the browser signs only after
// the approve, and a hash on a send never approved would explain away money that left without one (D-49). A
// paymaster send takes none: Relay sends it, and only Privy gives its hash.
func (s *Service) Submit(ctx context.Context, profileID, sendID, txHash string) (Send, error) {
	txHash = strings.ToLower(txHash)
	if !hashPattern.MatchString(txHash) {
		return Send{}, fmt.Errorf("%w: txHash is not a transaction hash", ErrInvalid)
	}
	out, err := scan(s.pool.QueryRow(ctx, `
		UPDATE sends SET status = 'submitted', tx_hash = $3, submitted_at = now(), finished_at = NULL
		WHERE id::text = $1 AND profile_id = $2 AND approved_at IS NOT NULL AND status IN ('approved', 'expired')
		  AND fee_asset IS NULL
		RETURNING `+columns,
		strings.ToLower(sendID), profileID, txHash))
	if errors.Is(err, pgx.ErrNoRows) {
		out, err = s.Get(ctx, profileID, sendID)
		if err != nil {
			return Send{}, err
		}
		if out.TxHash == nil || *out.TxHash != txHash {
			return Send{}, fmt.Errorf("%w: this send can't take a hash now", ErrInvalid)
		}
		return out, nil
	} else if pgErr := (*pgconn.PgError)(nil); errors.As(err, &pgErr) && pgErr.ConstraintName == "sends_tx" {
		return Send{}, fmt.Errorf("%w: this hash belongs to another send", ErrInvalid)
	} else if err != nil {
		return Send{}, fmt.Errorf("submit send: %w", err)
	}
	return out, nil
}

// Approve lets the browser sign a prepared send, once: a second approve is ErrApproved, so one summary is never
// signed twice. A send no longer prepared, such as one past PrepareTTL, comes back as it is.
func (s *Service) Approve(ctx context.Context, profileID, sendID string) (Send, error) {
	out, err := s.Get(ctx, profileID, sendID)
	if err != nil {
		return Send{}, err
	}
	if out.Status == Approved {
		return Send{}, ErrApproved
	}
	if out.Status != Prepared {
		return out, nil
	}
	approved, err := scan(s.pool.QueryRow(ctx, `UPDATE sends SET status = 'approved', approved_at = now()
		WHERE id = $1 AND status = 'prepared' RETURNING `+columns, out.ID))
	if errors.Is(err, pgx.ErrNoRows) { // approved, given up or replaced since the read
		if out, err = s.Get(ctx, profileID, sendID); err == nil && out.Status == Approved {
			return Send{}, ErrApproved
		}
		return out, err
	} else if err != nil {
		return Send{}, fmt.Errorf("approve send: %w", err)
	}
	approved.Gas, approved.NetworkFee = out.Gas, out.NetworkFee
	if approved.FeeAsset != nil {
		r, err := s.relayRequest(approved)
		if err != nil {
			return Send{}, err
		}
		approved.Relay = &r
	}
	return approved, nil
}

// relayRequest is the Privy request that sends a paymaster send (R-225): the token transfer the review showed, its fee
// taken in FeeAsset. The send's id is its idempotency key, so it goes out once, and Privy refuses it once the approval's
// hold has ended and the wallet may have moved on.
func (s *Service) relayRequest(out Send) (privy.Request, error) {
	if s.privy == nil || out.walletID == "" || out.ApprovedAt == nil {
		return privy.Request{}, fmt.Errorf("%w: this send can't be signed through Privy", ErrInvalid)
	}
	data := append(bytes.Clone(selTransfer), common.LeftPadBytes(common.HexToAddress(out.To).Bytes(), 32)...)
	data = append(data, common.LeftPadBytes(out.Amount.Bytes(), 32)...)
	body, err := json.Marshal(map[string]any{
		"method": "eth_sendTransaction", "caip2": fmt.Sprintf("eip155:%d", out.ChainID), "chain_type": "ethereum",
		"sponsor": true, "sponsor_options": map[string]string{"asset": *out.FeeAsset}, "reference_id": out.ID,
		"params": map[string]any{"transaction": map[string]string{"from": out.From, "to": out.Token,
			"data": hexutil.Encode(data), "value": "0x0", "chain_id": hexutil.EncodeUint64(out.ChainID)}},
	})
	if err != nil {
		return privy.Request{}, fmt.Errorf("build Privy request: %w", err)
	}
	return s.privy.RPC(out.walletID, body, out.ID, out.ApprovedAt.Add(ApproveHold)), nil
}

// Relay sends an approved paymaster send with the user's signature over its Privy request (R-225). Privy answers with
// its transaction, whose hash refresh reads later. A second Relay of the same send is the same request, which Privy
// sends once.
func (s *Service) Relay(ctx context.Context, profileID, sendID, signature string) (Send, error) {
	if signature == "" {
		return Send{}, fmt.Errorf("%w: signature is missing", ErrInvalid)
	}
	out, err := s.Get(ctx, profileID, sendID)
	if err != nil {
		return Send{}, err
	}
	if out.FeeAsset == nil {
		return Send{}, fmt.Errorf("%w: this send is signed in the browser, not sent through Privy", ErrInvalid)
	}
	if out.Status == Submitted && out.RelayID != nil {
		return out, nil
	}
	// As Submit: a hold that ended while the browser signed, until the signed request itself expires.
	if out.Status != Approved && out.Status != Expired || out.ApprovedAt == nil ||
		!s.now().Before(out.ApprovedAt.Add(ApproveHold)) {
		return Send{}, fmt.Errorf("%w: this send can't be sent now", ErrInvalid)
	}
	req, err := s.relayRequest(out)
	if err != nil {
		return Send{}, err
	}
	// Once sent, the money moves whatever the browser does: the rest finishes though the tab closes, and within the
	// api's 30 s write timeout.
	ctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), relayBudget)
	defer cancel()
	id, err := s.privy.Send(ctx, req, signature)
	if err != nil {
		return Send{}, errors.Join(ErrUnavailable, err)
	}
	next, err := scan(s.pool.QueryRow(ctx, `UPDATE sends SET status = 'submitted', privy_transaction_id = $2,
		submitted_at = now(), finished_at = NULL WHERE id = $1::uuid AND status IN ('approved', 'expired')
		RETURNING `+columns, out.ID, id))
	if errors.Is(err, pgx.ErrNoRows) { // another Relay recorded it first
		return s.Get(ctx, profileID, sendID)
	} else if err != nil {
		return Send{}, fmt.Errorf("record relayed send: %w", err)
	}
	// The hash, known within seconds, links the paymaster's fee before its block is final and the watcher checks it.
	deadline := time.Now().Add(s.relayWait)
	if d, ok := ctx.Deadline(); ok && d.Before(deadline) {
		deadline = d
	}
	for {
		if next, err = s.refresh(ctx, next); err != nil || next.TxHash != nil || next.Status != Submitted ||
			!time.Now().Before(deadline) {
			return next, err
		}
		select {
		case <-ctx.Done():
			return next, nil
		case <-time.After(time.Second):
		}
	}
}

// relayed brings a relayed send's hash from Privy, or ends a send Privy gave up on before any block held it. Only
// Privy gives it: a matching transfer on the chain may be a theft's (D-49). A dropped send whose hash comes later goes
// on as one mined late.
func (s *Service) relayed(ctx context.Context, out Send) (Send, error) {
	moved, next, status, err := s.rehash(ctx, out)
	if moved || err != nil {
		return next, err
	}
	// Privy unread may still have sent it, so the wallet waits RelayGiveUp, not DropAfter, before it can send again;
	// it never waits for good (ErrBusy). A hash Privy gives later still finishes the send.
	age := s.now().Sub(*out.SubmittedAt)
	if out.Status == Submitted && out.TxHash == nil && (status == "failed" || status == "provider_error" ||
		status != "" && age >= DropAfter || age >= RelayGiveUp) {
		dropped := "dropped"
		return s.finish(ctx, out, Failed, &dropped)
	}
	return out, nil
}

// rehash asks Privy for a relayed send's transaction. Its hash, when it is new to the send (the first, or one that
// replaced the first), becomes the send's, and the send is brought up to date again. Privy's answer counts only for
// this send's wallet, chain and id. status is Privy's, "" when it can't be read.
func (s *Service) rehash(ctx context.Context, out Send) (moved bool, next Send, status string, err error) {
	if s.privy == nil || out.RelayID == nil {
		return false, out, "", nil
	}
	tx, err := s.privy.Transaction(ctx, *out.RelayID)
	if err != nil || tx.WalletID != out.walletID || tx.ReferenceID != out.ID ||
		tx.Caip2 != fmt.Sprintf("eip155:%d", out.ChainID) {
		return false, out, "", nil // the next read tries again
	}
	if !hashPattern.MatchString(tx.Hash) || out.TxHash != nil && *out.TxHash == tx.Hash {
		return false, out, tx.Status, nil
	}
	// A replacing hash gets its own DropAfter on the chain, from now.
	next, err = scan(s.pool.QueryRow(ctx, `UPDATE sends SET tx_hash = $2,
		submitted_at = CASE WHEN tx_hash IS NULL THEN submitted_at ELSE now() END
		WHERE id = $1::uuid AND status = $4 AND tx_hash IS NOT DISTINCT FROM $3 RETURNING `+columns,
		out.ID, tx.Hash, out.TxHash, out.Status))
	if errors.Is(err, pgx.ErrNoRows) {
		next, err = s.Get(ctx, out.ProfileID, out.ID)
		return true, next, tx.Status, err
	} else if pgErr := (*pgconn.PgError)(nil); errors.As(err, &pgErr) && pgErr.ConstraintName == "sends_tx" {
		return false, out, "", nil // another send holds that hash: not this one's answer
	} else if err != nil {
		return true, Send{}, tx.Status, fmt.Errorf("record relayed send's hash: %w", err)
	}
	next, err = s.refresh(ctx, next)
	return true, next, tx.Status, err
}

// Cancel gives up an unsigned send, as when the owner closes the review.
func (s *Service) Cancel(ctx context.Context, profileID, sendID string) error {
	tag, err := s.pool.Exec(ctx, `UPDATE sends SET status = 'canceled', finished_at = now()
		WHERE id::text = $1 AND profile_id = $2 AND status = 'prepared'`, strings.ToLower(sendID), profileID)
	if err != nil {
		return fmt.Errorf("cancel send: %w", err)
	}
	if tag.RowsAffected() == 0 {
		if _, err := s.Get(ctx, profileID, sendID); err != nil {
			return err
		}
		return fmt.Errorf("%w: only an unsigned send can be canceled", ErrInvalid)
	}
	return nil
}

// Get is the send with its status brought up to date from the chain.
func (s *Service) Get(ctx context.Context, profileID, sendID string) (Send, error) {
	out, err := scan(s.pool.QueryRow(ctx, "SELECT "+columns+" FROM sends WHERE id::text = $1 AND profile_id = $2",
		strings.ToLower(sendID), profileID))
	if errors.Is(err, pgx.ErrNoRows) {
		return Send{}, ErrNotFound
	} else if err != nil {
		return Send{}, fmt.Errorf("read send: %w", err)
	}
	return s.refresh(ctx, out)
}

// Pending is the profile's signed sends the watcher hasn't recorded yet, newest first, each brought up to date
// (R-215): the money lists show them until the transfer's own row takes their place.
func (s *Service) Pending(ctx context.Context, profileID string) ([]Send, error) {
	rows, err := s.pool.Query(ctx, "SELECT "+columns+` FROM sends WHERE profile_id = $1 AND status = 'submitted'
		AND chain_id IN (SELECT chain_id FROM chains WHERE livemode = (SELECT livemode FROM profiles WHERE id = $1))
		ORDER BY submitted_at DESC LIMIT 20`, profileID)
	if err != nil {
		return nil, fmt.Errorf("read pending sends: %w", err)
	}
	open, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (Send, error) { return scan(r) })
	if err != nil {
		return nil, fmt.Errorf("read pending sends: %w", err)
	}
	out := []Send{}
	for _, o := range open {
		o, err := s.refresh(ctx, o)
		if err != nil {
			return nil, err
		}
		if o.Status == Submitted && !o.OnChain {
			out = append(out, o)
		}
	}
	return out, nil
}

// finishOpen brings the wallet's open sends on the chain up to date, so a finished one no longer holds the next.
func (s *Service) finishOpen(ctx context.Context, wallet string, chainID uint64) error {
	rows, err := s.pool.Query(ctx, "SELECT "+columns+` FROM sends
		WHERE from_address = $1 AND chain_id = $2 AND status IN ('prepared', 'approved', 'submitted')`, wallet, int64(chainID))
	if err != nil {
		return fmt.Errorf("read open sends: %w", err)
	}
	open, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (Send, error) { return scan(r) })
	if err != nil {
		return fmt.Errorf("read open sends: %w", err)
	}
	for _, o := range open {
		if _, err := s.refresh(ctx, o); err != nil && !errors.Is(err, ErrUnavailable) {
			return err
		}
	}
	return nil
}

// refresh moves the send on from what the chain shows (R-212). Only the watcher's wallet transfer out of the wallet
// with this hash, token, recipient and amount makes it sent; nothing here ever sends again.
func (s *Service) refresh(ctx context.Context, out Send) (Send, error) {
	now := s.now()
	switch out.Status {
	case Prepared:
		if now.Sub(out.CreatedAt) < PrepareTTL {
			return out, nil
		}
		return s.finish(ctx, out, Expired, nil)
	case Approved:
		return s.unreported(ctx, out)
	case Submitted:
		if out.TxHash == nil {
			return s.relayed(ctx, out)
		}
	case Failed:
		// A transaction given up as dropped can still be mined: once the watcher records its transfer as final, the
		// send was sent after all.
		if out.Failure == nil || *out.Failure != "dropped" {
			return out, nil
		}
		if out.TxHash == nil {
			return s.relayed(ctx, out)
		}
		if moved, next, _, err := s.rehash(ctx, out); moved || err != nil {
			return next, err
		}
	default:
		return out, nil
	}
	var seen *string
	err := s.pool.QueryRow(ctx, `
		SELECT status FROM wallet_transfers WHERE chain_id = $1 AND tx_hash = $2 AND wallet_address = $3
		AND direction = 'out' AND token_contract = $4 AND counterparty = $5 AND amount = $6::numeric
		AND status <> 'reorged' ORDER BY status = 'confirmed' DESC LIMIT 1`,
		int64(out.ChainID), *out.TxHash, out.From, out.Token, out.To, out.Amount.String()).Scan(&seen)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return Send{}, fmt.Errorf("read wallet transfer: %w", err)
	}
	switch {
	case seen != nil && *seen == "confirmed":
		return s.finishMined(ctx, out, Sent, nil, nil)
	case out.Status == Failed:
		return out, nil
	case seen != nil:
		out.OnChain = true
		return out, nil
	case now.Sub(*out.SubmittedAt) < receiptAfter, !s.receiptDue(out.ID, now):
		return out, nil
	}
	client, err := s.client(out.ChainID)
	if err != nil {
		return out, nil // the next read tries again
	}
	receipt, err := client.TransactionReceipt(ctx, common.HexToHash(*out.TxHash))
	switch {
	case errors.Is(err, ethereum.NotFound):
		if now.Sub(*out.SubmittedAt) < DropAfter {
			return out, nil
		}
		// A waiting transaction has no receipt either: one the node still knows, or can't tell about, isn't dropped.
		if _, _, err := client.TransactionByHash(ctx, common.HexToHash(*out.TxHash)); !errors.Is(err, ethereum.NotFound) {
			return out, nil
		}
		// Privy may have sent the same user operation again under another hash.
		if moved, next, _, err := s.rehash(ctx, out); moved || err != nil {
			return next, err
		}
		dropped := "dropped"
		return s.finish(ctx, out, Failed, &dropped)
	case err != nil:
		return out, nil
	case !moves(receipt, out):
		// Mined without the transfer: the transaction or the wallet's call inside it reverted, and still paid its gas.
		reverted := "reverted"
		return s.finishMined(ctx, out, Failed, &reverted, receipt)
	}
	return out, nil // mined with the transfer: sent once the watcher records it
}

var transferTopic = common.HexToHash("0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef")

// moves reports whether the receipt holds the send's token Transfer out of the wallet.
func moves(r *types.Receipt, out Send) bool {
	if r.Status != types.ReceiptStatusSuccessful {
		return false
	}
	from, to := common.HexToAddress(out.From), common.HexToAddress(out.To)
	for _, l := range r.Logs {
		if l.Address == common.HexToAddress(out.Token) && len(l.Topics) == 3 && l.Topics[0] == transferTopic &&
			common.BytesToAddress(l.Topics[1].Bytes()) == from && common.BytesToAddress(l.Topics[2].Bytes()) == to &&
			new(big.Int).SetBytes(l.Data).Cmp(out.Amount) == 0 {
			return true
		}
	}
	return false
}

// unreported settles an approved send the browser never reported: its signature may have gone out though the answer
// was lost. The wallet's transfer to the same address and amount that the watcher recorded since the approve, and no
// send claims, becomes its hash; with none, the approval ends after ApproveHold, once the watcher has read the chain
// past it and the wallet has no transaction still waiting. A paymaster send never takes a hash this way: only Privy
// gives one (relayed).
func (s *Service) unreported(ctx context.Context, out Send) (Send, error) {
	// The watcher's place is read before its transfers: a scan that commits in between then only adds a transfer,
	// and never looks past the hold without it.
	var read bool
	if err := s.pool.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM chain_cursors WHERE chain_id = $1
		AND last_scanned_time >= $2)`, int64(out.ChainID), out.ApprovedAt.Add(ApproveHold).Unix()).Scan(&read); err != nil {
		return Send{}, fmt.Errorf("read chain cursor: %w", err)
	}
	var hash string
	err := s.pool.QueryRow(ctx, `
		SELECT w.tx_hash FROM wallet_transfers w WHERE w.chain_id = $1 AND w.wallet_address = $2 AND w.direction = 'out'
		AND w.token_contract = $3 AND w.counterparty = $4 AND w.amount = $5::numeric AND w.status <> 'reorged'
		AND w.created_at >= $6 AND $7::text IS NULL AND NOT EXISTS (SELECT 1 FROM sends x WHERE x.chain_id = w.chain_id
		    AND x.from_address = w.wallet_address AND x.tx_hash = w.tx_hash)
		ORDER BY w.block_number, w.log_index LIMIT 1`,
		int64(out.ChainID), out.From, out.Token, out.To, out.Amount.String(), *out.ApprovedAt, out.FeeAsset).Scan(&hash)
	if errors.Is(err, pgx.ErrNoRows) {
		// A transfer mined within the hold that the watcher hasn't read yet would otherwise free the wallet for the
		// same money again.
		if s.now().Sub(*out.ApprovedAt) < ApproveHold || !read || s.waiting(ctx, out) {
			return out, nil
		}
		return s.finish(ctx, out, Expired, nil)
	} else if err != nil {
		return Send{}, fmt.Errorf("read wallet transfer: %w", err)
	}
	next, err := scan(s.pool.QueryRow(ctx, `UPDATE sends SET status = 'submitted', tx_hash = $2, submitted_at = now()
		WHERE id = $1::uuid AND status = 'approved' RETURNING `+columns, out.ID, hash))
	if errors.Is(err, pgx.ErrNoRows) { // the browser's report came first
		return s.Get(ctx, out.ProfileID, out.ID)
	} else if err != nil {
		return Send{}, fmt.Errorf("record unreported send: %w", err)
	}
	return s.refresh(ctx, next)
}

// waiting reports whether the wallet has a transaction no block holds yet, or the node can't tell. The lost signature
// may be that transaction, and a new send would be signed at the next nonce and go out after it.
func (s *Service) waiting(ctx context.Context, out Send) bool {
	client, err := s.client(out.ChainID)
	if err != nil {
		return true
	}
	from := common.HexToAddress(out.From)
	pending, err := client.PendingNonceAt(ctx, from)
	if err != nil {
		return true
	}
	mined, err := client.NonceAt(ctx, from, nil)
	return err != nil || pending > mined
}

func (s *Service) finish(ctx context.Context, out Send, status Status, failure *string) (Send, error) {
	return s.finishPaid(ctx, out, status, failure, nil)
}

// finishMined ends a mined send with the gas its wallet paid, from receipt or read now: 0 for a send Forwend sponsored.
// A receipt that can't be read leaves the fee unknown rather than holding the send.
func (s *Service) finishMined(ctx context.Context, out Send, status Status, failure *string,
	receipt *types.Receipt) (Send, error) {
	paid := new(big.Int)
	if out.Gas != nil || out.FeeAsset != nil {
		paid = nil
		if receipt == nil {
			if client, err := s.client(out.ChainID); err == nil {
				receipt, _ = client.TransactionReceipt(ctx, common.HexToHash(*out.TxHash))
			}
		}
		if receipt != nil && out.FeeAsset != nil {
			paid = paymasterTook(receipt, out)
		} else if receipt != nil && receipt.EffectiveGasPrice != nil {
			// Wei of an 18-decimal gas coin (Arc) or attodollars (Tempo), in the token's base units, rounded up.
			wei := new(big.Int).Mul(receipt.EffectiveGasPrice, new(big.Int).SetUint64(receipt.GasUsed))
			scale := new(big.Int).Exp(big.NewInt(10), big.NewInt(int64(nativeDecimals-out.Decimals)), nil)
			paid = new(big.Int).Div(new(big.Int).Add(wei, new(big.Int).Sub(scale, big.NewInt(1))), scale)
		}
	}
	return s.finishPaid(ctx, out, status, failure, paid)
}

// paymasterTook is the token a paymaster send's wallet paid in its transaction beyond the send itself
// (chain.PaymasterFee): what it sent to anyone but the recipient, less what came back. Nothing counts unless the
// transaction moved the send and all it sent elsewhere is within PaymasterFeeSlack times the quoted fee: anything else
// is money out, not a fee. A reverted send moved nothing, so it counts none.
func paymasterTook(r *types.Receipt, out Send) *big.Int {
	took, back := new(big.Int), new(big.Int)
	if !moves(r, out) {
		return took
	}
	from, to, token := common.HexToAddress(out.From), common.HexToAddress(out.To), common.HexToAddress(out.Token)
	for _, l := range r.Logs {
		if l.Address != token || len(l.Topics) != 3 || l.Topics[0] != transferTopic {
			continue
		}
		src, dst := common.BytesToAddress(l.Topics[1].Bytes()), common.BytesToAddress(l.Topics[2].Bytes())
		switch value := new(big.Int).SetBytes(l.Data); {
		case src == from && dst != to:
			took.Add(took, value)
		case dst == from && src != from:
			back.Add(back, value)
		}
	}
	if took.Cmp(new(big.Int).Mul(out.NetworkFee, big.NewInt(chain.PaymasterFeeSlack))) > 0 {
		return new(big.Int)
	}
	if took.Sub(took, back).Sign() < 0 {
		took.SetInt64(0)
	}
	return took
}

func (s *Service) finishPaid(ctx context.Context, out Send, status Status, failure *string, paid *big.Int) (Send,
	error) {
	var fee *string
	if paid != nil {
		v := paid.String()
		fee = &v
	}
	next, err := scan(s.pool.QueryRow(ctx, `UPDATE sends SET status = $2, failure = $3, finished_at = now(),
		fee_paid = $5::numeric WHERE id = $1::uuid AND status = $4 RETURNING `+columns, out.ID, status, failure, out.Status,
		fee))
	if errors.Is(err, pgx.ErrNoRows) { // another read moved it first
		return s.Get(ctx, out.ProfileID, out.ID)
	} else if err != nil {
		return Send{}, fmt.Errorf("update send: %w", err)
	}
	return next, nil
}
