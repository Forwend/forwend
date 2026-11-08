package activity

import (
	"context"
	"errors"
	"fmt"
	"math/big"
	"slices"
	"strings"
	"time"

	"github.com/forwend/forwend/apps/backend/internal/invoice"
	"github.com/jackc/pgx/v5"
)

// What a wallet transfer was (R-108). Money in with no invoice and from none of the user's profiles is unclassified
// until the user gives it one of Labels.
const (
	ClassInvoice          = "invoice"
	ClassPayment          = "payment"
	ClassPaymentException = "payment_exception"
	ClassOwnTransfer      = "own_transfer"
	ClassSent             = "sent"
	ClassUnclassified     = "unclassified"
	LabelIncome           = "income"
	LabelRefund           = "refund"
	LabelOther            = "other"
)

var Labels = []string{LabelIncome, ClassOwnTransfer, LabelRefund, LabelOther}

var (
	ErrNotFound     = errors.New("transaction not found")
	ErrNotLabelable = errors.New("only money in that Forwend can't classify takes a label")
)

// TransferInvoice is the main invoice row; ClientName is "" when it has none.
type TransferInvoice struct {
	ID         string
	Number     int64
	ClientName string
}

type TransferPayment struct {
	ID              string
	Purpose         invoice.Purpose
	DocumentKind    invoice.DocumentKind
	PolicyException string
	Unreconciled    bool
	// Fees are what the settlement behind the transfer paid out of the payment before the rest reached the wallet
	// (R-228); nil when it paid none.
	Fees *big.Int
}

// R-108.
func (t Transfer) Labelable() bool {
	return t.Direction == "in" && !t.own && (t.Payment == nil && t.Invoice == nil ||
		t.Payment != nil && (t.Payment.PolicyException != "" || t.Payment.Unreconciled))
}

// USDValue is the amount at receipt in USD: 1 USD per USD stablecoin (D-75, D-82).
func (t Transfer) USDValue() *big.Rat {
	return new(big.Rat).SetFrac(t.Amount, new(big.Int).Exp(big.NewInt(10), big.NewInt(int64(t.Decimals)), nil))
}

// RecordsValue is the USD value in the records currency (R-110) at the ECB rates of the latest day on or before
// the transfer's UTC day, within 7 days, rounded half up. ok is false without a records currency or such a rate.
func (t Transfer) RecordsValue() (amount string, day time.Time, ok bool) {
	if t.RecordsCurrency == "" || t.fx == nil {
		return "", time.Time{}, false
	}
	v := new(big.Rat).Quo(t.USDValue(), t.fx.usd)
	// FloatString rounds halves away from zero, which for a value at or above 0 is half up.
	return v.Mul(v, t.fx.cur).FloatString(invoice.AgreedCurrencies[t.RecordsCurrency]), t.fx.day, true
}

// R-108.
func (t Transfer) Classification() string {
	switch {
	case t.Payment != nil && (t.Payment.PolicyException != "" || t.Payment.Unreconciled):
		if t.Label != "" {
			return t.Label
		}
		return ClassPaymentException
	case t.Invoice != nil:
		return ClassInvoice
	case t.Payment != nil:
		return ClassPayment
	case t.own:
		return ClassOwnTransfer
	case t.Direction == "out":
		return ClassSent
	case t.Label != "":
		return t.Label
	default:
		return ClassUnclassified
	}
}

// MaxExportRows bounds one export or statement (R-118): anyone can send dust to a wallet and the watcher records each
// transfer, so the work of one request must not grow with it.
const MaxExportRows = 10000

var ErrTooMany = errors.New("too many transactions in the period")

// EachTransfer calls fn with each transfer in [from, to), newest first, for the export and statement (R-108,
// R-112); past MaxExportRows it returns ErrTooMany. The caller has checked the user's access to the profile.
func (s *Service) EachTransfer(ctx context.Context, profileID string, from, to time.Time, fn func(Transfer) error) error {
	return s.ExportTransfers(ctx, profileID, from, to, func(string) error { return nil }, fn)
}

