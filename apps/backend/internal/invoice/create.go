package invoice

import (
	"bytes"
	"cmp"
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

	"github.com/forwend/forwend/apps/backend/internal/address"
	"github.com/forwend/forwend/apps/backend/internal/history"
	"github.com/forwend/forwend/apps/backend/internal/profile"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// Per source; a watched address stays in every scan until 30 days after its settle deadline.
const (
	MaxOpen   = 1000
	MaxPerDay = 500
)

type accepted struct {
	chainID                 uint64
	family, token           string
	live                    bool
	amount                  *big.Int
	scale                   int // 0 for a fixed invoice, the token's decimals for USD
	decimals                int
	networkFee, platformFee *big.Int // amount includes them when the client pays
}

// Create is idempotent per (profile, key); the caller checks the user's access to the profile.
func (s *Service) Create(ctx context.Context, profileID, idempotencyKey string, r Request) (inv Invoice, created bool, err error) {
	if r.Caller.Purpose != "" && r.Caller.Purpose != PurposeCheckout {
		return Invoice{}, false, fmt.Errorf("%w: unsupported payment purpose", ErrInvalid)
	}
	if r.Caller.Purpose == PurposeCheckout && (r.DueDate != "" || r.SupplyDate != "" || r.Agreed != nil ||
		r.Reminders || r.Repeat != nil || r.Replaces != "") {
		return Invoice{}, false, fmt.Errorf("%w: checkout does not issue a billing document", ErrInvalid)
	}
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
	// The hash uses DefaultExpiresIn, not the store's default, so a retry after the store changed still replays.
	var hash []byte
	if usd != nil {
		hash = requestHash(r, 0, "usd", usd, expiresIn, lines)
	} else {
		hash = requestHash(r, r.ChainID, token, amount, expiresIn, lines)
	}
	if inv, err := s.replay(ctx, profileID, idempotencyKey, hash, r.Caller.Livemode); !errors.Is(err, ErrNotFound) {
		return inv, false, err
	}

	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.ReadCommitted})
	if err != nil {
		return Invoice{}, false, fmt.Errorf("insert invoice: %w", err)
	}
	defer tx.Rollback(ctx)
	// The profile lock serializes creates, so none passes a cap on a stale count; NO KEY UPDATE still lets payment
	// events check their profile foreign key while holding invoice or link locks.
	var kind, feesPaidBy string
	var billed, live bool
	if err := tx.QueryRow(ctx, `SELECT kind,
		EXISTS (SELECT 1 FROM profile_billing_details WHERE profile_id = $1), livemode, fees_paid_by FROM profiles
		WHERE id = $1 FOR NO KEY UPDATE`, profileID).Scan(&kind, &billed, &live, &feesPaidBy); err != nil {
		return Invoice{}, false, fmt.Errorf("lock profile: %w", err)
	}
	// A concurrent create may have committed while this request waited for the profile lock.
	var exists bool
	if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM invoices WHERE profile_id = $1
	    AND idempotency_key = $2 AND main_id IS NULL)`, profileID, idempotencyKey).Scan(&exists); err != nil {
		return Invoice{}, false, fmt.Errorf("read concurrent payment request: %w", err)
	}
	if exists {
		tx.Rollback(ctx)
		inv, err := s.replay(ctx, profileID, idempotencyKey, hash, r.Caller.Livemode)
		return inv, false, err
	}
	if r.Caller.Purpose == PurposeCheckout && kind == profile.Personal {
		return Invoice{}, false, fmt.Errorf("%w: personal profiles use payment requests", ErrInvalid)
	}
	var purpose *Purpose
	var documentKind *DocumentKind
	if r.Caller.Purpose != "" {
		purpose = &r.Caller.Purpose
		document := DocumentNone
		documentKind = &document
	}
	options, err := s.accepted(ctx, tx, r.ChainID, token, amount, usd)
	if err != nil {
		return Invoice{}, false, err
	}
	var recipient string
	err = tx.QueryRow(ctx, "SELECT address FROM profile_wallets WHERE profile_id = $1 AND chain_family = $2",
		profileID, options[0].family).Scan(&recipient)
	if errors.Is(err, pgx.ErrNoRows) {
		return Invoice{}, false, fmt.Errorf("%w: the profile has no wallet for this chain", ErrInvalid)
	}
	if err != nil {
		return Invoice{}, false, fmt.Errorf("read profile wallet: %w", err)
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
		// A retainer's later month keeps the first month's link, as Edit keeps an unchanged one.
		if r.ReturnURL != "" && r.cycle == nil && !store.Allows(r.ReturnURL) {
			return Invoice{}, false, fmt.Errorf("%w: returnUrl must start with one of the store's allowed origins",
				ErrInvalid)
		}
		storeID = &store.ID
	case r.StoreID != "":
		return Invoice{}, false, fmt.Errorf("%w: storeId: only a merchant profile has stores", ErrInvalid)
	}
	// Turned-off tokens leave the options, but a fixed retainer's later month keeps the token the client agreed to.
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
	// One mode for all options: the key's, the job's or the followed invoice's, else the profile's.
	follows, err := followedMode(ctx, tx, profileID, r)
	if err != nil {
		return Invoice{}, false, err
	}
	if follows != nil {
		live = *follows
	}
	if r.Caller.Livemode != nil {
		if follows != nil && *follows != *r.Caller.Livemode {
			return Invoice{}, false, ErrNotFound // a key's Revise of an invoice of the other mode
		}
		live = *r.Caller.Livemode
	}
	options = slices.DeleteFunc(options, func(o accepted) bool { return o.live != live })
	if len(options) == 0 && usd == nil {
		return Invoice{}, false, fmt.Errorf("%w: this invoice must be %s mode, and the token is in the other mode",
			ErrInvalid, modeName(live))
	}
	if len(options) == 0 {
		return Invoice{}, false, fmt.Errorf("%w: this invoice must be %s mode, and no token of that mode is enabled",
			ErrInvalid, modeName(live))
	}
	r.FeesPaidBy = cmp.Or(r.FeesPaidBy, feesPaidBy)
	if options, err = s.withFees(ctx, options, usd != nil, r.FeesPaidBy == FeesPaidByClient); err != nil {
		return Invoice{}, false, err
	}
	// Link payers and checkout shoppers have their own quotas, so strangers can't use up the owner's.
	source, whose, has, creates := "invoice", "a profile", "has", "creates"
	switch {
	case r.Caller.LinkID != "":
		source, whose, has, creates = "link", "a profile's payment links", "have", "create"
	case r.Caller.Purpose == PurposeCheckout:
		source, whose, has, creates = "checkout", "a profile's checkout sessions", "have", "create"
	}
	// A stranger's expired unpaid checkout leaves the day's count, so unpaid checkouts can't block the day.
	var open, today int
	if err := tx.QueryRow(ctx, `SELECT count(*) FILTER (WHERE closes_at > $2),
		count(*) FILTER (WHERE created_at > now() - interval '1 day' AND NOT ($3 <> 'invoice' AND payment_status = 'expired'))
		FROM invoices WHERE profile_id = $1 AND (closes_at > $2 OR created_at > now() - interval '1 day')
		  AND CASE WHEN link_id IS NOT NULL THEN 'link'
		    WHEN purpose = 'checkout' THEN 'checkout' ELSE 'invoice' END = $3`,
		profileID, s.currentTime().Unix(), source).Scan(&open, &today); err != nil {
		return Invoice{}, false, fmt.Errorf("count open invoices: %w", err)
	}
	if open+len(options) > MaxOpen {
		return Invoice{}, false, fmt.Errorf("%w: %s %s at most %d receive addresses open at once", ErrInvalid, whose, has, MaxOpen)
	}
	if today+len(options) > MaxPerDay {
		return Invoice{}, false, fmt.Errorf("%w: %s %s at most %d receive addresses a day", ErrInvalid, whose, creates, MaxPerDay)
	}
	if r.Caller.Before != nil {
		if err := r.Caller.Before(ctx, tx); err != nil {
			return Invoice{}, false, err
		}
	}
	if r.Caller.Allow != nil {
		if wait := r.Caller.Allow(); wait > 0 {
			return Invoice{}, false, &TooSoonError{Wait: wait}
		}
	}
	now := s.currentTime()
	if s.now == nil {
		// Creation and expiry share the transaction clock, including time spent waiting for the profile lock.
		if err := tx.QueryRow(ctx, "SELECT transaction_timestamp()").Scan(&now); err != nil {
			return Invoice{}, false, fmt.Errorf("read invoice creation time: %w", err)
		}
	}
	now = now.UTC().Truncate(time.Second)
	expiresAt := now.Add(expiresIn)
	// A due date without expiresIn keeps the checkout open to the end of the 60th UTC day after, within the limits.
	if r.ExpiresInSeconds == nil && r.DueDate != "" {
		due, _ := time.Parse(time.DateOnly, r.DueDate) // checked with the details
		expiresAt = due.AddDate(0, 0, DueGraceDays+1)
		if earliest := now.Add(MinExpiresIn); expiresAt.Before(earliest) {
			expiresAt = earliest
		}
		if latest := now.Add(MaxExpiresIn); expiresAt.After(latest) {
			expiresAt = latest
		}
	}
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
		receive, err := receiveAddress(id, o.chainID, o.token, recipient, o.amount, o.networkFee, o.platformFee, expiresAt,
			settleDeadline)
		if err != nil {
			return Invoice{}, false, err
		}
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
			    agreed_date, pay_token, store_id, link_id, metadata, purpose, document_kind, network_fee, platform_fee,
			    fees_paid_by)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'evm_create2', $11, $12, $13, $14, NULLIF($15, ''),
			    NULLIF($16, ''), NULLIF($17, '')::date, NULLIF($18, ''), NULLIF($19, ''), NULLIF($20, ''), NULLIF($21, ''),
			    NULLIF($22, ''), NULLIF($23, ''), NULLIF($24, ''), NULLIF($25, '')::date, NULLIF($26, ''), $27, $28, $29, $30::date,
			    NULLIF($31, ''), $32, NULLIF($33, '')::uuid, $34, $35, $36, $37, $38, $39)`,
			hexID(id), mainID, profileID, o.chainID, o.family, o.token, o.amount.String(), expiresAt.Unix(),
			settleDeadline.Unix(), recipient, hexAddress(address.Factory), receive, idempotencyKey, hash, details.Title,
			details.Note, details.DueDate, details.ClientName, details.ClientEmail, details.ClientAddress, details.SenderName,
			details.ReturnURL, details.ClientCountry, details.ClientTaxID, details.SupplyDate, details.Reference,
			agreedCurrency, agreedAmount, agreedDecimals, agreedDate, pay, storeID, r.Caller.LinkID, metadataJSON(details.Metadata),
			purpose, documentKind, o.networkFee.String(), o.platformFee.String(), r.FeesPaidBy)
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.ConstraintName == "invoices_profile_idempotency_key" {
			// A concurrent request with the same key won the insert.
			tx.Rollback(ctx)
			inv, err := s.replay(ctx, profileID, idempotencyKey, hash, r.Caller.Livemode)
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
	// Lines are in the main option's base units; the database checks at commit that they add up to its amount.
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
	if r.Caller.After != nil {
		if err := r.Caller.After(ctx, tx, *mainID); err != nil {
			return Invoice{}, false, err
		}
	}
	by := r.Caller.By
	if by == "" {
		by = history.Owner
	}
	var replaced history.Data
	if r.Replaces != "" {
		if replaced, err = s.replace(ctx, tx, profileID, r.Replaces, *mainID, r.Caller.Stores); err != nil {
			return Invoice{}, false, err
		}
	}
	if err := history.Add(ctx, tx, *mainID, history.Created, by, replaced); err != nil {
		return Invoice{}, false, err
	}
	if err := tx.Commit(ctx); err != nil {
		return Invoice{}, false, fmt.Errorf("insert invoice: %w", err)
	}
	inv, err = s.get(ctx, profileID, *mainID, false)
	return inv, err == nil, err
}

