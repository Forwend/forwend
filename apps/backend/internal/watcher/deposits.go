package watcher

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"maps"
	"math/big"
	"strings"
	"time"

	"github.com/ethereum/go-ethereum"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/common/hexutil"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/forwend/forwend/apps/backend/internal/address"
	"github.com/forwend/forwend/apps/backend/internal/chain"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

type receiver struct{ invoiceID, token string }

type deposit struct {
	invoiceID, token        string
	txHash, blockHash, from string
	to                      string
	logIndex, blockNumber   uint64
	blockTime               uint64
	amount                  *big.Int
	final                   bool
	finalized               uint64 // the chain's finalized block in the scan that saw it
}

func depositsOf(logs []types.Log, headers map[uint64]header, invoices map[common.Address]receiver,
	finalized uint64) ([]deposit, map[logKey]bool) {
	var deposits []deposit
	seen := map[logKey]bool{}
	for _, l := range logs {
		h, ok := headers[l.BlockNumber]
		if !ok || h.Hash != l.BlockHash {
			continue // this node's view moved since eth_getLogs; the next scan sees it again
		}
		inv := invoices[common.BytesToAddress(l.Topics[2].Bytes())]
		d := deposit{
			// The emitting contract, not the invoice's token: the foreign key then also rejects a mismatch.
			invoiceID: inv.invoiceID, token: hexutil.Encode(l.Address[:]), txHash: hexutil.Encode(l.TxHash[:]),
			blockHash: hexutil.Encode(l.BlockHash[:]), from: hexutil.Encode(l.Topics[1][12:]),
			to: hexutil.Encode(l.Topics[2][12:]), logIndex: uint64(l.Index), blockNumber: l.BlockNumber,
			blockTime: uint64(h.Timestamp), amount: new(big.Int).SetBytes(l.Data), final: l.BlockNumber <= finalized,
			finalized: finalized,
		}
		deposits = append(deposits, d)
		seen[logKey{d.blockHash, d.logIndex}] = true
	}
	return deposits, seen
}

// A confirmed row may be booked and never changes; a reorged one comes back if its block is canonical again.
func (c *Chain) insertDeposits(ctx context.Context, tx pgx.Tx, deposits []deposit) error {
	for _, d := range deposits {
		status := "detected"
		if d.final {
			status = "confirmed"
		}
		row, err := tx.Begin(ctx)
		if err != nil {
			return fmt.Errorf("record chain %d deposit %s/%d: %w", c.chainID, d.txHash, d.logIndex, err)
		}
		_, err = row.Exec(ctx, `
			INSERT INTO chain_transfers (chain_id, chain_family, token_contract, invoice_id, tx_hash, log_index,
			    block_hash, block_number, block_time, from_address, to_address, amount, status, detected_finalized_block)
			VALUES ($1, 'evm', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
			ON CONFLICT (chain_id, block_hash, log_index) DO UPDATE SET status = excluded.status
			WHERE chain_transfers.status <> 'confirmed' AND chain_transfers.status <> excluded.status`,
			c.chainID, d.token, d.invoiceID, d.txHash, d.logIndex, d.blockHash, d.blockNumber, d.blockTime,
			d.from, d.to, d.amount.String(), status, d.finalized)
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.ConstraintName == "chain_transfers_live_log" {
			// The same transaction under another block: one bad node must not stop the scan; an operator decides.
			_ = row.Rollback(ctx)
			slog.Error("ALERT deposit recorded under another block was mined again; skipped", "chain", c.chainID,
				"tx", d.txHash, "log", d.logIndex, "block", d.blockHash)
			continue
		}
		if err == nil {
			err = row.Commit(ctx)
		}
		if err != nil {
			return fmt.Errorf("record chain %d deposit %s/%d: %w", c.chainID, d.txHash, d.logIndex, err)
		}
	}
	return nil
}

func (c *Chain) invoices(ctx context.Context) (map[common.Address]receiver, error) {
	// Past address.MaxHold after the settle deadline only the refund authority moves the money: not watching those
	// keeps topic lists bounded. One with a detected deposit stays, or it would hold every scan's start for good.
	out, err := receiversOf(c.pool.Query(ctx, `SELECT receive_address, id, token_contract FROM invoices
		WHERE chain_id = $1 AND settle_deadline > extract(epoch FROM now())::bigint - $2
		UNION ALL SELECT receive_address, id, token_contract FROM invoices
		WHERE chain_id = $1 AND settle_deadline <= extract(epoch FROM now())::bigint - $2
		  AND id IN (SELECT invoice_id FROM chain_transfers WHERE status = 'detected')`,
		c.chainID, int64(watchedAfterDeadline/time.Second)))
	if err != nil {
		return nil, fmt.Errorf("read chain %d invoices: %w", c.chainID, err)
	}
	return out, nil
}

