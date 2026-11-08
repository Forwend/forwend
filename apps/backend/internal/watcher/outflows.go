package watcher

import (
	"cmp"
	"context"
	"errors"
	"fmt"
	"log/slog"
	"math/big"
	"slices"
	"strings"
	"time"

	"github.com/ethereum/go-ethereum"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/common/hexutil"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/forwend/forwend/apps/backend/internal/address"
	"github.com/forwend/forwend/apps/backend/internal/chain"
	"github.com/forwend/forwend/apps/backend/internal/history"
	"github.com/jackc/pgx/v5"
)

var (
	settledTopic   = crypto.Keccak256Hash([]byte("Settled(bytes32,address,uint256)"))
	refundedTopic  = crypto.Keccak256Hash([]byte("Refunded(bytes32,address,uint256)"))
	recoveredTopic = crypto.Keccak256Hash([]byte("Recovered(bytes32,address,address,uint256)"))
	feesPaidTopic  = crypto.Keccak256Hash([]byte("FeesPaid(bytes32,address,uint256,uint256)"))
)

// Outflow is one settle, fees, refund or recover event of a receiver at or below the finalized block, with the token
// Transfer logs of its transaction, which name the transfer that moved the money.
type Outflow struct {
	InvoiceID string
	Log       types.Log
	Transfers []types.Log
	Time      uint64 // the event's block time
	Verified  uint64 // the finalized block that confirmed it
}

// outflowLogs reads the settle, fees, refund and recover events the watched receivers emitted in [lo, hi].
func (c *Chain) outflowLogs(ctx context.Context, lo, hi uint64, invoices map[common.Address]receiver) ([]types.Log, error) {
	var addresses []common.Address
	for addr := range invoices {
		addresses = append(addresses, addr)
	}
	var out []types.Log
	// Endpoints limit how many contracts one query names (PublicNode: 10). The pool tries the others first; when none
	// takes this many, smaller parts are read instead.
	size := topicLimit
	for len(addresses) > 0 {
		part := addresses[:min(size, len(addresses))]
		found, err := c.filterLogs(ctx, ethereum.FilterQuery{FromBlock: new(big.Int).SetUint64(lo), ToBlock: new(big.Int).SetUint64(hi),
			Addresses: part, Topics: [][]common.Hash{{settledTopic, feesPaidTopic, refundedTopic, recoveredTopic}}})
		if len(part) > 1 && chain.AddressesTooMany(err) {
			size = len(part) / 2
			continue
		}
		if err != nil {
			return nil, fmt.Errorf("read chain %d receiver events %d-%d: %w", c.chainID, lo, hi, err)
		}
		out = append(out, found...)
		addresses = addresses[len(part):]
	}
	return out, nil
}

// outflows keeps new events of canonical blocks at or below finalized and reads their transactions' token transfers.
// Events already recorded cost no reads, so the scan's overlap stays cheap; one recorded without its transfer, as when
// a node answered part of the logs, is read again until the transfer is found.
func (c *Chain) outflows(ctx context.Context, logs []types.Log, headers map[uint64]header,
	invoices map[common.Address]receiver, finalized uint64) ([]Outflow, error) {
	var hashes []string
	for _, l := range logs {
		hashes = append(hashes, hexutil.Encode(l.BlockHash[:]))
	}
	recorded := map[logKey]bool{}
	if len(hashes) > 0 {
		// FeesPaid makes an outflow per fee: its event is recorded once both are.
		rows, err := c.pool.Query(ctx, `SELECT block_hash, log_index FROM receiver_outflows
			WHERE chain_id = $1 AND block_hash = ANY($2::text[]) GROUP BY block_hash, log_index
			HAVING bool_and(transfer_log_index IS NOT NULL OR kind = 'recovery' OR ledger_transaction_id IS NOT NULL)`,
			c.chainID, hashes)
		if err != nil {
			return nil, fmt.Errorf("read chain %d recorded receiver events: %w", c.chainID, err)
		}
		for rows.Next() {
			var k logKey
			if err := rows.Scan(&k.blockHash, &k.index); err != nil {
				rows.Close()
				return nil, err
			}
			recorded[k] = true
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return nil, fmt.Errorf("read chain %d recorded receiver events: %w", c.chainID, err)
		}
	}
	var out []Outflow
	// A transaction with several events of one receiver, such as a batch of refunds, needs its transfers read once.
	type transfersOf struct {
		block           uint64
		token, receiver common.Address
	}
	read := map[transfersOf][]types.Log{}
	for _, l := range logs {
		h, ok := headers[l.BlockNumber]
		inv, watched := invoices[l.Address]
		if l.Removed || !watched || l.BlockNumber > finalized || !ok || h.Hash != l.BlockHash ||
			recorded[logKey{hexutil.Encode(l.BlockHash[:]), uint64(l.Index)}] {
			continue
		}
		key := transfersOf{l.BlockNumber, common.HexToAddress(inv.token), l.Address}
		transfers, done := read[key]
		if !done {
			block := new(big.Int).SetUint64(l.BlockNumber)
			var err error
			transfers, err = c.filterLogs(ctx, ethereum.FilterQuery{FromBlock: block, ToBlock: block,
				Addresses: []common.Address{key.token}, Topics: [][]common.Hash{{transferTopic}, {common.BytesToHash(l.Address.Bytes())}}})
			if err != nil {
				return nil, fmt.Errorf("read chain %d receiver %s transfers: %w", c.chainID, l.Address.Hex(), err)
			}
			read[key] = transfers
		}
		out = append(out, Outflow{InvoiceID: inv.invoiceID, Log: l, Transfers: transfers, Time: uint64(h.Timestamp), Verified: finalized})
	}
	return out, nil
}