func (s *Service) accepted(ctx context.Context, tx pgx.Tx, chainID uint64, token string, amount *big.Int, usd *big.Rat) ([]accepted, error) {
	if usd == nil {
		var family, symbol string
		var decimals int
		var live, watched bool
		err := tx.QueryRow(ctx, `
			SELECT c.chain_family, c.livemode, t.symbol, t.decimals,
			    EXISTS (SELECT 1 FROM chain_cursors cur WHERE cur.chain_id = c.chain_id)
			FROM chains c JOIN tokens t ON t.chain_id = c.chain_id
			WHERE c.chain_id = $1 AND c.enabled AND t.contract = $2 AND t.enabled`, chainID, token).Scan(&family, &live,
			&symbol, &decimals, &watched)
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("%w: token is not enabled on this chain", ErrInvalid)
		}
		if err != nil {
			return nil, fmt.Errorf("read chain and token: %w", err)
		}
		if !watched {
			return nil, ErrNotWatched
		}
		// Every enabled token is a stablecoin worth 1 USD, so 1.00 USD is one whole token.
		if least := usdUnits(minUSD, decimals); least == nil || amount.Cmp(least) < 0 {
			return nil, fmt.Errorf("%w: amount must be at least 1.00 %s", ErrInvalid, symbol)
		}
		return []accepted{{chainID: chainID, family: family, token: token, live: live, amount: amount, decimals: decimals}}, nil
	}
	// An unscanned chain is left out: a payment before its first scan would never be seen.
	rows, err := tx.Query(ctx, `
		SELECT c.chain_id, c.chain_family, c.livemode, t.contract, t.symbol, t.decimals
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
		if err := rows.Scan(&a.chainID, &a.family, &a.live, &a.token, &symbol, &decimals); err != nil {
			return nil, fmt.Errorf("read enabled tokens: %w", err)
		}
		a.scale, a.decimals = decimals, decimals
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

// replay returns the invoice an earlier create with this key made; a key of the other mode can't read it.
func (s *Service) replay(ctx context.Context, profileID, idempotencyKey string, hash []byte, live *bool) (Invoice,
	error) {
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
	inv, err := s.get(ctx, profileID, id, false)
	if err == nil && live != nil && inv.Livemode != *live {
		return Invoice{}, ErrConflict
	}
	return inv, err
}

// replace cancels old for next in tx; with stores set, another store's or an unnumbered invoice is not found.
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

// metadataJSON is NULL for none, so rows without metadata read as {}.
func metadataJSON(m map[string]string) []byte {
	if len(m) == 0 {
		return nil
	}
	b, _ := json.Marshal(m) // only strings: it can't fail
	return b
}

func followedMode(ctx context.Context, tx pgx.Tx, profileID string, r Request) (*bool, error) {
	var live bool
	var err error
	switch {
	case r.cycle != nil:
		err = tx.QueryRow(ctx, `SELECT c.livemode FROM retainer_invoices x JOIN invoices i ON i.id = x.invoice_id
			JOIN chains c ON c.chain_id = i.chain_id WHERE x.retainer_id = $1 ORDER BY x.cycle LIMIT 1`,
			r.cycle.retainer).Scan(&live)
	case r.Replaces != "":
		err = tx.QueryRow(ctx, `SELECT c.livemode FROM invoices i JOIN chains c ON c.chain_id = i.chain_id
			WHERE i.id = $1 AND i.profile_id = $2`, r.Replaces, profileID).Scan(&live)
	default:
		return nil, nil
	}
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil // replace answers for an invoice the profile doesn't have
	}
	if err != nil {
		return nil, fmt.Errorf("read the mode of the invoice it follows: %w", err)
	}
	return &live, nil
}

func modeName(live bool) string {
	if live {
		return "live"
	}
	return "test"
}

// receiveAddress refuses terms settle() would refuse, so no payer sees an address whose money can only be refunded.
func receiveAddress(id [32]byte, chainID uint64, token, recipient string, amount, networkFee, platformFee *big.Int,
	expiresAt, settleDeadline time.Time) (string, error) {
	t := address.Terms{
		InvoiceID:       id,
		Recipient:       hex20(recipient),
		Token:           hex20(token),
		Amount:          amount,
		ExpiresAt:       uint64(expiresAt.Unix()),
		SettleDeadline:  uint64(settleDeadline.Unix()),
		IntendedChainID: chainID,
		NetworkFee:      networkFee,
		PlatformFee:     platformFee,
	}
	receiver, err := address.Receive(t)
	if err != nil {
		return "", fmt.Errorf("%w: %w", ErrInvalid, err)
	}
	if address.Ours(t.Recipient) {
		return "", fmt.Errorf("%w: the profile wallet can't receive these terms", ErrInvalid)
	}
	for _, a := range [][20]byte{{}, receiver, t.Token} {
		if t.Recipient == a {
			return "", fmt.Errorf("%w: the profile wallet can't receive these terms", ErrInvalid)
		}
	}
	return hexAddress(receiver), nil
}

func hex20(s string) [20]byte {
	var a [20]byte
	_, _ = hex.Decode(a[:], []byte(strings.TrimPrefix(s, "0x")))
	return a
}

func hexAddress(a [20]byte) string {
	return "0x" + hex.EncodeToString(a[:])
}