func receiversOf(rows pgx.Rows, err error) (map[common.Address]receiver, error) {
	if err != nil {
		return nil, err
	}
	out := map[common.Address]receiver{}
	var addr string
	var r receiver
	_, err = pgx.ForEachRow(rows, []any{&addr, &r.invoiceID, &r.token}, func() error {
		out[common.HexToAddress(addr)] = r
		return nil
	})
	return out, err
}

var watchedAfterDeadline = address.MaxHold

// mayHoldMoneySQL is ledger.MayHoldMoneySQL (a test keeps them equal): the ledger's tests run the watcher.
const mayHoldMoneySQL = `refund_status IN ('held', 'refund_pending') OR settlement_status <> 'settled' AND payment_status <> 'expired'`

// holding adds receivers past the watch window that still hold booked money: the refund authority may move it.
func (c *Chain) holding(ctx context.Context, invoices map[common.Address]receiver) (map[common.Address]receiver, error) {
	out, err := receiversOf(c.pool.Query(ctx, `SELECT receive_address, id, token_contract FROM invoices i
		WHERE chain_id = $1 AND settle_deadline <= extract(epoch FROM now())::bigint - $2
		  AND (`+mayHoldMoneySQL+`)
		  AND (SELECT coalesce(sum(e.amount), 0) FROM ledger_entries e JOIN ledger_transactions t ON t.id = e.transaction_id
		       WHERE t.invoice_id = i.id AND e.account = 'receiver') > 0`,
		c.chainID, int64(watchedAfterDeadline/time.Second)))
	if err != nil {
		return nil, fmt.Errorf("read chain %d receivers holding money: %w", c.chainID, err)
	}
	maps.Copy(out, invoices)
	return out, nil
}

func (c *Chain) logs(ctx context.Context, lo, hi uint64, invoices map[common.Address]receiver) ([]types.Log, error) {
	tokens := map[common.Address]bool{}
	var receivers []common.Hash
	for addr, inv := range invoices {
		tokens[common.HexToAddress(inv.token)] = true
		receivers = append(receivers, common.BytesToHash(addr.Bytes()))
	}
	if tokens[arcUSDC] {
		tokens[ArcEmitter] = true // Arc USDC sent as the native coin logs only there
	}
	var tokenList []common.Address
	for t := range tokens {
		tokenList = append(tokenList, t)
	}
	var logs []types.Log
	for _, part := range parts(receivers) {
		found, err := c.filterLogs(ctx, ethereum.FilterQuery{
			FromBlock: new(big.Int).SetUint64(lo), ToBlock: new(big.Int).SetUint64(hi),
			Addresses: tokenList, Topics: [][]common.Hash{{chain.TransferTopic}, nil, part},
		})
		if err != nil {
			return nil, fmt.Errorf("read chain %d logs %d-%d: %w", c.chainID, lo, hi, err)
		}
		logs = append(logs, found...)
	}
	logs, err := c.arcTwins(ctx, "chain_transfers", invoiceLogs(logs, invoices))
	return nativeSends(logs), err
}

// invoiceLogs keeps non-zero Transfer logs of each invoice's own token to its receive address, plus Arc system logs.
func invoiceLogs(logs []types.Log, invoices map[common.Address]receiver) []types.Log {
	var out []types.Log
	for _, l := range logs {
		if l.Removed || len(l.Topics) != 3 || l.Topics[0] != chain.TransferTopic || len(l.Data) != 32 ||
			new(big.Int).SetBytes(l.Data).Sign() == 0 {
			continue
		}
		inv, ok := invoices[common.BytesToAddress(l.Topics[2].Bytes())]
		// Only the invoice's own token counts: anyone can emit Transfer from a look-alike contract.
		if ok && (strings.EqualFold(l.Address.Hex(), inv.token) || l.Address == ArcEmitter && common.HexToAddress(inv.token) == arcUSDC) {
			out = append(out, l)
		}
	}
	return out
}