// ReceiptOutflows are the receiver's events in a mined, finalized receipt; at is its block's time.
func ReceiptOutflows(invoiceID string, receiver common.Address, r *types.Receipt, at, verified uint64) []Outflow {
	transfers := make([]types.Log, len(r.Logs))
	for i, l := range r.Logs {
		transfers[i] = *l
	}
	var out []Outflow
	for _, l := range transfers {
		if l.Address == receiver && len(l.Topics) > 0 &&
			(l.Topics[0] == settledTopic || l.Topics[0] == feesPaidTopic || l.Topics[0] == refundedTopic ||
				l.Topics[0] == recoveredTopic) {
			out = append(out, Outflow{InvoiceID: invoiceID, Log: l, Transfers: transfers, Time: at, Verified: verified})
		}
	}
	return out
}

var errBadEvent = errors.New("not a movement of the receiver's invoice")

// RecordOutflows records receiver events once; booking them is the ledger's. An event a receiver did not emit for its
// own invoice is refused, so look-alike contracts can't move booked money.
func RecordOutflows(ctx context.Context, tx pgx.Tx, chainID uint64, outflows []Outflow) error {
	slices.SortFunc(outflows, func(a, b Outflow) int {
		if order := cmp.Compare(a.Log.BlockNumber, b.Log.BlockNumber); order != 0 {
			return order
		}
		return cmp.Compare(a.Log.Index, b.Log.Index)
	})
	previous := map[common.Hash]*uint{}
	for _, o := range outflows {
		err := recordOutflow(ctx, tx, chainID, o, previous[o.Log.TxHash])
		if errors.Is(err, errBadEvent) {
			// The receiver's code can't emit it, so an operator looks; the chain's scan goes on.
			slog.Error("ALERT receiver event is not a movement of its invoice; skipped", "chain", chainID,
				"invoice", o.InvoiceID, "tx", o.Log.TxHash.Hex(), "log", o.Log.Index, "err", err)
			continue
		}
		if err != nil {
			return err
		}
		index := o.Log.Index
		previous[o.Log.TxHash] = &index
	}
	return nil
}

