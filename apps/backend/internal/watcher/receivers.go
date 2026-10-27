package watcher

import (
	"cmp"
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
	"github.com/forwend/forwend/apps/backend/internal/chain"
	"github.com/forwend/forwend/apps/backend/internal/history"
	"github.com/jackc/pgx/v5"
)

var (
	settledTopic   = crypto.Keccak256Hash([]byte("Settled(bytes32,address,uint256)"))
	refundedTopic  = crypto.Keccak256Hash([]byte("Refunded(bytes32,address,uint256)"))
	recoveredTopic = crypto.Keccak256Hash([]byte("Recovered(bytes32,address,address,uint256)"))
)

// Receivers prioritizes current payments. Older records have a separate, bounded queue.
func (c *Chain) Receivers(ctx context.Context) error {
	return c.receivers(ctx, false, 1000)
}

func (c *Chain) HistoricalReceivers(ctx context.Context) error {
	return c.receivers(ctx, true, 2)
}

func (c *Chain) receivers(ctx context.Context, legacy bool, limit int) error {
	c.receiverMu.Lock()
	defer c.receiverMu.Unlock()
	rows, err := c.pool.Query(ctx, `WITH due AS (
  SELECT s.*, EXISTS (SELECT 1 FROM chain_transfers own WHERE own.invoice_id=i.id AND own.status <> 'reorged') AS has_money, EXISTS (SELECT 1 FROM chain_transfers d JOIN invoices paid ON paid.id = d.invoice_id
   WHERE coalesce(paid.main_id,paid.id) = coalesce(i.main_id,i.id) AND d.status = 'confirmed' AND NOT d.booked
   AND (CASE WHEN paid.chain_id = i.chain_id THEN d.block_number > coalesce(s.scanned_block,-1)
            ELSE d.block_time >= coalesce(s.block_time,0) END
        OR (paid.id = i.id AND NOT EXISTS (SELECT 1 FROM receiver_deposit_proofs p WHERE p.chain_transfer_id = d.id))))
   OR (i.payment_status IN ('open','detected','partially_paid') AND cur.last_finalized_time > i.closes_at
       AND coalesce(s.block_time, 0) <= i.closes_at) AS urgent
  FROM receiver_scans s JOIN invoices i ON i.id = s.invoice_id
  LEFT JOIN chain_cursors cur ON cur.chain_id = i.chain_id WHERE i.chain_id = $1 AND s.legacy = $2
  AND (s.retry_at IS NULL OR s.retry_at <= now() OR (NOT s.legacy AND EXISTS (
   SELECT 1 FROM chain_transfers fresh JOIN invoices paid ON paid.id=fresh.invoice_id
   WHERE coalesce(paid.main_id,paid.id)=coalesce(i.main_id,i.id) AND fresh.status='confirmed'
   AND NOT fresh.booked AND fresh.created_at>s.updated_at)))
 ) SELECT invoice_id FROM due WHERE (next_at <= now() AND (legacy OR has_money OR opening_checked)) OR urgent
 ORDER BY urgent DESC, has_money DESC, next_at, invoice_id LIMIT $3`, c.chainID, legacy, limit)
	if err != nil {
		return fmt.Errorf("list chain %d receiver scans: %w", c.chainID, err)
	}
	ids, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		return err
	}
	var failed []error
	var previousBatch time.Duration
	for offset := 0; offset < len(ids) && ctx.Err() == nil; {
		if deadline, ok := ctx.Deadline(); ok && previousBatch > 0 && time.Until(deadline) < 2*previousBatch {
			break
		}
		began := time.Now()
		batch := ids[offset:min(offset+32, len(ids))]
		offset += len(batch)
		var round *receiverRound
		if !legacy && len(batch) > 1 {
			round, err = c.receiverRound(ctx, batch)
			if err != nil {
				if errors.Is(err, context.DeadlineExceeded) || ctx.Err() != nil {
					break
				}
				failed = append(failed, err, c.deferReceivers(ctx, batch))
				continue
			}
		}
		for _, id := range batch {
			if ctx.Err() != nil {
				break
			}
			done, err := c.receiver(ctx, id, round)
			if err != nil {
				if !legacy && (errors.Is(err, context.DeadlineExceeded) || ctx.Err() != nil) {
					return errors.Join(append(failed, err)...)
				}
				failed = append(failed, err, c.deferReceivers(ctx, []string{id}))
			} else if !done && !legacy && len(ids) < limit {
				if _, bounded := ctx.Deadline(); bounded {
					var ready bool
					if err := c.pool.QueryRow(ctx, `SELECT NOT legacy AND retry_at IS NULL AND next_at<=now()
    AND reconciliation_error IS NULL FROM receiver_scans WHERE invoice_id=$1`, id).Scan(&ready); err != nil {
						return err
					}
					if ready {
						ids = append(ids, id)
					}
				}
			}
		}
		previousBatch = time.Since(began)
	}
	return errors.Join(failed...)
}

