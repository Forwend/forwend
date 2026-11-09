package watcher

import (
	"context"
	"errors"
	"fmt"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/types"
)

var (
	ErrNoDeposit = errors.New("that transaction pays none of these receive addresses in its own token")
	ErrNotFinal  = errors.New("that transaction's block is not final yet: try again later")
)

// RecordDeposits records the deposits of one transaction to the given invoices from its receipt, for a deposit the
// scan missed (money-safety.md). The scan's checks hold: only the invoice's own token, in a finalized block of the
// same hash. It returns how many it recorded; one already confirmed stays as it is.
func (c *Chain) RecordDeposits(ctx context.Context, txHash common.Hash, invoiceIDs []string) (int64, error) {
	rows, err := c.pool.Query(ctx, `SELECT receive_address, id, token_contract FROM invoices
		WHERE chain_id = $1 AND id = ANY($2)`, c.chainID, invoiceIDs)
	if err != nil {
		return 0, fmt.Errorf("read chain %d invoices: %w", c.chainID, err)
	}
	defer rows.Close()
	invoices := map[common.Address]receiver{}
	for rows.Next() {
		var addr, id, token string
		if err := rows.Scan(&addr, &id, &token); err != nil {
			return 0, fmt.Errorf("read chain %d invoices: %w", c.chainID, err)
		}
		invoices[common.HexToAddress(addr)] = receiver{id, token}
	}
	if err := rows.Err(); err != nil {
		return 0, fmt.Errorf("read chain %d invoices: %w", c.chainID, err)
	}
	// Only the logs: go-ethereum can't decode every chain's receipts (S-4).
	var receipt *struct {
		Logs []types.Log `json:"logs"`
	}
	if err := c.rpc.CallContext(ctx, &receipt, "eth_getTransactionReceipt", txHash); err != nil {
		return 0, fmt.Errorf("read chain %d receipt %s: %w", c.chainID, txHash, err)
	}
	if receipt == nil {
		return 0, ErrNoDeposit
	}
	logs := invoiceLogs(receipt.Logs, invoices)
	if len(logs) == 0 {
		return 0, ErrNoDeposit
	}
	final, headers, err := c.headers(ctx, []uint64{logs[0].BlockNumber})
	if err != nil {
		return 0, err
	}
	deposits, _ := depositsOf(logs, headers, invoices, uint64(final.Number))
	if len(deposits) != len(logs) || !deposits[0].final {
		return 0, ErrNotFinal
	}
	tx, err := c.pool.Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback(ctx)
	confirmed := func() (n int64, err error) {
		err = tx.QueryRow(ctx, `SELECT count(*) FROM chain_transfers WHERE chain_id = $1 AND tx_hash = $2
			AND status = 'confirmed'`, c.chainID, deposits[0].txHash).Scan(&n)
		return n, err
	}
	before, err := confirmed()
	if err != nil {
		return 0, err
	}
	if err := c.insertDeposits(ctx, tx, deposits); err != nil {
		return 0, err
	}
	after, err := confirmed()
	if err != nil {
		return 0, err
	}
	return after - before, tx.Commit(ctx)
}
