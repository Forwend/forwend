package activity

import (
	"context"
	"errors"
	"fmt"
	"math/big"
	"slices"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

// What a wallet transfer was (R-108). Money in with no invoice and from none of the user's profiles is unclassified
// until the user gives it one of Labels.
const (
	ClassInvoice      = "invoice"
	ClassOwnTransfer  = "own_transfer"
	ClassSent         = "sent"
	ClassUnclassified = "unclassified"
	LabelIncome       = "income"
	LabelRefund       = "refund"
	LabelOther        = "other"
)

// Labels are what the user may call money in that Forwend can't classify.
var Labels = []string{LabelIncome, ClassOwnTransfer, LabelRefund, LabelOther}

var (
	// ErrNotFound: the profile's wallet has no such transfer.
	ErrNotFound = errors.New("transaction not found")
	// ErrNotLabelable: only money in that is neither an invoice payment nor an own transfer takes a label.
	ErrNotLabelable = errors.New("only money in that Forwend can't classify takes a label")
)

// TransferInvoice is the invoice money in paid: its main row's id, number and client ("" when it has none).
type TransferInvoice struct {
	ID         string
	Number     int64
	ClientName string
}

// Labelable: money in that Forwend can't classify, which the user may label (R-108).
func (t Transfer) Labelable() bool {
	return t.Direction == "in" && t.Invoice == nil && !t.own
}

// USDValue is the amount at receipt in USD: 1 USD per USD stablecoin (D-75, D-82).
func (t Transfer) USDValue() *big.Rat {
	return new(big.Rat).SetFrac(t.Amount, new(big.Int).Exp(big.NewInt(10), big.NewInt(int64(t.Decimals)), nil))
}

// Classification says what the transfer was (R-108).
func (t Transfer) Classification() string {
	switch {
	case t.Invoice != nil:
		return ClassInvoice
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

// AllTransfers returns the profile's transfers whose block time is in [from, to), newest first, for the records
// export (R-108). The caller has checked that the user owns the profile.
func (s *Service) AllTransfers(ctx context.Context, profileID string, from, to time.Time) ([]Transfer, error) {
	rows, err := s.pool.Query(ctx, transferSQL+` AND t.block_time >= $2 AND t.block_time < $3
		ORDER BY t.block_time DESC, t.id DESC`, profileID, from.Unix(), to.Unix())
	if err != nil {
		return nil, fmt.Errorf("read wallet transfers: %w", err)
	}
	items, err := pgx.CollectRows(rows, scanTransfer)
	if err != nil {
		return nil, fmt.Errorf("read wallet transfers: %w", err)
	}
	return items, nil
}

// SetLabel gives the profile's money in at (chain, transaction, log) one of Labels, or clears it with "" (R-108).
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
