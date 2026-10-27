package watcher

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"slices"
	"strings"
	"time"

	"github.com/ethereum/go-ethereum"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/common/hexutil"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/ethereum/go-ethereum/rpc"
	"github.com/forwend/forwend/apps/backend/internal/chain"
	"github.com/forwend/forwend/apps/backend/internal/history"
	"github.com/jackc/pgx/v5"
)

var (
	settledTopic   = crypto.Keccak256Hash([]byte("Settled(bytes32,address,uint256)"))
	refundedTopic  = crypto.Keccak256Hash([]byte("Refunded(bytes32,address,uint256)"))
	recoveredTopic = crypto.Keccak256Hash([]byte("Recovered(bytes32,address,address,uint256)"))
)

// Receivers advances bounded historical coverage, including receivers outside the ordinary payment watch window.
func (c *Chain) Receivers(ctx context.Context, second *rpc.Client) error {
	rows, err := c.pool.Query(ctx, `WITH due AS (
  SELECT s.*, EXISTS (SELECT 1 FROM chain_transfers d JOIN invoices paid ON paid.id = d.invoice_id
   WHERE coalesce(paid.main_id,paid.id) = coalesce(i.main_id,i.id) AND d.status = 'confirmed' AND NOT d.booked
   AND (NOT EXISTS (SELECT 1 FROM receiver_deposit_proofs p WHERE p.chain_transfer_id = d.id) OR CASE WHEN paid.chain_id = i.chain_id THEN d.block_number > coalesce(s.scanned_block,-1)
            ELSE d.block_time >= coalesce(s.block_time,0) END))
   OR (i.payment_status IN ('open','detected','partially_paid') AND cur.last_finalized_time > i.closes_at
       AND coalesce(s.block_time, 0) <= i.closes_at) AS urgent
  FROM receiver_scans s JOIN invoices i ON i.id = s.invoice_id
  LEFT JOIN chain_cursors cur ON cur.chain_id = i.chain_id WHERE i.chain_id = $1
  AND (s.retry_at IS NULL OR s.retry_at <= now())
 )
 (SELECT invoice_id FROM due WHERE NOT legacy AND (next_at <= now() OR urgent)
  ORDER BY urgent DESC, next_at, invoice_id LIMIT 3)
 UNION ALL
 (SELECT invoice_id FROM due WHERE legacy AND (next_at <= now() OR urgent)
  ORDER BY urgent DESC, next_at, invoice_id LIMIT 2)`, c.chainID)
	if err != nil {
		return fmt.Errorf("list chain %d receiver scans: %w", c.chainID, err)
	}
	ids, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		return err
	}
	var failed []error
	for _, id := range ids {
		if _, err := c.Receiver(ctx, second, id); err != nil {
			failed = append(failed, err)
			scheduleCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 3*time.Second)
			_, scheduleErr := c.pool.Exec(scheduleCtx, `UPDATE receiver_scans SET retry_at = now() + interval '30 seconds', next_at = now() + interval '30 seconds',
    updated_at = now() WHERE invoice_id = $1`, id)
			cancel()
			if scheduleErr != nil {
				failed = append(failed, scheduleErr)
			}
		}
	}
	return errors.Join(failed...)
}

