package invoice

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"slices"
	"strings"
	"time"

	"github.com/ensp1re/forwend/apps/backend/internal/address"
	"github.com/ensp1re/forwend/apps/backend/internal/history"
	"github.com/ensp1re/forwend/apps/backend/internal/profile"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

type accepted struct {
	chainID       uint64
	family, token string
	amount        *big.Int
	// scale turns request amounts into base units: 0 for a fixed invoice, the token's decimals for USD (D-75).
	scale int
}

// Create is idempotent per (profile, key): a repeat returns the stored invoice with created false.
// The caller must check the user's access to the profile.
func (s *Service) Create(ctx context.Context, profileID, idempotencyKey string, r Request) (inv Invoice, created bool, err error) {
	token, amount, usd, lines, expiresIn, err := r.normalize()
	if err != nil {
		return Invoice{}, false, err
	}
	if r.Details.Agreed, err = r.Agreed.parse(); err != nil {
		return Invoice{}, false, err
	}
	if r.Reminders && (r.DueDate == "" || r.ClientEmail == "") {
		return Invoice{}, false, fmt.Errorf("%w: reminders need a dueDate and a client.email", ErrInvalid)
	}
	if err := checkRepeat(r); err != nil {
		return Invoice{}, false, err
	}
	r.Replaces, r.StoreID = strings.ToLower(r.Replaces), strings.ToLower(r.StoreID)
	// Without expiresIn the hash has DefaultExpiresIn, not the store's default, so a retry after the store changed
	// still replays.
	var hash []byte
	if usd != nil {
		hash = requestHash(0, "usd", usd, expiresIn, r.Details, lines, r.Reminders, r.Repeat, r.Replaces, r.StoreID)
	} else {
		hash = requestHash(r.ChainID, token, amount, expiresIn, r.Details, lines, r.Reminders, r.Repeat, r.Replaces,
			r.StoreID)
	}
	if inv, err := s.replay(ctx, profileID, idempotencyKey, hash); !errors.Is(err, ErrNotFound) {
		return inv, false, err
	}

	options, err := s.accepted(ctx, r.ChainID, token, amount, usd)
	if err != nil {
		return Invoice{}, false, err
	}
	var recipient string
	err = s.pool.QueryRow(ctx, "SELECT address FROM profile_wallets WHERE profile_id = $1 AND chain_family = $2",
		profileID, options[0].family).Scan(&recipient)
	if errors.Is(err, pgx.ErrNoRows) {
		return Invoice{}, false, fmt.Errorf("%w: the profile has no wallet for this chain", ErrInvalid)
	}
	if err != nil {
		return Invoice{}, false, fmt.Errorf("read profile wallet: %w", err)
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return Invoice{}, false, fmt.Errorf("insert invoice: %w", err)
	}
	defer tx.Rollback(ctx)
	// The profile row lock makes concurrent creates count one after another, so none passes a cap on a stale count.
	// Billing details are never removed, so once there they stay for the insert trigger to copy.
	var kind string
	var billed bool
	if err := tx.QueryRow(ctx, `SELECT kind,
		EXISTS (SELECT 1 FROM profile_billing_details WHERE profile_id = $1) FROM profiles WHERE id = $1 FOR UPDATE`,
		profileID).Scan(&kind, &billed); err != nil {
		return Invoice{}, false, fmt.Errorf("lock profile: %w", err)
	}
	if kind != profile.Personal && !billed {
		return Invoice{}, false, ErrBillingDetailsRequired
	}
	var storeID *string
	switch {
	case kind == profile.Merchant:
		store, err := profile.InvoiceStore(ctx, tx, profileID, r.StoreID)
		if errors.Is(err, profile.ErrStoreNotFound) {
			return Invoice{}, false, fmt.Errorf("%w: storeId is not one of the profile's stores", ErrInvalid)
		}
		if err != nil {
			return Invoice{}, false, err
		}
		if r.ExpiresInSeconds == nil {
			expiresIn = time.Duration(store.DefaultExpiresIn) * time.Second
		}
		// A retainer's later month copies the first one's link, so it stays as Edit keeps an unchanged one.
		if r.ReturnURL != "" && r.cycle == nil && !store.Allows(r.ReturnURL) {
			return Invoice{}, false, fmt.Errorf("%w: returnUrl must start with one of the store's allowed origins",
				ErrInvalid)
		}
		storeID = &store.ID
	case r.StoreID != "":
		return Invoice{}, false, fmt.Errorf("%w: storeId: only a merchant profile has stores", ErrInvalid)
	}
	// R-136. A fixed retainer's later month keeps the token the client agreed to.
	if r.cycle == nil || usd != nil {
		off, err := profile.TokensOff(ctx, tx, profileID, derefOr(storeID))
		if err != nil {
			return Invoice{}, false, err
		}
		options = slices.DeleteFunc(options, func(o accepted) bool {
			return slices.Contains(off, profile.TokenPair{ChainID: o.chainID, Token: o.token})
		})
		if len(options) == 0 && usd == nil {
			return Invoice{}, false, fmt.Errorf("%w: token is turned off for this profile or its store", ErrInvalid)
		}
		if len(options) == 0 {
			return Invoice{}, false, fmt.Errorf("%w: every token is turned off for this profile or its store", ErrInvalid)
		}
	}
	var open, today int
	if err := tx.QueryRow(ctx, `SELECT count(*) FILTER (WHERE closes_at > $2),
		count(*) FILTER (WHERE created_at > now() - interval '1 day') FROM invoices WHERE profile_id = $1`,
		profileID, s.now().Unix()).Scan(&open, &today); err != nil {
		return Invoice{}, false, fmt.Errorf("count open invoices: %w", err)
	}
	// Each option is a watched receive address, so it counts.
	if open+len(options) > MaxOpen {
		return Invoice{}, false, fmt.Errorf("%w: a profile has at most %d receive addresses open at once", ErrInvalid, MaxOpen)
	}
	if today+len(options) > MaxPerDay {
		return Invoice{}, false, fmt.Errorf("%w: a profile creates at most %d receive addresses a day", ErrInvalid, MaxPerDay)
	}
	if r.Allow != nil {
		if wait := r.Allow(); wait > 0 {
			return Invoice{}, false, &TooSoonError{Wait: wait}
		}
	}
	expiresAt := s.now().UTC().Truncate(time.Second).Add(expiresIn)
	settleDeadline := expiresAt.Add(SettleWindow)
	var mainID *string
	var payToken [32]byte
	_, _ = rand.Read(payToken[:])
	first := address.InvoiceID(payToken)
	for i, o := range options {
		id := first
		if i > 0 {
			id = address.OptionID(first, o.chainID, hex20(o.token))
		}
		_, receive, err := buildTerms(id, o.chainID, o.token, recipient, o.amount, expiresAt, settleDeadline)
		if err != nil {
			return Invoice{}, false, err
		}
		// The main row takes the profile's next number, or none for a link invoice, and copies its billing details;
		// an option takes the main row's number (migrations 00008, 00009, 00020 and 00065).
		details, pay := r.Details, hex.EncodeToString(payToken[:])
		if mainID != nil {
			details, pay = Details{}, ""
		}
		var agreedCurrency, agreedDate *string
		var agreedAmount *int64
		var agreedDecimals *int
		if a := details.Agreed; a != nil {
			agreedCurrency, agreedAmount, agreedDecimals, agreedDate = &a.Currency, &a.Amount, &a.Decimals, &a.Date
		}
		_, err = tx.Exec(ctx, `
			INSERT INTO invoices (id, main_id, profile_id, chain_id, chain_family, token_contract, amount, expires_at,
			    settle_deadline, recipient_address, receive_method, factory_address, receive_address, idempotency_key,
			    request_hash, title, note, due_date, client_name, client_email, client_address, sender_name, return_url,
			    client_country, client_tax_id, supply_date, reference, agreed_currency, agreed_amount, agreed_decimals,
			    agreed_date, pay_token, store_id, link_id, metadata)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'evm_create2', $11, $12, $13, $14, NULLIF($15, ''),
			    NULLIF($16, ''), NULLIF($17, '')::date, NULLIF($18, ''), NULLIF($19, ''), NULLIF($20, ''), NULLIF($21, ''),
			    NULLIF($22, ''), NULLIF($23, ''), NULLIF($24, ''), NULLIF($25, '')::date, NULLIF($26, ''), $27, $28, $29, $30::date,
			    NULLIF($31, ''), $32, NULLIF($33, '')::uuid, $34)`,
			hexID(id), mainID, profileID, o.chainID, o.family, o.token, o.amount.String(), expiresAt.Unix(),
			settleDeadline.Unix(), recipient, hexAddress(address.Factory), receive, idempotencyKey, hash, details.Title,
			details.Note, details.DueDate, details.ClientName, details.ClientEmail, details.ClientAddress, details.SenderName,
			details.ReturnURL, details.ClientCountry, details.ClientTaxID, details.SupplyDate, details.Reference,
			agreedCurrency, agreedAmount, agreedDecimals, agreedDate, pay, storeID, r.LinkID, metadataJSON(details.Metadata))
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.ConstraintName == "invoices_profile_idempotency_key" {
			// A concurrent request with the same key won the insert.
			tx.Rollback(ctx)
			inv, err := s.replay(ctx, profileID, idempotencyKey, hash)
			return inv, false, err
		}
		if err != nil {
			return Invoice{}, false, fmt.Errorf("insert invoice: %w", err)
		}
		if mainID == nil {
			mainID = new(string)
			*mainID = hexID(id)
		}
	}
	// Lines are kept in the main option's base units, which its amount converted to exactly; the database checks they
	// add up to it when the transaction commits (migration 00030).
	for i, l := range lines {
		unitPrice := usdUnits(l.price, options[0].scale)
		amount := usdUnits(new(big.Rat).Mul(l.quantity, l.price), options[0].scale)
		if unitPrice == nil || amount == nil {
			return Invoice{}, false, fmt.Errorf("%w: lines need prices the token's decimals can hold", ErrInvalid)
		}
		if _, err := tx.Exec(ctx, `INSERT INTO invoice_lines (invoice_id, position, description, quantity, unit_price,
			amount) VALUES ($1, $2, $3, $4, $5, $6)`, *mainID, i+1, l.description, l.quantity.FloatString(2),
			unitPrice.String(), amount.String()); err != nil {
			return Invoice{}, false, fmt.Errorf("insert invoice line: %w", err)
		}
	}
	if r.Reminders {
		token, err := newStopToken()
		if err != nil {
			return Invoice{}, false, err
		}
		if _, err := tx.Exec(ctx, "INSERT INTO invoice_reminders (invoice_id, enabled, stop_token) VALUES ($1, true, $2)",
			*mainID, token); err != nil {
			return Invoice{}, false, fmt.Errorf("turn on invoice reminders: %w", err)
		}
	}
	if r.Repeat != nil {
		if err := s.startRetainer(ctx, tx, profileID, *mainID, r); err != nil {
			return Invoice{}, false, err
		}
	}
	if r.cycle != nil {
		if err := addCycle(ctx, tx, *r.cycle, profileID, *mainID, idempotencyKey); err != nil {
			return Invoice{}, false, err
		}
	}
	if r.After != nil {
		if err := r.After(ctx, tx, *mainID); err != nil {
			return Invoice{}, false, err
		}
	}
	by := r.By
	if by == "" {
		by = history.Owner
	}
	var replaced history.Data
	if r.Replaces != "" {
		if replaced, err = s.replace(ctx, tx, profileID, r.Replaces, *mainID, r.Stores); err != nil {
			return Invoice{}, false, err
		}
	}
	if err := history.Add(ctx, tx, *mainID, history.Created, by, replaced); err != nil {
		return Invoice{}, false, err
	}
	if err := tx.Commit(ctx); err != nil {
		return Invoice{}, false, fmt.Errorf("insert invoice: %w", err)
	}
	inv, err = s.get(ctx, profileID, *mainID)
	return inv, err == nil, err
}