// Receiver records one contiguous, finalized prefix of receiver evidence. Financial booking is separate.
func (c *Chain) Receiver(ctx context.Context, id string) (bool, error) {
	c.receiverMu.Lock()
	defer c.receiverMu.Unlock()
	return c.receiver(ctx, id, nil)
}

func (c *Chain) receiver(ctx context.Context, id string, round *receiverRound) (bool, error) {
	if round == nil {
		got, err := c.eth.ChainID(ctx)
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
	var checked, legacy bool
	var priorBlock *uint64
	var priorHash *string
	var receive, token, recipient, factory string
	var previousClose int64
	err = tx.QueryRow(ctx, `SELECT s.start_block, s.next_block, s.opening_checked, s.scanned_block, s.scanned_hash, s.legacy,
  i.receive_address, i.token_contract, i.recipient_address, i.factory_address, i.closes_at FROM receiver_scans s JOIN invoices i ON i.id = s.invoice_id
  WHERE i.id = $1 AND i.chain_id = $2 FOR UPDATE OF s`, id, c.chainID).
		Scan(&start, &next, &checked, &priorBlock, &priorHash, &legacy, &receive, &token, &recipient, &factory, &previousClose)
	if err != nil {
		return false, fmt.Errorf("lock receiver %s coverage: %w", id, err)
	}
	var final uint64
	var firstFinal header
	if round != nil {
		final = round.final
		firstFinal = round.source.headers[final]
	} else {
		firstFinal, _, err = c.headers(ctx, nil)
		if err != nil {
			return false, err
		}
		final = uint64(firstFinal.Number)
	}

	if (priorBlock != nil && final < *priorBlock) || start > final {
		if _, err := tx.Exec(ctx, `UPDATE receiver_scans SET retry_at = now() + interval '30 seconds',
            next_at = now() + interval '30 seconds', updated_at = now() WHERE invoice_id = $1`, id); err != nil {
			return false, err
		}
		return false, tx.Commit(ctx)
	}
	if !checked && start > 0 {
		opening, err := c.receiverRoundBalance(ctx, round, token, receive, start-1)
		if err != nil {
			return false, err
		}
		if opening.Sign() != 0 {
			if _, err := tx.Exec(ctx, `UPDATE receiver_scans SET start_block = 0, next_block = 0, legacy = true,
    reconciliation_error = 'opening_balance', updated_at = now() WHERE invoice_id = $1`, id); err != nil {
				return false, err
			}
			return false, tx.Commit(ctx)
		}
	}
	if priorBlock != nil {
		var older *uint64
		lower := next
		if err := tx.QueryRow(ctx, `SELECT min(d.block_number) FROM chain_transfers d WHERE d.invoice_id = $1
   AND d.status <> 'reorged' AND d.block_number < $2
   AND NOT EXISTS (SELECT 1 FROM receiver_conflicts conflict WHERE conflict.existing_transfer_id = d.id) AND NOT EXISTS
   (SELECT 1 FROM receiver_deposit_proofs p WHERE p.chain_transfer_id = d.id)`, id, lower).Scan(&older); err != nil {
			return false, err
		}
		if older != nil {
			if _, err := tx.Exec(ctx, `UPDATE receiver_scans SET legacy=legacy OR $2<start_block,start_block = least(start_block,$2),next_block = $2,
    opening_checked = CASE WHEN $2 < start_block THEN false ELSE opening_checked END,
    history_complete = false,reconciliation_error = 'rescan_required',next_at = now(),updated_at = now()
    WHERE invoice_id = $1`, id, *older); err != nil {
				return false, err
			}
			return false, tx.Commit(ctx)
		}
	}
	from := next
	if next > final {
		if priorBlock != nil {
			if uint64(firstFinal.Number) != *priorBlock {
				_, heads, readErr := c.headers(ctx, []uint64{*priorBlock})
				if readErr != nil {
					return false, readErr
				}
				firstFinal = heads[*priorBlock]

			}
			if firstFinal.Hash != common.HexToHash(*priorHash) {
				if _, err := tx.Exec(ctx, "UPDATE receiver_scans SET reconciliation_error='finalized_coverage_changed' WHERE invoice_id=$1", id); err != nil {
					return false, err
				}
				if err := tx.Commit(ctx); err != nil {
					return false, err
				}
				return false, fmt.Errorf("receiver %s finalized coverage changed", id)
			}
		}
		if _, err := tx.Exec(ctx, "UPDATE receiver_scans SET next_at=now()+interval '1 minute' WHERE invoice_id=$1", id); err != nil {
			return false, err
		}
		return true, tx.Commit(ctx)
	}
	step := c.span
	hi := min(final, from+step-1)
	invoices := map[common.Address]receiver{common.HexToAddress(receive): {id, token}}
	var incoming, outgoing, transfers []types.Log
	if round != nil && from >= round.from && hi <= round.final {
		incoming, outgoing, transfers = round.logs(&round.source, from, hi, receive, token)
	} else {
		incoming, err = c.logsIn(ctx, from, hi, invoices)
		if err != nil {
			return false, err
		}
		outgoing, err = c.receiverLogs(ctx, from, hi, common.HexToAddress(receive))
		if err != nil {
			return false, err
		}
		transfers, err = c.receiverTokenTransfers(ctx, from, hi, common.HexToAddress(receive), common.HexToAddress(token))
		if err != nil {
			return false, err
		}
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
	headers := map[uint64]header{}
	var missing []uint64
	for _, n := range numbers {
		if round != nil {
			if h, ok := round.source.headers[n]; ok {
				headers[n] = h
			}
		}
		if headers[n].Hash == (common.Hash{}) {
			missing = append(missing, n)
		}
	}
	if len(missing) > 0 {
		_, first, err := c.headers(ctx, missing)
		if err != nil {
			return false, err
		}
		for n, h := range first {
			headers[n] = h
		}
	}
	for _, n := range numbers {
		if h, ok := headers[n]; !ok || h.Hash == (common.Hash{}) {
			return false, fmt.Errorf("receiver %s header missing at %d", id, n)
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
	balance, err := c.receiverRoundBalance(ctx, round, token, receive, hi)
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
	deposits, err = c.prepareReceiverDeposits(ctx, tx, deposits)
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
	slices.SortFunc(outgoing, func(a, b types.Log) int {
		if order := cmp.Compare(a.BlockNumber, b.BlockNumber); order != 0 {
			return order
		}
		return cmp.Compare(a.Index, b.Index)
	})
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
		if !primaryState {
			reason = "receiver_state_disagreement"
		}
	}
	var firstDeployment uint64
	if round != nil {
		firstDeployment, err = round.deployed(ctx, c, &round.source, factory, receive, hi)
	} else {
		firstDeployment, err = c.receiverDeployedAt(ctx, factory, receive, hi)
	}
	if err != nil {
		return false, err
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
  history_complete = history_complete OR $7, retry_at = NULL, failures = 0, scanned_block = $2, scanned_hash = $3, block_time = $4, balance = $5, reconciliation_error = nullif($6, ''),
  next_at = CASE WHEN NOT $7 AND legacy THEN now()+interval '1 minute' WHEN NOT $7 THEN now()
    WHEN EXISTS (SELECT 1 FROM chain_transfers WHERE invoice_id = $1 AND status <> 'reorged')
      OR EXISTS (SELECT 1 FROM receiver_outflows WHERE invoice_id = $1) THEN now() + interval '1 minute'
    ELSE now() + interval '1 day' END, updated_at = now() WHERE invoice_id = $1`,
		id, hi, strings.ToLower(head.Hash.Hex()), uint64(head.Timestamp), balance.String(), reason, hi == final)
	if err != nil {
		return false, err
	}
	return hi == final, tx.Commit(ctx)
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
			span, c.span = next, next
			continue
		}
		if err != nil {
			return nil, err
		}
		out = append(out, found...)
		from = top + 1
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

func (c *Chain) prepareReceiverDeposits(ctx context.Context, tx pgx.Tx, deposits []deposit) ([]deposit, error) {
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
			primary, ok := primaryHeaders[oldBlock]
			if !ok {
				return nil, errors.New("old deposit block is missing")
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
			span, c.span = next, next
			continue
		}
		if err != nil {
			return nil, err
		}
		out = append(out, found...)
		from = top + 1
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

func (c *Chain) receiverRoundBalance(ctx context.Context, round *receiverRound, token, receive string, block uint64) (*big.Int, error) {
	if round == nil {
		return c.receiverBalance(ctx, token, receive, block)
	}
	return round.balance(ctx, c, &round.source, token, receive, block)
}

func (c *Chain) deferReceivers(ctx context.Context, ids []string) error {
	scheduleCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 3*time.Second)
	defer cancel()
	_, err := c.pool.Exec(scheduleCtx, `UPDATE receiver_scans SET failures=least(failures+1,10),
 retry_at=now()+least(CASE WHEN legacy THEN interval '6 hours' ELSE interval '5 minutes' END,interval '1 minute'*power(2,failures)),
 next_at=now()+least(CASE WHEN legacy THEN interval '6 hours' ELSE interval '5 minutes' END,interval '1 minute'*power(2,failures)),updated_at=now()
 WHERE invoice_id=ANY($1::text[])`, ids)
	return err
}
