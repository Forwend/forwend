package invoice

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"math/big"
	"time"

	"github.com/forwend/forwend/apps/backend/internal/history"
	"github.com/forwend/forwend/apps/backend/internal/intents"
	"github.com/jackc/pgx/v5"
)

// How often the worker reads a quote's status (R-234): often while 1Click converts a deposit, less while it waits for
// one, rarely after the price window, and not at all once it ended or an hour past its deadline.
const (
	trackConverting = 10 * time.Second
	trackWaiting    = 30 * time.Second
	trackLate       = 2 * time.Minute
	trackAfter      = time.Hour // past the deadline, or past the conversion for a late refund of the extra
	trackRetry      = time.Minute
	// ponytail: one quote at a time, trackBatch a round; read them in parallel when more convert at once.
	trackBatch = 20
)

// ConvertingSQL is true while 1Click converts a deposit for invoice $1 or delivered it: the USDC is on its way to the
// Base option, so the pick, an edit and a cancel wait as for money seen (R-233).
const ConvertingSQL = `EXISTS (SELECT 1 FROM crosschain_quotes c WHERE c.invoice_id = $1
	AND c.status IN ('KNOWN_DEPOSIT_TX', 'PROCESSING', 'SUCCESS'))`

type trackedQuote struct {
	id, invoiceID, optionID, origin, address, status string
	shownUntil, deadline                             time.Time
	depositSeenAt, convertedAt                       *time.Time
	refunded                                         *big.Int
}

// TrackCrossChain reads 1Click's status of the quotes due for a check and keeps what changed. It decides nothing
// about money: paid comes only from the Base balance (R-119).
func (s *Service) TrackCrossChain(ctx context.Context, now time.Time) error {
	if s.crossChain == nil {
		return nil
	}
	rows, err := s.pool.Query(ctx, `SELECT id, invoice_id, option_id, origin_asset, deposit_address, status, shown_until,
		    deadline, deposit_seen_at, converted_at, coalesce(refunded_amount, 0)::text
		FROM crosschain_quotes WHERE next_check_at <= $1 ORDER BY next_check_at LIMIT $2`, now, trackBatch)
	if err != nil {
		return fmt.Errorf("read cross-chain quotes to check: %w", err)
	}
	quotes, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (trackedQuote, error) {
		var q trackedQuote
		var refunded string
		err := row.Scan(&q.id, &q.invoiceID, &q.optionID, &q.origin, &q.address, &q.status, &q.shownUntil, &q.deadline,
			&q.depositSeenAt, &q.convertedAt, &refunded)
		q.refunded, _ = new(big.Int).SetString(refunded, 10)
		return q, err
	})
	if err != nil {
		return fmt.Errorf("read cross-chain quotes to check: %w", err)
	}
	for _, q := range quotes {
		status, err := s.crossChain.Status(ctx, q.address)
		if err != nil {
			slog.Warn("read cross-chain status", "quote", q.id, "err", err)
			if _, err := s.pool.Exec(ctx, "UPDATE crosschain_quotes SET next_check_at = $2 WHERE id = $1", q.id,
				now.Add(trackRetry)); err != nil {
				return fmt.Errorf("delay cross-chain quote %s: %w", q.id, err)
			}
			continue
		}
		if err := s.keepStatus(ctx, q, status, now); err != nil {
			return err
		}
	}
	return nil
}

// keepStatus writes 1Click's status of q and the history of what changed, in one transaction.
func (s *Service) keepStatus(ctx context.Context, q trackedQuote, st intents.Status, now time.Time) error {
	converted := q.convertedAt
	if converted == nil && st.Status == intents.Success {
		converted = &now
	}
	next := nextCheck(q, st.Status, converted, now)
	origin, _ := json.Marshal(st.OriginTxs)
	destination, _ := json.Marshal(st.DestinationTxs)
	return pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `UPDATE crosschain_quotes SET status = $2, next_check_at = $3,
		    deposited_amount = coalesce($4::numeric, deposited_amount), delivered_amount = coalesce($5::numeric, delivered_amount),
		    refunded_amount = coalesce($6::numeric, refunded_amount), refund_reason = coalesce($7, refund_reason),
		    origin_txs = CASE WHEN $8::jsonb = '[]' THEN origin_txs ELSE $8 END,
		    destination_txs = CASE WHEN $9::jsonb = '[]' THEN destination_txs ELSE $9 END,
		    deposit_seen_at = coalesce(deposit_seen_at, CASE WHEN $2 <> 'PENDING_DEPOSIT' THEN $10::timestamptz END),
		    converted_at = coalesce(converted_at, $11)
		  WHERE id = $1 AND status = $12`, q.id, st.Status, next, orNil(st.Deposited), orNil(st.Delivered),
			orNil(st.Refunded), orNil(st.RefundReason), origin, destination, now, converted, q.status)
		if err != nil {
			return fmt.Errorf("keep cross-chain quote %s: %w", q.id, err)
		}
		if tag.RowsAffected() == 0 {
			return nil // the row moved on since it was read
		}
		return s.statusHistory(ctx, tx, q, st)
	})
}

func (s *Service) statusHistory(ctx context.Context, tx pgx.Tx, q trackedQuote, st intents.Status) error {
	add := func(kind string, data history.Data) error {
		return history.Add(ctx, tx, q.optionID, kind, history.System, data)
	}
	first := func(txs []intents.Tx) string {
		if len(txs) == 0 {
			return ""
		}
		return txs[0].Hash
	}
	// Each event once, also if 1Click's status ever moves back.
	if q.depositSeenAt == nil && intents.DepositSeen(st.Status) {
		if err := add(history.CrossChainDeposit, history.Data{Asset: q.origin, Amount: st.Deposited,
			TxHash: first(st.OriginTxs)}); err != nil {
			return err
		}
	}
	if q.convertedAt == nil && st.Status == intents.Success {
		if err := add(history.CrossChainConverted, history.Data{Amount: st.Delivered, TxHash: first(st.DestinationTxs)}); err != nil {
			return err
		}
	}
	// A refund of a short deposit ends the swap; one of the unused slippage or an extra comes after it converted.
	if refunded, ok := new(big.Int).SetString(st.Refunded, 10); ok && refunded.Cmp(q.refunded) > 0 {
		if err := add(history.CrossChainRefunded, history.Data{Asset: q.origin, Amount: refunded.String(),
			Reason: st.RefundReason}); err != nil {
			return err
		}
	}
	if q.status != intents.Failed && st.Status == intents.Failed {
		slog.Error("ALERT cross-chain swap failed: 1Click returns the deposit or handles it by hand", "quote", q.id,
			"invoice", q.invoiceID)
		return add(history.CrossChainFailed, history.Data{Asset: q.origin})
	}
	return nil
}

// nextCheck is when the worker reads the quote again, nil for never.
func nextCheck(q trackedQuote, status string, converted *time.Time, now time.Time) *time.Time {
	at := func(d time.Duration) *time.Time { t := now.Add(d); return &t }
	switch {
	case status == intents.Success && now.Before(converted.Add(trackAfter)):
		return at(trackLate)
	case intents.Final(status):
		return nil
	case status == intents.KnownDepositTx || status == intents.Processing:
		return at(trackConverting)
	case now.Before(q.shownUntil):
		return at(trackWaiting)
	case now.Before(q.deadline.Add(trackAfter)):
		return at(trackLate)
	}
	return nil
}

func orNil(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}