// recordOutflow pairs the event with the latest matching token transfer before it in the same transaction, and after
// the previous event of that transaction.
func recordOutflow(ctx context.Context, tx pgx.Tx, chainID uint64, o Outflow, previous *uint) error {
	var receive, token, recipient, factory, amountText string
	var fees [2]string // network, platform
	if err := tx.QueryRow(ctx, `SELECT receive_address, token_contract, recipient_address, factory_address, amount::text,
		network_fee::text, platform_fee::text FROM invoices WHERE id = $1 AND chain_id = $2`, o.InvoiceID, chainID).
		Scan(&receive, &token, &recipient, &factory, &amountText, &fees[0], &fees[1]); err != nil {
		return fmt.Errorf("read invoice %s for its receiver event: %w", o.InvoiceID, err)
	}
	l := o.Log
	if l.Address != common.HexToAddress(receive) {
		return fmt.Errorf("receiver %s movement came from another contract: %w", o.InvoiceID, errBadEvent)
	}
	size := 32
	if len(l.Topics) > 0 && l.Topics[0] == feesPaidTopic {
		size = 64
	}
	if len(l.Data) != size || len(l.Topics) < 3 || l.Topics[1] != common.HexToHash(o.InvoiceID) {
		return fmt.Errorf("receiver %s emitted malformed movement evidence: %w", o.InvoiceID, errBadEvent)
	}
	var terms [2]*big.Int
	for i, fee := range fees {
		terms[i], _ = new(big.Int).SetString(fee, 10)
	}
	if l.Topics[0] == feesPaidTopic {
		return recordFees(ctx, tx, chainID, o, receive, token, factory, terms)
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
			return fmt.Errorf("receiver %s emitted malformed recovery: %w", o.InvoiceID, errBadEvent)
		}
		token, destination = strings.ToLower(destination.Hex()), common.BytesToAddress(l.Topics[3].Bytes())
		reason = "different_asset"
	default:
		return fmt.Errorf("receiver %s emitted unknown movement: %w", o.InvoiceID, errBadEvent)
	}
	amount := new(big.Int).SetBytes(l.Data)
	if kind == "settlement" { // the recipient gets the amount less the fees (R-230)
		net, _ := new(big.Int).SetString(amountText, 10)
		if amount.Cmp(net.Sub(net, terms[0]).Sub(net, terms[1])) != 0 {
			reason = "invalid_terms"
		}
	}
	if amount.Sign() == 0 {
		return nil
	}
	var transferIndex *uint64
	if kind != "recovery" {
		var lo *uint64
		if previous != nil {
			p := uint64(*previous)
			lo = &p
		}
		if found := transfers(o, token, receive, destination, amount, lo, uint64(l.Index)); len(found) > 0 {
			transferIndex = &found[len(found)-1]
		} else {
			reason = "transfer_evidence_missing"
		}
	}
	return insertOutflow(ctx, tx, chainID, o, receive, token, kind, destination, amount, reason, transferIndex)
}

// recordFees records FeesPaid as an outflow per fee above 0: the network fee to the settler, the platform fee to the
// factory's refund authority (R-230). Their transfers are settle's own, in that order, after its transfer to the
// recipient and before Settled, so they are found once Settled's transfer is.
func recordFees(ctx context.Context, tx pgx.Tx, chainID uint64, o Outflow, receive, token, factory string, terms [2]*big.Int) error {
	l := o.Log
	known, ok := address.KnownFactory(factory)
	if !ok || !address.Known[known].Fees {
		return fmt.Errorf("receiver %s has no fees in its terms: %w", o.InvoiceID, errBadEvent)
	}
	paid := [2]*big.Int{new(big.Int).SetBytes(l.Data[:32]), new(big.Int).SetBytes(l.Data[32:])}
	reason := "awaiting_booking"
	if len(l.Topics) != 3 || paid[0].Cmp(terms[0]) != 0 || paid[1].Cmp(terms[1]) != 0 {
		reason = "invalid_terms"
	}
	var after, settled *uint64
	err := tx.QueryRow(ctx, `SELECT transfer_log_index, log_index FROM receiver_outflows WHERE chain_id = $1
		AND block_hash = $2 AND tx_hash = $3 AND receiver_address = $4 AND kind = 'settlement'`, chainID,
		hexutil.Encode(l.BlockHash[:]), hexutil.Encode(l.TxHash[:]), receive).Scan(&after, &settled)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return fmt.Errorf("read receiver %s settlement of its fees: %w", o.InvoiceID, err)
	}
	to := [2]common.Address{common.BytesToAddress(l.Topics[2].Bytes()), common.Address(address.Known[known].RefundAuthority)}
	for i, kind := range []string{"network_fee", "platform_fee"} {
		if paid[i].Sign() == 0 {
			continue
		}
		why, index := reason, (*uint64)(nil)
		if after != nil {
			if found := transfers(o, token, receive, to[i], paid[i], after, *settled); len(found) > 0 {
				index, after = &found[0], &found[0]
			}
		}
		if index == nil {
			why = "transfer_evidence_missing"
		}
		if err := insertOutflow(ctx, tx, chainID, o, receive, token, kind, to[i], paid[i], why, index); err != nil {
			return err
		}
	}
	return nil
}

// transfers are the indexes, in order, of the event's transaction's token transfers from receive to destination of
// amount, after lo (nil: any) and before hi.
func transfers(o Outflow, token, receive string, destination common.Address, amount *big.Int, lo *uint64, hi uint64) []uint64 {
	l := o.Log
	var out []uint64
	for _, candidate := range o.Transfers {
		index := uint64(candidate.Index)
		if candidate.TxHash == l.TxHash && candidate.BlockHash == l.BlockHash && index < hi && (lo == nil || index > *lo) &&
			candidate.Address == common.HexToAddress(token) && len(candidate.Topics) == 3 && len(candidate.Data) == 32 &&
			common.BytesToAddress(candidate.Topics[1].Bytes()) == common.HexToAddress(receive) &&
			common.BytesToAddress(candidate.Topics[2].Bytes()) == destination && new(big.Int).SetBytes(candidate.Data).Cmp(amount) == 0 {
			out = append(out, index)
		}
	}
	slices.Sort(out)
	return out
}