// Receiver records one contiguous, finalized prefix agreed by both provider roles. Financial booking is separate.
func (c *Chain) Receiver(ctx context.Context, second *rpc.Client, id string) (bool, error) {
	if second == nil {
		return false, errors.New("receiver evidence needs a second RPC")
	}
	other := NewChain(c.pool, c.chainID, second)
	for _, provider := range []*Chain{c, other} {
		got, err := provider.eth.ChainID(ctx)
		if err != nil {
			return false, err
		}
		if !got.IsUint64() || got.Uint64() != c.chainID {
			return false, fmt.Errorf("receiver provider answers chain %s, want %d", got, c.chainID)
		}
	}
	tx, err := c.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.ReadCommitted})
	if err != nil {
		return false, err
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `SELECT id FROM invoices WHERE coalesce(main_id,id) =
      (SELECT coalesce(main_id,id) FROM invoices WHERE id = $1)
      ORDER BY main_id IS NULL,id FOR NO KEY UPDATE`, id); err != nil {
		return false, err
	}
	var start, next uint64
	var checked bool
	var priorBlock *uint64
	var priorHash *string
	var receive, token, recipient, factory string
	var previousClose int64
	err = tx.QueryRow(ctx, `SELECT s.start_block, s.next_block, s.opening_checked, s.scanned_block, s.scanned_hash,
  i.receive_address, i.token_contract, i.recipient_address, i.factory_address, i.closes_at FROM receiver_scans s JOIN invoices i ON i.id = s.invoice_id
  WHERE i.id = $1 AND i.chain_id = $2 FOR UPDATE OF s`, id, c.chainID).
		Scan(&start, &next, &checked, &priorBlock, &priorHash, &receive, &token, &recipient, &factory, &previousClose)
	if err != nil {
		return false, fmt.Errorf("lock receiver %s coverage: %w", id, err)
	}
	firstFinal, _, err := c.headers(ctx, nil)
	if err != nil {
		return false, err
	}
	secondFinal, _, err := other.headers(ctx, nil)
	if err != nil {
		return false, err
	}
	final := min(uint64(firstFinal.Number), uint64(secondFinal.Number))
	if (priorBlock != nil && final < *priorBlock) || start > final {
		if _, err := tx.Exec(ctx, `UPDATE receiver_scans SET retry_at = now() + interval '30 seconds',
            next_at = now() + interval '30 seconds', updated_at = now() WHERE invoice_id = $1`, id); err != nil {
			return false, err
		}
		return false, tx.Commit(ctx)
	}
	if !checked && start > 0 {
		opening, err := c.receiverBalances(ctx, other, token, receive, start-1)
		if err != nil {
			return false, err
		}
		if opening.Sign() != 0 {
			if _, err := tx.Exec(ctx, `UPDATE receiver_scans SET start_block = 0, next_block = 0,
    reconciliation_error = 'opening_balance', updated_at = now() WHERE invoice_id = $1`, id); err != nil {
				return false, err
			}
			return false, tx.Commit(ctx)
		}
	}
	if priorBlock != nil {
		var older bool
		lower := max(start, next-min(next, RescanDepth))
		if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM chain_transfers d WHERE d.invoice_id = $1
   AND d.status <> 'reorged' AND d.block_number < $2
   AND NOT EXISTS (SELECT 1 FROM receiver_conflicts conflict WHERE conflict.existing_transfer_id = d.id) AND NOT EXISTS
   (SELECT 1 FROM receiver_deposit_proofs p WHERE p.chain_transfer_id = d.id))`, id, lower).Scan(&older); err != nil {
			return false, err
		}
		if older {
			if _, err := tx.Exec(ctx, `UPDATE receiver_scans SET start_block = 0,next_block = 0,opening_checked = false,history_complete = false,
    scanned_block = NULL,scanned_hash = NULL,block_time = NULL,balance = NULL,
    reconciliation_error = 'rescan_required',next_at = now(),updated_at = now() WHERE invoice_id = $1`, id); err != nil {
				return false, err
			}
			return false, tx.Commit(ctx)
		}
	}
	from := next
	if next > final {
		from = max(start, next-min(next, RescanDepth))
	}
	hi := min(final, from+rescanStep-1)
	invoices := map[common.Address]receiver{common.HexToAddress(receive): {id, token}}
	incoming, err := c.logsIn(ctx, from, hi, invoices)
	if err != nil {
		return false, err
	}
	outgoing, err := c.receiverLogs(ctx, from, hi, common.HexToAddress(receive))
	if err != nil {
		return false, err
	}
	transfers, err := c.receiverTokenTransfers(ctx, from, hi, common.HexToAddress(receive), common.HexToAddress(token))
	if err != nil {
		return false, err
	}
	otherTransfers, err := other.receiverTokenTransfers(ctx, from, hi, common.HexToAddress(receive), common.HexToAddress(token))
	if err != nil {
		return false, err
	}
	otherIncoming, err := other.logsIn(ctx, from, hi, invoices)
	if err != nil {
		return false, err
	}
	otherOutgoing, err := other.receiverLogs(ctx, from, hi, common.HexToAddress(receive))
	if err != nil {
		return false, err
	}
	if !sameReceiverLogs(incoming, otherIncoming) || !sameReceiverLogs(outgoing, otherOutgoing) || !sameReceiverLogs(transfers, otherTransfers) {
		return false, fmt.Errorf("receiver %s provider log sets disagree at %d-%d", id, from, hi)
	}
	knownRows, err := tx.Query(ctx, `SELECT id, block_number, block_hash, tx_hash, log_index, status, booked
  FROM chain_transfers WHERE invoice_id = $1 AND block_number BETWEEN $2 AND $3 AND status <> 'reorged'`, id, from, hi)
	if err != nil {
		return false, err
	}
	type knownTransfer struct {
		ID       int64
		Block    uint64
		Hash, Tx string
		Index    uint64
		Status   string
		Booked   bool
	}
	known, err := pgx.CollectRows(knownRows, pgx.RowToStructByPos[knownTransfer])
	if err != nil {
		return false, err
	}
	numbers := []uint64{hi}
	for _, old := range known {
		numbers = append(numbers, old.Block)
	}
	if start > 0 {
		numbers = append(numbers, start-1)
	}
	if priorBlock != nil {
		numbers = append(numbers, *priorBlock)
	}
	for _, l := range append(append(slices.Clone(incoming), outgoing...), transfers...) {
		numbers = append(numbers, l.BlockNumber)
	}
	_, headers, err := c.headers(ctx, numbers)
	if err != nil {
		return false, err
	}
	_, otherHeaders, err := other.headers(ctx, numbers)
	if err != nil {
		return false, err
	}
	for _, n := range numbers {
		h, ok := headers[n]
		otherHeader, otherOK := otherHeaders[n]
		if !ok || !otherOK || h.Hash != otherHeader.Hash || h.Timestamp != otherHeader.Timestamp {
			return false, fmt.Errorf("receiver %s provider headers disagree at %d", id, n)
		}
	}
	if priorBlock != nil && headers[*priorBlock].Hash != common.HexToHash(*priorHash) {
		if _, err := tx.Exec(ctx, "UPDATE receiver_scans SET reconciliation_error = 'finalized_coverage_changed', updated_at = now() WHERE invoice_id = $1", id); err != nil {
			return false, err
		}
		if err := tx.Commit(ctx); err != nil {
			return false, err
		}
		return false, fmt.Errorf("receiver %s finalized coverage changed at %d", id, *priorBlock)
	}
	for _, l := range append(append(slices.Clone(incoming), outgoing...), transfers...) {
		if l.Removed || l.BlockNumber < from || l.BlockNumber > hi || l.BlockHash != headers[l.BlockNumber].Hash {
			return false, fmt.Errorf("receiver %s log is outside its canonical block", id)
		}
	}
	balance, err := c.receiverBalances(ctx, other, token, receive, hi)
	if err != nil {
		return false, err
	}
	for _, old := range known {
		found := slices.ContainsFunc(incoming, func(l types.Log) bool {
			return l.BlockHash == common.HexToHash(old.Hash) && uint64(l.Index) == old.Index && l.TxHash == common.HexToHash(old.Tx)
		})
		if found {
			continue
		}
		if old.Status == "detected" && !old.Booked && headers[old.Block].Hash != common.HexToHash(old.Hash) {
			if _, err := tx.Exec(ctx, "UPDATE chain_transfers SET status = 'reorged' WHERE id = $1 AND status = 'detected' AND NOT booked", old.ID); err != nil {
				return false, err
			}
			continue
		}
		proof, err := json.Marshal(map[string]any{"missingTransfer": true, "txHash": old.Tx, "logIndex": old.Index,
			"canonicalBlock": headers[old.Block].Hash.Hex(), "verifiedBlock": hi, "verifiedHash": headers[hi].Hash.Hex()})
		if err != nil {
			return false, err
		}
		if _, err := tx.Exec(ctx, `INSERT INTO receiver_conflicts (invoice_id,chain_id,block_hash,log_index,existing_transfer_id,observed)
   VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`, id, c.chainID, old.Hash, old.Index, old.ID, proof); err != nil {
			return false, err
		}
	}
	deposits, _ := depositsOf(incoming, headers, invoices, hi)
	deposits, err = c.prepareReceiverDeposits(ctx, tx, other, deposits)
	if err != nil {
		return false, err
	}
	if err := c.insertDeposits(ctx, tx, deposits); err != nil {
		return false, err
	}
	for _, d := range deposits {
		if _, err := tx.Exec(ctx, `INSERT INTO receiver_deposit_proofs (chain_transfer_id,invoice_id,verified_block,verified_hash)
   SELECT id,invoice_id,$12,$13 FROM chain_transfers WHERE invoice_id = $1 AND chain_id = $2 AND token_contract = $3
   AND tx_hash = $4 AND block_hash = $5 AND log_index = $6 AND block_number = $7 AND block_time = $8
   AND from_address = $9 AND to_address = $10 AND amount = $11 AND status = 'confirmed'
   ON CONFLICT DO NOTHING`, id, c.chainID, d.token, d.txHash, d.blockHash, d.logIndex, d.blockNumber, d.blockTime, d.from, d.to, d.amount.String(), hi, strings.ToLower(headers[hi].Hash.Hex())); err != nil {
			return false, err
		}
		var proved bool
		if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM receiver_deposit_proofs p JOIN chain_transfers d
   ON d.id = p.chain_transfer_id WHERE d.chain_id = $1 AND d.block_hash = $2 AND d.log_index = $3
   AND d.invoice_id = $4 AND d.tx_hash = $5)`, c.chainID, d.blockHash, d.logIndex, id, d.txHash).Scan(&proved); err != nil {
			return false, err
		}
		if !proved {
			return false, fmt.Errorf("receiver %s canonical deposit was not recorded", id)
		}
	}
	previous := map[common.Hash]*uint{}
	for _, l := range outgoing {
		if err := c.recordOutflow(ctx, tx, id, receive, token, recipient, l, transfers, previous[l.TxHash], uint64(headers[l.BlockNumber].Timestamp), hi); err != nil {
			return false, err
		}
		index := l.Index
		previous[l.TxHash] = &index
	}
	var expected string
	if err := tx.QueryRow(ctx, `SELECT (
  coalesce((SELECT sum(amount) FROM chain_transfers WHERE invoice_id = $1 AND status = 'confirmed' AND block_number <= $2), 0)
  - coalesce((SELECT sum(amount) FROM receiver_outflows WHERE invoice_id = $1 AND token_contract = $3
              AND kind IN ('settlement', 'refund') AND block_number <= $2), 0))::text`, id, hi, token).Scan(&expected); err != nil {
		return false, err
	}
	net, _ := new(big.Int).SetString(expected, 10)
	reason := ""
	if net.Cmp(balance) != 0 {
		reason = "unexplained_balance"
	}
	var conflict bool
	if err := tx.QueryRow(ctx, "SELECT EXISTS (SELECT 1 FROM receiver_conflicts WHERE invoice_id = $1)", id).Scan(&conflict); err != nil {
		return false, err
	}
	if conflict {
		reason = "deposit_identity_conflict"
	}
	var settled bool
	if err := tx.QueryRow(ctx, "SELECT EXISTS (SELECT 1 FROM receiver_outflows WHERE invoice_id = $1 AND kind = 'settlement' AND block_number <= $2)", id, hi).Scan(&settled); err != nil {
		return false, err
	}
	if settled {
		primaryState, err := c.receiverSettledAt(ctx, receive, hi)
		if err != nil {
			return false, err
		}
		secondState, err := other.receiverSettledAt(ctx, receive, hi)
		if err != nil {
			return false, err
		}
		if !primaryState || !secondState {
			reason = "receiver_state_disagreement"
		}
	}
	firstDeployment, err := c.receiverDeployedAt(ctx, factory, receive, hi)
	if err != nil {
		return false, err
	}
	secondDeployment, err := other.receiverDeployedAt(ctx, factory, receive, hi)
	if err != nil {
		return false, err
	}
	if firstDeployment != secondDeployment {
		return false, fmt.Errorf("receiver %s provider deploy times disagree", id)
	}
	if _, err := tx.Exec(ctx, "UPDATE invoices SET receiver_deployed_at = CASE WHEN $2::bigint > 0 THEN $2 ELSE coalesce(receiver_deployed_at,0) END WHERE id = $1", id, firstDeployment); err != nil {
		return false, err
	}
	var currentClose int64
	if err := tx.QueryRow(ctx, "SELECT closes_at FROM invoices WHERE id = $1", id).Scan(&currentClose); err != nil {
		return false, err
	}
	if currentClose != previousClose {
		if err := history.Add(ctx, tx, id, history.CheckoutCloseChanged, history.System,
			history.Data{Option: id, Until: time.Unix(currentClose, 0).UTC().Format(time.RFC3339)}); err != nil {
			return false, err
		}
	}
	if _, err := tx.Exec(ctx, `UPDATE receiver_scans s SET booking_error = 'historical_checkout_close'
        FROM invoices i WHERE s.invoice_id = $1 AND i.id = s.invoice_id
        AND i.closes_at < greatest(i.expires_at,i.reopened_until) AND EXISTS (
          SELECT 1 FROM ledger_transactions t JOIN ledger_entries e ON e.transaction_id = t.id
          JOIN chain_transfers d ON d.id = t.chain_transfer_id WHERE t.invoice_id = i.id AND t.kind = 'deposit'
          AND e.account = 'recipient_payable' AND e.amount < 0 AND d.block_time > i.closes_at)`, id); err != nil {
		return false, err
	}
	head := headers[hi]
	_, err = tx.Exec(ctx, `UPDATE receiver_scans SET next_block = greatest(next_block, $2 + 1), opening_checked = true,
  history_complete = history_complete OR $7, retry_at = NULL, scanned_block = $2, scanned_hash = $3, block_time = $4, balance = $5, reconciliation_error = nullif($6, ''),
  next_at = CASE WHEN $7 THEN now() + interval '1 minute' ELSE now() END, updated_at = now() WHERE invoice_id = $1`,
		id, hi, strings.ToLower(head.Hash.Hex()), uint64(head.Timestamp), balance.String(), reason, hi == final)
	if err != nil {
		return false, err
	}
	return hi == final, tx.Commit(ctx)
}

