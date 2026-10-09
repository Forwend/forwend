// Package watcher records deposits to receive addresses: Transfer logs of each invoice's own token, detected when
// seen, confirmed once their block is at or below the chain's finalized block (D-45), reorged when they vanish (R-20).
package watcher

import (
	"context"
	"errors"
	"fmt"
	"math/big"
	"strings"

	"github.com/ethereum/go-ethereum"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/common/hexutil"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/ethereum/go-ethereum/ethclient"
	"github.com/ethereum/go-ethereum/rpc"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var transferTopic = crypto.Keccak256Hash([]byte("Transfer(address,address,uint256)"))

// MaxRange is the most blocks one eth_getLogs call covers; RPCs reject larger result sets (S-4).
const MaxRange = 2000

// Chain watches one EVM chain. Run one Chain per chain: two at once would race on the cursor.
type Chain struct {
	pool    *pgxpool.Pool
	chainID uint64
	rpc     *rpc.Client
	eth     *ethclient.Client
}

func NewChain(pool *pgxpool.Pool, chainID uint64, client *rpc.Client) *Chain {
	return &Chain{pool: pool, chainID: chainID, rpc: client, eth: ethclient.NewClient(client)}
}

// header is a block as the RPC reports it. The hash is never computed in Go: go-ethereum gets it wrong on Tempo (S-4).
type header struct {
	Number    hexutil.Uint64 `json:"number"`
	Hash      common.Hash    `json:"hash"`
	Timestamp hexutil.Uint64 `json:"timestamp"`
}

// receiver is the invoice paid at a receive address, in its own token.
type receiver struct{ invoiceID, token string }

type deposit struct {
	invoiceID, token        string
	txHash, blockHash, from string
	to                      string
	logIndex, blockNumber   uint64
	blockTime               uint64
	amount                  *big.Int
	final                   bool
}

// Scan reads the chain from just above the last finalized block (or the oldest unconfirmed deposit) to the latest
// block and records the result in one transaction. Scanning the same range again changes nothing.
func (c *Chain) Scan(ctx context.Context) error {
	finalized, err := c.header(ctx, "finalized")
	if err != nil {
		return err
	}
	latest, err := c.header(ctx, "latest")
	if err != nil {
		return err
	}
	from, err := c.start(ctx, uint64(finalized.Number))
	if err != nil {
		return err
	}
	invoices, err := c.invoices(ctx)
	if err != nil {
		return err
	}

	var deposits []deposit
	for lo := from; lo <= uint64(latest.Number) && len(invoices) > 0; lo += MaxRange {
		hi := min(lo+MaxRange-1, uint64(latest.Number))
		found, err := c.deposits(ctx, lo, hi, invoices, uint64(finalized.Number))
		if err != nil {
			return err
		}
		deposits = append(deposits, found...)
	}
	return c.record(ctx, from, uint64(finalized.Number), uint64(latest.Number), deposits)
}

// start is where this scan begins. A new chain starts at its finalized block: deposits before the first scan are
// not looked for. ponytail: add a start block to chains if a chain is enabled after invoices on it exist.
func (c *Chain) start(ctx context.Context, finalized uint64) (uint64, error) {
	var from uint64
	err := c.pool.QueryRow(ctx, `
		SELECT least(cur.last_finalized_block + 1,
		             coalesce((SELECT min(block_number) FROM chain_transfers
		                       WHERE chain_id = $1 AND status = 'detected'), cur.last_finalized_block + 1))
		FROM chain_cursors cur WHERE cur.chain_id = $1`, c.chainID).Scan(&from)
	if errors.Is(err, pgx.ErrNoRows) {
		return finalized + 1, nil
	}
	if err != nil {
		return 0, fmt.Errorf("read chain %d cursor: %w", c.chainID, err)
	}
	return from, nil
}

// invoices maps each receive address on this chain to its invoice and token.
func (c *Chain) invoices(ctx context.Context) (map[common.Address]receiver, error) {
	rows, err := c.pool.Query(ctx, "SELECT receive_address, id, token_contract FROM invoices WHERE chain_id = $1", c.chainID)
	if err != nil {
		return nil, fmt.Errorf("read chain %d invoices: %w", c.chainID, err)
	}
	defer rows.Close()
	out := map[common.Address]receiver{}
	for rows.Next() {
		var addr, id, token string
		if err := rows.Scan(&addr, &id, &token); err != nil {
			return nil, fmt.Errorf("read chain %d invoices: %w", c.chainID, err)
		}
		out[common.HexToAddress(addr)] = receiver{id, token}
	}
	return out, rows.Err()
}

// deposits returns the Transfer logs in [lo, hi] that pay an invoice in its own token. A log whose block the RPC no
// longer reports with the same hash is left for the next scan.
// ponytail: one topic list with every receive address; split it when RPCs reject the size.
func (c *Chain) deposits(ctx context.Context, lo, hi uint64, invoices map[common.Address]receiver, finalized uint64) ([]deposit, error) {
	tokens := map[common.Address]bool{}
	var receivers []common.Hash
	for addr, inv := range invoices {
		tokens[common.HexToAddress(inv.token)] = true
		receivers = append(receivers, common.BytesToHash(addr.Bytes()))
	}
	var tokenList []common.Address
	for t := range tokens {
		tokenList = append(tokenList, t)
	}
	logs, err := c.eth.FilterLogs(ctx, ethereum.FilterQuery{
		FromBlock: new(big.Int).SetUint64(lo), ToBlock: new(big.Int).SetUint64(hi),
		Addresses: tokenList, Topics: [][]common.Hash{{transferTopic}, nil, receivers},
	})
	if err != nil {
		return nil, fmt.Errorf("read chain %d logs %d-%d: %w", c.chainID, lo, hi, err)
	}

	headers := map[uint64]header{}
	var out []deposit
	for _, l := range logs {
		if l.Removed || len(l.Topics) != 3 || len(l.Data) != 32 {
			continue
		}
		to := common.BytesToAddress(l.Topics[2].Bytes())
		inv, ok := invoices[to]
		amount := new(big.Int).SetBytes(l.Data)
		// Only the invoice's own token counts: anyone can emit Transfer from a look-alike contract.
		if !ok || !strings.EqualFold(l.Address.Hex(), inv.token) || amount.Sign() == 0 {
			continue
		}
		h, ok := headers[l.BlockNumber]
		if !ok {
			if h, err = c.header(ctx, hexutil.EncodeUint64(l.BlockNumber)); err != nil {
				return nil, err
			}
			headers[l.BlockNumber] = h
		}
		if h.Hash != l.BlockHash {
			continue
		}
		out = append(out, deposit{
			// The emitting contract, not the invoice's token: the foreign key then also rejects a mismatch.
			invoiceID: inv.invoiceID, token: hexutil.Encode(l.Address[:]), txHash: hexutil.Encode(l.TxHash[:]),
			blockHash: hexutil.Encode(l.BlockHash[:]), from: hexutil.Encode(l.Topics[1][12:]), to: hexutil.Encode(to[:]),
			logIndex:    uint64(l.Index),
			blockNumber: l.BlockNumber, blockTime: uint64(h.Timestamp), amount: amount, final: l.BlockNumber <= finalized,
		})
	}
	return out, nil
}

// record writes one scan: deposits no longer on the chain become reorged first (so a re-mined copy can be live),
// then each deposit is inserted or brought back, then the cursor moves.
func (c *Chain) record(ctx context.Context, from, finalized, latest uint64, deposits []deposit) error {
	tx, err := c.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("record chain %d scan: %w", c.chainID, err)
	}
	defer tx.Rollback(ctx)

	hashes, indexes := make([]string, len(deposits)), make([]int64, len(deposits))
	for i, d := range deposits {
		hashes[i], indexes[i] = d.blockHash, int64(d.logIndex)
	}
	_, err = tx.Exec(ctx, `
		UPDATE chain_transfers SET status = 'reorged'
		WHERE chain_id = $1 AND status = 'detected' AND block_number >= $2
		  AND NOT EXISTS (SELECT 1 FROM unnest($3::text[], $4::bigint[]) seen(hash, idx)
		                  WHERE seen.hash = block_hash AND seen.idx = log_index)`, c.chainID, from, hashes, indexes)
	if err != nil {
		return fmt.Errorf("mark chain %d reorged deposits: %w", c.chainID, err)
	}
	for _, d := range deposits {
		status := "detected"
		if d.final {
			status = "confirmed"
		}
		// A confirmed row may be booked and never changes; a reorged one comes back if its block is canonical again.
		_, err = tx.Exec(ctx, `
			INSERT INTO chain_transfers (chain_id, chain_family, token_contract, invoice_id, tx_hash, log_index,
			    block_hash, block_number, block_time, from_address, to_address, amount, status)
			VALUES ($1, 'evm', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
			ON CONFLICT (chain_id, block_hash, log_index) DO UPDATE SET status = excluded.status
			WHERE chain_transfers.status <> 'confirmed' AND chain_transfers.status <> excluded.status`,
			c.chainID, d.token, d.invoiceID, d.txHash, d.logIndex, d.blockHash, d.blockNumber, d.blockTime,
			d.from, d.to, d.amount.String(), status)
		if err != nil {
			return fmt.Errorf("record chain %d deposit %s/%d: %w", c.chainID, d.txHash, d.logIndex, err)
		}
	}
	_, err = tx.Exec(ctx, `
		INSERT INTO chain_cursors (chain_id, last_scanned_block, last_finalized_block) VALUES ($1, $2, $3)
		ON CONFLICT (chain_id) DO UPDATE SET last_scanned_block = excluded.last_scanned_block,
		    last_finalized_block = excluded.last_finalized_block, updated_at = now()`, c.chainID, latest, finalized)
	if err != nil {
		return fmt.Errorf("move chain %d cursor: %w", c.chainID, err)
	}
	return tx.Commit(ctx)
}

func (c *Chain) header(ctx context.Context, block string) (header, error) {
	var h *header
	if err := c.rpc.CallContext(ctx, &h, "eth_getBlockByNumber", block, false); err != nil {
		return header{}, fmt.Errorf("read chain %d block %s: %w", c.chainID, block, err)
	}
	if h == nil {
		return header{}, fmt.Errorf("read chain %d block %s: not found", c.chainID, block)
	}
	return *h, nil
}