func (s *Service) accepted(ctx context.Context, chainID uint64, token string, amount *big.Int, usd *big.Rat) ([]accepted, error) {
	if usd == nil {
		var family string
		var watched bool
		err := s.pool.QueryRow(ctx, `
			SELECT c.chain_family, EXISTS (SELECT 1 FROM chain_cursors cur WHERE cur.chain_id = c.chain_id)
			FROM chains c JOIN tokens t ON t.chain_id = c.chain_id
			WHERE c.chain_id = $1 AND c.enabled AND t.contract = $2 AND t.enabled`, chainID, token).Scan(&family, &watched)
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("%w: token is not enabled on this chain", ErrInvalid)
		}
		if err != nil {
			return nil, fmt.Errorf("read chain and token: %w", err)
		}
		if !watched {
			return nil, ErrNotWatched
		}
		return []accepted{{chainID: chainID, family: family, token: token, amount: amount}}, nil
	}
	// A chain the worker has not scanned yet is left out: a payment there before its first scan would never be seen
	// (SEC-02). Only EVM chains for now: one recipient wallet serves them all.
	rows, err := s.pool.Query(ctx, `
		SELECT c.chain_id, c.chain_family, t.contract, t.symbol, t.decimals
		FROM chains c JOIN tokens t ON t.chain_id = c.chain_id
		WHERE c.enabled AND t.enabled AND c.chain_family = 'evm'
		  AND EXISTS (SELECT 1 FROM chain_cursors cur WHERE cur.chain_id = c.chain_id)
		ORDER BY c.chain_id, t.symbol, t.contract`)
	if err != nil {
		return nil, fmt.Errorf("read enabled tokens: %w", err)
	}
	defer rows.Close()
	var out []accepted
	for rows.Next() {
		var a accepted
		var symbol string
		var decimals int
		if err := rows.Scan(&a.chainID, &a.family, &a.token, &symbol, &decimals); err != nil {
			return nil, fmt.Errorf("read enabled tokens: %w", err)
		}
		a.scale = decimals
		if a.amount = usdUnits(usd, decimals); a.amount == nil {
			return nil, fmt.Errorf("%w: amountUsd has more decimals than %s (%d) can hold", ErrInvalid, symbol, decimals)
		}
		out = append(out, a)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("read enabled tokens: %w", err)
	}
	if len(out) == 0 {
		return nil, ErrNotWatched
	}
	return out, nil
}