func (c *Chain) receiverBalances(ctx context.Context, other *Chain, token, receive string, block uint64) (*big.Int, error) {
	first, err := c.receiverBalance(ctx, token, receive, block)
	if err != nil {
		return nil, err
	}
	second, err := other.receiverBalance(ctx, token, receive, block)
	if err != nil {
		return nil, err
	}
	if first.Cmp(second) != 0 {
		return nil, fmt.Errorf("receiver %s provider balances disagree at %d", receive, block)
	}
	return second, nil
}

func sameReceiverLogs(first, second []types.Log) bool {
	sort := func(logs []types.Log) {
		slices.SortFunc(logs, func(a, b types.Log) int {
			if a.BlockNumber < b.BlockNumber {
				return -1
			}
			if a.BlockNumber > b.BlockNumber {
				return 1
			}
			if a.Index < b.Index {
				return -1
			}
			if a.Index > b.Index {
				return 1
			}
			return 0
		})
	}
	sort(first)
	sort(second)
	if len(first) != len(second) {
		return false
	}
	for i, a := range first {
		b := second[i]
		if a.Address != b.Address || a.BlockHash != b.BlockHash || a.BlockNumber != b.BlockNumber ||
			a.TxHash != b.TxHash || a.TxIndex != b.TxIndex || a.Index != b.Index || a.Removed != b.Removed ||
			!bytes.Equal(a.Data, b.Data) || !slices.Equal(a.Topics, b.Topics) {
			return false
		}
	}
	return true
}