func insertOutflow(ctx context.Context, tx pgx.Tx, chainID uint64, o Outflow, receive, token, kind string,
	destination common.Address, amount *big.Int, reason string, transferIndex *uint64) error {
	l := o.Log
	tag, err := tx.Exec(ctx, `INSERT INTO receiver_outflows (invoice_id, chain_id, receiver_address, token_contract,
  kind, destination, amount, tx_hash, log_index, block_hash, block_number, block_time, verified_block, reconciliation_error, transfer_log_index)
  VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) ON CONFLICT DO NOTHING`,
		o.InvoiceID, chainID, receive, token, kind, strings.ToLower(destination.Hex()), amount.String(),
		hexutil.Encode(l.TxHash[:]), l.Index, hexutil.Encode(l.BlockHash[:]), l.BlockNumber, o.Time, o.Verified, reason, transferIndex)
	if err != nil || tag.RowsAffected() == 1 || transferIndex == nil {
		return err
	}
	// Recorded before without its transfer and not booked: the transfer found now completes it, and the ledger books
	// it as any other. Only the same event of the same block, and only a transfer no other event claims.
	_, err = tx.Exec(ctx, `UPDATE receiver_outflows o SET transfer_log_index = $4, reconciliation_error = $5
  WHERE o.chain_id = $1 AND o.block_hash = $2 AND o.log_index = $3 AND o.transfer_log_index IS NULL
    AND o.ledger_transaction_id IS NULL AND o.kind = $6 AND o.amount = $7 AND o.destination = $8
    AND NOT EXISTS (SELECT 1 FROM receiver_outflows c WHERE c.chain_id = $1 AND c.block_hash = $2
      AND c.transfer_log_index = $4)`,
		chainID, hexutil.Encode(l.BlockHash[:]), l.Index, *transferIndex, reason, kind, amount.String(),
		strings.ToLower(destination.Hex()))
	if err != nil {
		return fmt.Errorf("complete receiver %s event evidence: %w", o.InvoiceID, err)
	}
	return nil
}

// deployTimes reads factory.deployedAt for receivers with events and no deploy time yet. A receiver deployed early by
// a recovery settles only until 30 days after its deploy, which shortens its checkout close.
func (c *Chain) deployTimes(ctx context.Context, outflows []Outflow, finalized uint64) (map[string]uint64, error) {
	var ids []string
	for _, o := range outflows {
		ids = append(ids, o.InvoiceID)
	}
	rows, err := c.pool.Query(ctx, `SELECT id, factory_address, receive_address FROM invoices
		WHERE id = ANY($1::text[]) AND coalesce(receiver_deployed_at, 0) = 0`, ids)
	if err != nil {
		return nil, fmt.Errorf("read chain %d receivers without a deploy time: %w", c.chainID, err)
	}
	type receiverRow struct{ ID, Factory, Receive string }
	missing, err := pgx.CollectRows(rows, pgx.RowToStructByPos[receiverRow])
	if err != nil {
		return nil, err
	}
	times := map[string]uint64{}
	for _, r := range missing {
		at, err := c.receiverDeployedAt(ctx, r.Factory, r.Receive, finalized)
		if err != nil {
			return nil, err
		}
		if at > 0 {
			times[r.ID] = at
		}
	}
	return times, nil
}

func recordDeployTimes(ctx context.Context, tx pgx.Tx, times map[string]uint64) error {
	for id, at := range times {
		var before, after int64
		if err := tx.QueryRow(ctx, "SELECT closes_at FROM invoices WHERE id = $1", id).Scan(&before); err != nil {
			return err
		}
		if err := tx.QueryRow(ctx, `UPDATE invoices SET receiver_deployed_at = $2 WHERE id = $1
			AND coalesce(receiver_deployed_at, 0) = 0 RETURNING closes_at`, id, int64(at)).Scan(&after); err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return fmt.Errorf("record invoice %s receiver deploy time: %w", id, err)
		}
		if after != 0 && after != before {
			if err := history.Add(ctx, tx, id, history.CheckoutCloseChanged, history.System,
				history.Data{Option: id, Until: time.Unix(after, 0).UTC().Format(time.RFC3339)}); err != nil {
				return err
			}
		}
	}
	return nil
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
