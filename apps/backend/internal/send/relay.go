package send

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/ethereum/go-ethereum/common/hexutil"
	"github.com/forwend/forwend/apps/backend/internal/privy"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// relayRequest is the Privy request that sends a paymaster send (R-225): the token transfer the review showed, its fee
// taken in FeeAsset. The send's id is its idempotency key, so it goes out once, and Privy refuses it once the approval's
// hold has ended and the wallet may have moved on.
func (s *Service) relayRequest(out Send) (privy.Request, error) {
	if s.privy == nil || out.walletID == "" || out.ApprovedAt == nil {
		return privy.Request{}, fmt.Errorf("%w: this send can't be signed through Privy", ErrInvalid)
	}
	body, err := json.Marshal(map[string]any{
		"method": "eth_sendTransaction", "caip2": fmt.Sprintf("eip155:%d", out.ChainID), "chain_type": "ethereum",
		"sponsor": true, "sponsor_options": map[string]string{"asset": *out.FeeAsset}, "reference_id": out.ID,
		"params": map[string]any{"transaction": map[string]string{"from": out.From, "to": out.Token,
			"data": hexutil.Encode(transferCall(out.To, out.Amount)), "value": "0x0",
			"chain_id": hexutil.EncodeUint64(out.ChainID)}},
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