func (c *Chain) receiverLogs(ctx context.Context, from, hi uint64, receive common.Address) ([]types.Log, error) {
	var out []types.Log
	span := c.span
	for from <= hi {
		top := min(hi, from+span-1)
		found, err := c.filterLogs(ctx, ethereum.FilterQuery{FromBlock: new(big.Int).SetUint64(from),
			ToBlock: new(big.Int).SetUint64(top), Addresses: []common.Address{receive},
			Topics: [][]common.Hash{{settledTopic, refundedTopic, recoveredTopic}}})
		if next, ok := narrower(err, span); ok {
			span = next
			continue
		}
		if err != nil {
			return nil, err
		}
		out = append(out, found...)
		from, span = top+1, min(span*2, MaxRange)
	}
	return out, nil
}

func (c *Chain) recordOutflow(ctx context.Context, tx pgx.Tx, id, receive, token, recipient string,
	l types.Log, transfers []types.Log, previous *uint, at, verified uint64) error {
	if l.Address != common.HexToAddress(receive) {
		return fmt.Errorf("receiver %s movement came from another contract", id)
	}
	if len(l.Data) != 32 || len(l.Topics) < 3 || l.Topics[1] != common.HexToHash(id) {
		return fmt.Errorf("receiver %s emitted malformed movement evidence", id)
	}
	kind, destination, reason := "", common.BytesToAddress(l.Topics[2].Bytes()), "awaiting_booking"
	switch l.Topics[0] {
	case settledTopic:
		kind = "settlement"
		if len(l.Topics) != 3 || destination != common.HexToAddress(recipient) {
			reason = "invalid_terms"
		}
	case refundedTopic:
		kind = "refund"
		if len(l.Topics) != 3 {
			reason = "invalid_terms"
		}
	case recoveredTopic:
		kind = "recovery"
		if len(l.Topics) != 4 {
			return fmt.Errorf("receiver %s emitted malformed recovery", id)
		}
		token, destination = strings.ToLower(destination.Hex()), common.BytesToAddress(l.Topics[3].Bytes())
		reason = "different_asset"
	default:
		return fmt.Errorf("receiver %s emitted unknown movement", id)
	}
	amount := new(big.Int).SetBytes(l.Data)
	if kind == "settlement" {
		var expected string
		if err := tx.QueryRow(ctx, "SELECT amount::text FROM invoices WHERE id = $1", id).Scan(&expected); err != nil {
			return err
		}
		if amount.String() != expected {
			reason = "invalid_terms"
		}
	}
	if amount.Sign() == 0 {
		return nil
	}
	var transferIndex *uint64
	if kind != "recovery" {
		for _, candidate := range transfers {
			if candidate.TxHash == l.TxHash && candidate.BlockHash == l.BlockHash && candidate.Index < l.Index && (previous == nil || candidate.Index > *previous) &&
				candidate.Address == common.HexToAddress(token) && len(candidate.Topics) == 3 && len(candidate.Data) == 32 &&
				common.BytesToAddress(candidate.Topics[1].Bytes()) == common.HexToAddress(receive) &&
				common.BytesToAddress(candidate.Topics[2].Bytes()) == destination && new(big.Int).SetBytes(candidate.Data).Cmp(amount) == 0 {
				index := uint64(candidate.Index)
				if transferIndex == nil || index > *transferIndex {
					transferIndex = &index
				}
			}
		}
		if transferIndex == nil {
			reason = "transfer_evidence_missing"
		}
	}
	_, err := tx.Exec(ctx, `INSERT INTO receiver_outflows (invoice_id, chain_id, receiver_address, token_contract,
  kind, destination, amount, tx_hash, log_index, block_hash, block_number, block_time, verified_block, reconciliation_error, transfer_log_index)
  VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) ON CONFLICT (chain_id, block_hash, log_index) DO NOTHING`,
		id, c.chainID, receive, token, kind, strings.ToLower(destination.Hex()), amount.String(),
		hexutil.Encode(l.TxHash[:]), l.Index, hexutil.Encode(l.BlockHash[:]), l.BlockNumber, at, verified, reason, transferIndex)
	return err
}