// ExportTransfers reads the currency header and every transfer from one financial snapshot.
func (s *Service) ExportTransfers(ctx context.Context, profileID string, from, to time.Time, header func(string) error, fn func(Transfer) error) error {
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return fmt.Errorf("open wallet export snapshot: %w", err)
	}
	defer tx.Rollback(ctx)
	var currency string
	if err := tx.QueryRow(ctx, "SELECT coalesce(records_currency, '') FROM profiles WHERE id = $1", profileID).Scan(&currency); err != nil {
		return fmt.Errorf("read export currency: %w", err)
	}
	if err := header(currency); err != nil {
		return err
	}
	var count int
	if err := tx.QueryRow(ctx, `SELECT count(*) FROM (SELECT 1 FROM wallet_transfers t
      JOIN profile_wallets w ON w.chain_family = t.chain_family AND w.address = t.wallet_address
      WHERE w.profile_id = $1 AND t.status <> 'reorged' AND t.block_time >= $2 AND t.block_time < $3
        AND `+inMode("t.chain_id")+` AND `+notFee+`
      LIMIT $4) bounded`, profileID, from.Unix(), to.Unix(), MaxExportRows+1).Scan(&count); err != nil {
		return fmt.Errorf("count wallet export rows: %w", err)
	}
	if count > MaxExportRows {
		return ErrTooMany
	}
	rows, err := tx.Query(ctx, transferSQL+` AND t.block_time >= $2 AND t.block_time < $3
        ORDER BY t.block_time DESC, t.id DESC LIMIT $4`, profileID, from.Unix(), to.Unix(), MaxExportRows+1)
	if err != nil {
		return fmt.Errorf("read wallet transfers: %w", err)
	}
	defer rows.Close()
	for n := 1; rows.Next(); n++ {
		if n > MaxExportRows {
			return ErrTooMany
		}
		t, err := scanTransfer(rows)
		if err != nil {
			return fmt.Errorf("read wallet transfers: %w", err)
		}
		if err := fn(t); err != nil {
			return err
		}
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("read wallet transfers: %w", err)
	}
	return tx.Commit(ctx)
}

// SetLabel clears the label with "" (R-108).
func (s *Service) SetLabel(ctx context.Context, profileID string, chainID uint64, txHash string, logIndex uint64,
	label string) error {
	if label != "" && !slices.Contains(Labels, label) {
		return fmt.Errorf("%w: label must be one of %s", ErrInvalid, strings.Join(Labels, ", "))
	}
	txHash = strings.ToLower(txHash)
	rows, err := s.pool.Query(ctx, transferSQL+" AND t.chain_id = $2 AND t.tx_hash = $3 AND t.log_index = $4",
		profileID, chainID, txHash, logIndex)
	if err != nil {
		return fmt.Errorf("read wallet transfer: %w", err)
	}
	found, err := pgx.CollectRows(rows, scanTransfer)
	if err != nil {
		return fmt.Errorf("read wallet transfer: %w", err)
	}
	if len(found) == 0 {
		return ErrNotFound
	}
	if !slices.ContainsFunc(found, Transfer.Labelable) {
		return ErrNotLabelable
	}
	if label == "" {
		_, err = s.pool.Exec(ctx, `DELETE FROM transfer_labels WHERE profile_id = $1 AND chain_id = $2 AND tx_hash = $3
			AND log_index = $4`, profileID, chainID, txHash, logIndex)
	} else {
		_, err = s.pool.Exec(ctx, `INSERT INTO transfer_labels (profile_id, chain_id, tx_hash, log_index, label)
			VALUES ($1, $2, $3, $4, $5) ON CONFLICT (profile_id, chain_id, tx_hash, log_index)
			DO UPDATE SET label = excluded.label, updated_at = now()`, profileID, chainID, txHash, logIndex, label)
	}
	if err != nil {
		return fmt.Errorf("label wallet transfer: %w", err)
	}
	return nil
}

// RecordsCurrency is the profile's other records currency (R-110), "" for none.
func (s *Service) RecordsCurrency(ctx context.Context, profileID string) (string, error) {
	var currency string
	if err := s.pool.QueryRow(ctx, "SELECT coalesce(records_currency, '') FROM profiles WHERE id = $1", profileID).
		Scan(&currency); err != nil {
		return "", fmt.Errorf("read records currency: %w", err)
	}
	return currency, nil
}

// USD is refused: every record has it already. "" clears the currency.
func (s *Service) SetRecordsCurrency(ctx context.Context, profileID, currency string) error {
	if _, ok := invoice.AgreedCurrencies[currency]; currency != "" && (!ok || currency == "USD") {
		return fmt.Errorf("%w: currency must be EUR or a currency the ECB publishes a rate for, other than USD", ErrInvalid)
	}
	if _, err := s.pool.Exec(ctx, "UPDATE profiles SET records_currency = NULLIF($2, '') WHERE id = $1", profileID,
		currency); err != nil {
		return fmt.Errorf("save records currency: %w", err)
	}
	return nil
}
