package invoice

import (
	"context"
	"errors"
	"fmt"
	"math/big"
	"strings"

	"github.com/ensp1re/forwend/apps/backend/internal/finality"
	"github.com/jackc/pgx/v5"
)

// Get reads an invoice by its on-chain id (0x + 64 hex).
func (s *Service) Get(ctx context.Context, id string) (Invoice, error) {
	id = strings.ToLower(id)
	if len(id) != 66 || !strings.HasPrefix(id, "0x") || strings.Trim(id[2:], "0123456789abcdef") != "" {
		return Invoice{}, ErrNotFound
	}
	inv, err := scanInvoice(s.pool.QueryRow(ctx, "SELECT "+invoiceColumns+" FROM invoices WHERE id = $1", id))
	if err != nil {
		return Invoice{}, err
	}
	inv.Deposits, err = s.deposits(ctx, inv)
	return inv, err
}

// deposits lists the invoice's transfers that are not reorged, with progress toward the chain's finalized block.
func (s *Service) deposits(ctx context.Context, inv Invoice) ([]Deposit, error) {
	var head finality.Block
	err := s.pool.QueryRow(ctx, "SELECT last_finalized_block, last_finalized_time FROM chain_cursors WHERE chain_id = $1",
		inv.ChainID).Scan(&head.Number, &head.Time)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return nil, fmt.Errorf("read chain %d cursor: %w", inv.ChainID, err)
	}
	rows, err := s.pool.Query(ctx, `SELECT tx_hash, log_index, amount::text, block_number, block_time, status
		FROM chain_transfers WHERE invoice_id = $1 AND status <> 'reorged' ORDER BY block_number, log_index`, inv.ID)
	if err != nil {
		return nil, fmt.Errorf("read invoice %s deposits: %w", inv.ID, err)
	}
	defer rows.Close()
	out := []Deposit{}
	for rows.Next() {
		var d Deposit
		var amount string
		var blockTime uint64
		if err := rows.Scan(&d.TxHash, &d.LogIndex, &amount, &d.BlockNumber, &blockTime, &d.Status); err != nil {
			return nil, fmt.Errorf("read invoice %s deposits: %w", inv.ID, err)
		}
		d.Amount, _ = new(big.Int).SetString(amount, 10)
		d.Late = int64(blockTime) > inv.ExpiresAt.Unix()
		if d.Status != "confirmed" {
			p := finality.ProgressOf(finality.Block{Number: d.BlockNumber, Time: blockTime}, head)
			d.BlocksLeft, d.TimeLeft = p.BlocksLeft, p.TimeLeft
		}
		out = append(out, d)
	}
	return out, rows.Err()
}