func (c *Chain) receiverBalance(ctx context.Context, token, receive string, block uint64) (*big.Int, error) {
	balance, err := chain.TokenBalanceAt(ctx, c.eth, c.chainID, token, receive, block)
	if !errors.Is(err, chain.ErrNoToken) {
		return balance, err
	}
	code, codeErr := c.eth.CodeAt(ctx, common.HexToAddress(token), new(big.Int).SetUint64(block))
	if codeErr != nil {
		return nil, codeErr
	}
	if len(code) != 0 {
		return nil, err
	}
	return new(big.Int), nil
}

func (c *Chain) prepareReceiverDeposits(ctx context.Context, tx pgx.Tx, other *Chain, deposits []deposit) ([]deposit, error) {
	var accepted []deposit
	for _, d := range deposits {
		var oldID int64
		var oldBlock uint64
		var oldTime int64
		var oldHash, status, oldInvoice, token, amount, from, to string
		var booked bool
		err := tx.QueryRow(ctx, `SELECT id, block_number, block_time, block_hash, status, booked, invoice_id, token_contract,
   amount::text, from_address, to_address FROM chain_transfers WHERE chain_id = $1
   AND ((tx_hash = $2 AND log_index = $3 AND status <> 'reorged') OR (block_hash = $4 AND log_index = $3))`, c.chainID, d.txHash, d.logIndex, d.blockHash).
			Scan(&oldID, &oldBlock, &oldTime, &oldHash, &status, &booked, &oldInvoice, &token, &amount, &from, &to)
		if errors.Is(err, pgx.ErrNoRows) {
			accepted = append(accepted, d)
			continue
		}
		if err != nil {
			return nil, err
		}
		same := oldHash == d.blockHash && oldBlock == d.blockNumber && oldTime == int64(d.blockTime) && oldInvoice == d.invoiceID &&
			token == d.token && amount == d.amount.String() && from == d.from && to == d.to
		if same {
			accepted = append(accepted, d)
			continue
		}
		if status == "detected" && !booked && oldHash != d.blockHash {
			_, primaryHeaders, err := c.headers(ctx, []uint64{oldBlock})
			if err != nil {
				return nil, err
			}
			_, secondHeaders, err := other.headers(ctx, []uint64{oldBlock})
			if err != nil {
				return nil, err
			}
			primary, pOK := primaryHeaders[oldBlock]
			secondary, sOK := secondHeaders[oldBlock]
			if !pOK || !sOK || primary.Hash != secondary.Hash {
				return nil, errors.New("providers disagree on an old deposit block")
			}
			if primary.Hash != common.HexToHash(oldHash) {
				if _, err := tx.Exec(ctx, "UPDATE chain_transfers SET status = 'reorged' WHERE id = $1 AND status = 'detected' AND NOT booked", oldID); err != nil {
					return nil, err
				}
				accepted = append(accepted, d)
				continue
			}
		}
		raw, err := json.Marshal(map[string]any{"invoiceId": d.invoiceID, "token": d.token, "txHash": d.txHash,
			"blockHash": d.blockHash, "blockNumber": d.blockNumber, "blockTime": d.blockTime, "logIndex": d.logIndex,
			"from": d.from, "to": d.to, "amount": d.amount.String(), "verifiedBlock": d.finalized})
		if err != nil {
			return nil, err
		}
		if _, err := tx.Exec(ctx, `INSERT INTO receiver_conflicts (invoice_id, chain_id, block_hash, log_index, existing_transfer_id, observed)
   VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`, d.invoiceID, c.chainID, d.blockHash, d.logIndex, oldID, raw); err != nil {
			return nil, err
		}
	}
	return accepted, nil
}