func (s *Service) replay(ctx context.Context, profileID, idempotencyKey string, hash []byte) (Invoice, error) {
	var id string
	var stored []byte
	err := s.pool.QueryRow(ctx, `SELECT id, request_hash FROM invoices
		WHERE profile_id = $1 AND idempotency_key = $2 AND main_id IS NULL`, profileID, idempotencyKey).Scan(&id, &stored)
	if errors.Is(err, pgx.ErrNoRows) {
		return Invoice{}, ErrNotFound
	}
	if err != nil {
		return Invoice{}, fmt.Errorf("read invoice: %w", err)
	}
	if !bytes.Equal(stored, hash) {
		return Invoice{}, ErrConflict
	}
	return s.get(ctx, profileID, id)
}

// replace cancels the profile's invoice old for next, made in tx (R-129), and returns what next's created row says.
// With stores set, an old invoice of another store is not found (R-138); so is one without a number yet (R-141).
func (s *Service) replace(ctx context.Context, tx pgx.Tx, profileID, old, next string, stores []string) (history.Data,
	error) {
	var oldNumber, nextNumber int64
	var oldStore string
	err := tx.QueryRow(ctx, `SELECT o.number, n.number, coalesce(o.store_id::text, '') FROM invoices o, invoices n
		WHERE o.id = $1 AND o.profile_id = $2 AND o.main_id IS NULL AND o.number IS NOT NULL AND n.id = $3`, old,
		profileID, next).
		Scan(&oldNumber, &nextNumber, &oldStore)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && stores != nil && !slices.Contains(stores, oldStore)) {
		return history.Data{}, ErrNotFound
	} else if err != nil {
		return history.Data{}, fmt.Errorf("read invoice %s to replace: %w", old, err)
	}
	if err := s.cancel(ctx, tx, profileID, old, next, history.Replaced,
		history.Data{Invoice: next, Number: nextNumber}); err != nil {
		return history.Data{}, err
	}
	return history.Data{Invoice: old, Number: oldNumber}, nil
}

func derefOr(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

// metadataJSON is the column's value: NULL for none, so an option row and an invoice made before it read as {}.
func metadataJSON(m map[string]string) []byte {
	if len(m) == 0 {
		return nil
	}
	b, _ := json.Marshal(m) // only strings: it can't fail
	return b
}
