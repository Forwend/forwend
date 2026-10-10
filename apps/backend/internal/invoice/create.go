package invoice

import (
	"bytes"
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"time"

	"github.com/ensp1re/forwend/apps/backend/internal/address"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// Create makes the invoice once per (profile, idempotency key). created is false when the same request was already
// made: the stored invoice is returned. The caller has checked that the user owns the profile.
func (s *Service) Create(ctx context.Context, profileID, idempotencyKey string, r Request) (inv Invoice, created bool, err error) {
	token, amount, expiresIn, err := r.normalize()
	if err != nil {
		return Invoice{}, false, err
	}
	hash := requestHash(r.ChainID, token, amount, expiresIn)
	if inv, err := s.replay(ctx, profileID, idempotencyKey, hash); !errors.Is(err, ErrNotFound) {
		return inv, false, err
	}

	var family string
	err = s.pool.QueryRow(ctx, `
		SELECT c.chain_family FROM chains c JOIN tokens t ON t.chain_id = c.chain_id
		WHERE c.chain_id = $1 AND c.enabled AND t.contract = $2 AND t.enabled`, r.ChainID, token).Scan(&family)
	if errors.Is(err, pgx.ErrNoRows) {
		return Invoice{}, false, fmt.Errorf("%w: token is not enabled on this chain", ErrInvalid)
	}
	if err != nil {
		return Invoice{}, false, fmt.Errorf("read chain and token: %w", err)
	}
	var recipient string
	err = s.pool.QueryRow(ctx, "SELECT address FROM profile_wallets WHERE profile_id = $1 AND chain_family = $2",
		profileID, family).Scan(&recipient)
	if errors.Is(err, pgx.ErrNoRows) {
		return Invoice{}, false, fmt.Errorf("%w: the profile has no wallet for this chain", ErrInvalid)
	}
	if err != nil {
		return Invoice{}, false, fmt.Errorf("read profile wallet: %w", err)
	}

	var id [32]byte
	_, _ = rand.Read(id[:])
	expiresAt := s.now().UTC().Truncate(time.Second).Add(expiresIn)
	settleDeadline := expiresAt.Add(SettleWindow)
	_, receive, err := buildTerms(id, r.ChainID, token, recipient, amount, expiresAt, settleDeadline)
	if err != nil {
		return Invoice{}, false, err
	}
	inv = Invoice{
		ID: hexID(id), ChainID: r.ChainID, Token: token, Amount: amount, Recipient: recipient,
		Factory: hexAddress(address.Factory), ReceiveAddress: receive, ExpiresAt: expiresAt,
		SettleDeadline: settleDeadline, PaymentStatus: "open", SettlementStatus: "none", RefundStatus: "none",
	}
	err = s.pool.QueryRow(ctx, `
		INSERT INTO invoices (id, profile_id, chain_id, chain_family, token_contract, amount, expires_at, settle_deadline,
		    recipient_address, receive_method, factory_address, receive_address, idempotency_key, request_hash)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'evm_create2', $10, $11, $12, $13) RETURNING created_at`,
		inv.ID, profileID, r.ChainID, family, token, amount.String(), expiresAt.Unix(), settleDeadline.Unix(),
		recipient, inv.Factory, receive, idempotencyKey, hash).Scan(&inv.CreatedAt)
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.ConstraintName == "invoices_profile_id_idempotency_key_key" {
		// A concurrent request with the same key won the insert.
		inv, err := s.replay(ctx, profileID, idempotencyKey, hash)
		return inv, false, err
	}
	if err != nil {
		return Invoice{}, false, fmt.Errorf("insert invoice: %w", err)
	}
	return inv, true, nil
}

// replay returns the invoice made earlier with this key: ErrNotFound if none, ErrConflict if the request differed.
func (s *Service) replay(ctx context.Context, profileID, idempotencyKey string, hash []byte) (Invoice, error) {
	var stored []byte
	inv, err := scanInvoice(s.pool.QueryRow(ctx, "SELECT request_hash, "+invoiceColumns+
		" FROM invoices WHERE profile_id = $1 AND idempotency_key = $2", profileID, idempotencyKey), &stored)
	if err != nil {
		return Invoice{}, err
	}
	if !bytes.Equal(stored, hash) {
		return Invoice{}, ErrConflict
	}
	return inv, nil
}