func (c *Chain) receiverTokenTransfers(ctx context.Context, from, hi uint64, receive, token common.Address) ([]types.Log, error) {
	var out []types.Log
	span := c.span
	for from <= hi {
		top := min(hi, from+span-1)
		found, err := c.filterLogs(ctx, ethereum.FilterQuery{FromBlock: new(big.Int).SetUint64(from), ToBlock: new(big.Int).SetUint64(top),
			Addresses: []common.Address{token}, Topics: [][]common.Hash{{transferTopic}, {common.BytesToHash(receive.Bytes())}}})
		if next, ok := narrower(err, span); ok {
			span = next
			continue
		}
		if err != nil {
			return nil, err
		}
		out = append(out, found...)
		from, span = top+1, min(span*2, MaxRange)
	}
	return out, nil
}

func (c *Chain) receiverSettledAt(ctx context.Context, receive string, block uint64) (bool, error) {
	to := common.HexToAddress(receive)
	data, err := c.eth.CallContract(ctx, ethereum.CallMsg{To: &to, Data: crypto.Keccak256([]byte("settled()"))[:4]}, new(big.Int).SetUint64(block))
	if err != nil {
		return false, err
	}
	if len(data) != 32 {
		return false, fmt.Errorf("receiver %s returned malformed settled state", receive)
	}
	value := new(big.Int).SetBytes(data)
	if value.Cmp(big.NewInt(1)) > 0 {
		return false, fmt.Errorf("receiver %s returned invalid settled state", receive)
	}
	return value.Sign() == 1, nil
}

func (c *Chain) receiverDeployedAt(ctx context.Context, factory, receive string, block uint64) (uint64, error) {
	to := common.HexToAddress(factory)
	data := append(crypto.Keccak256([]byte("deployedAt(address)"))[:4], common.LeftPadBytes(common.HexToAddress(receive).Bytes(), 32)...)
	at := new(big.Int).SetUint64(block)
	out, err := c.eth.CallContract(ctx, ethereum.CallMsg{To: &to, Data: data}, at)
	if err != nil {
		return 0, err
	}
	if len(out) == 0 {
		code, err := c.eth.CodeAt(ctx, to, at)
		if err != nil {
			return 0, err
		}
		if len(code) == 0 {
			return 0, nil
		}
	}
	if len(out) != 32 || !new(big.Int).SetBytes(out).IsUint64() {
		return 0, fmt.Errorf("receiver %s returned invalid deploy time", receive)
	}
	return new(big.Int).SetBytes(out).Uint64(), nil
}
