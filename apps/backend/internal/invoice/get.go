package invoice

import (
	"context"
	"encoding/hex"
	"errors"
	"fmt"
	"math/big"
	"regexp"
	"strings"
	"time"

	"github.com/forwend/forwend/apps/backend/internal/address"
	"github.com/forwend/forwend/apps/backend/internal/finality"
	"github.com/forwend/forwend/apps/backend/internal/ledger"
	"github.com/forwend/forwend/apps/backend/internal/outbox"
	"github.com/jackc/pgx/v5"
)

// Get takes the pay link's secret token (D-86), never an on-chain id: the chain makes those public.
func (s *Service) Get(ctx context.Context, payToken string) (Invoice, error) {
	id, ok := idOf(payToken)
	if !ok {
		return Invoice{}, ErrNotFound
	}
	return s.get(ctx, "", id, false)
}

func idOf(payToken string) (string, bool) {
	var token [32]byte
	if !payTokenShape.MatchString(payToken) {
		return "", false
	}
	_, _ = hex.Decode(token[:], []byte(payToken))
	return hexID(address.InvoiceID(token)), true
}

var payTokenShape = regexp.MustCompile(`^[0-9a-f]{64}$`)

// GetOfProfile is Get for the profile's owner: another profile's invoice is ErrNotFound.
func (s *Service) GetOfProfile(ctx context.Context, profileID, id string) (Invoice, error) {
	return s.get(ctx, profileID, id, false)
}

func (s *Service) GetProfileSummary(ctx context.Context, profileID, id string) (Invoice, error) {
	return s.get(ctx, profileID, id, true)
}

// Unnumbered is true for a link invoice before its first deposit, which only its payer sees (R-141).
func (s *Service) Unnumbered(ctx context.Context, id string) (bool, error) {
	var unnumbered bool
	if err := s.pool.QueryRow(ctx, "SELECT EXISTS (SELECT 1 FROM invoices WHERE id = lower($1) AND number IS NULL)",
		id).Scan(&unnumbered); err != nil {
		return false, fmt.Errorf("read invoice %s number: %w", id, err)
	}
	return unnumbered, nil
}

// get reads any profile's invoice when profileID is "".
func (s *Service) get(ctx context.Context, profileID, id string, summary bool) (Invoice, error) {
	id = strings.ToLower(id)
	if len(id) != 66 || !strings.HasPrefix(id, "0x") || strings.Trim(id[2:], "0123456789abcdef") != "" {
		return Invoice{}, ErrNotFound
	}
	inv, err := scanInvoice(s.pool.QueryRow(ctx, "SELECT "+invoiceColumns+" FROM "+invoicesCurrent+
		` WHERE id = (SELECT coalesce(main_id, id) FROM invoices WHERE id = $1)
		  AND profile_id = coalesce(nullif($2, '')::uuid, profile_id)`, id, profileID))
	if err != nil {
		return Invoice{}, err
	}
	options, err := readPaymentOptionsFor(ctx, s.pool, []string{inv.ID}, summary)
	if err != nil {
		return Invoice{}, err
	}
	inv.Options = options[inv.ID]
	if inv.Lines, err = s.lines(ctx, inv.ID); err != nil {
		return Invoice{}, err
	}
	if inv.Updates, err = s.updates(ctx, inv.ID); err != nil {
		return Invoice{}, err
	}
	if inv.ReplacedBy, err = s.revision(ctx, `SELECT n.id, n.number, coalesce(n.pay_token, '') FROM invoices o
		JOIN invoices n ON n.id = o.replaced_by WHERE o.id = $1`, inv.ID); err != nil {
		return Invoice{}, err
	}
	// The last deposit that booked money to the creator is the one that completed the amount: later ones are held.
	var paidAt *int64
	var settledAt *time.Time
	err = s.pool.QueryRow(ctx, `SELECT t.symbol, t.decimals, c.name, `+PaidAtSQL("$3")+`,
		coalesce((SELECT to_timestamp(block_time) FROM receiver_outflows WHERE invoice_id = $3 AND kind = 'settlement'
            AND ledger_transaction_id IS NOT NULL),
  (SELECT created_at FROM ledger_transactions WHERE invoice_id = $3 AND kind = 'settlement'))
		FROM tokens t JOIN chains c ON c.chain_id = t.chain_id WHERE t.chain_id = $1 AND t.contract = $2`,
		inv.ChainID, inv.Token, inv.OptionID).Scan(&inv.Symbol, &inv.Decimals, &inv.Network, &paidAt, &settledAt)
	if err != nil {
		return Invoice{}, fmt.Errorf("read invoice %s token, paid and settled times: %w", inv.ID, err)
	}
	if inv.PaymentStatus == ledger.Paid && paidAt != nil {
		inv.PaidAt = time.Unix(*paidAt, 0).UTC()
	}
	if settledAt != nil {
		inv.SettledAt = settledAt.UTC()
	}
	// The page shows when Check status may run again, also after a reload (R-55).
	var next *time.Time
	if err := s.pool.QueryRow(ctx, `SELECT max(checked_at) + make_interval(secs => $2) FROM invoice_rechecks
		WHERE invoice_id = $1 AND checked_at > now() - make_interval(secs => $2)`, inv.ID,
		RecheckEvery.Seconds()).Scan(&next); err != nil {
		return Invoice{}, fmt.Errorf("read invoice %s last check: %w", inv.ID, err)
	}
	if next != nil {
		inv.NextCheckAt = next.UTC()
	}
	ids := make([]string, len(inv.Options))
	for i, option := range inv.Options {
		ids[i] = option.ID
	}
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return Invoice{}, err
	}
	defer tx.Rollback(ctx)
	amounts, err := ledger.ReadAmountsFor(ctx, tx, ids)
	if err != nil {
		return Invoice{}, err
	}
	summaries, err := readDepositSummaries(ctx, tx, ids)
	if err != nil {
		return Invoice{}, err
	}
	for i, option := range inv.Options {
		inv.Options[i].DepositSummary = summaries[option.ID]
		if summary := summaries[option.ID]; summary != nil {
			head, err := readHead(ctx, tx, option.ChainID)
			if err != nil {
				return Invoice{}, err
			}
			if inv.Options[i].Deposits, err = readDepositPreview(ctx, tx, option.ID, head, summary.Count); err != nil {
				return Invoice{}, err
			}
		}
		inv.Options[i].Amounts = amounts[option.ID]
		if option.ID == inv.OptionID {
			inv.Amounts = inv.Options[i].Amounts
			inv.Deposits = inv.Options[i].Deposits
			inv.DepositSummary = inv.Options[i].DepositSummary
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return Invoice{}, err
	}
	if profileID != "" { // the owner's read only; the public one leaves it out
		receipts, err := readPaymentReceipts(ctx, s.pool, []string{inv.ID})
		if err != nil {
			return Invoice{}, err
		}
		inv.Receipts = receipts[inv.ID]
		head, err := s.head(ctx, inv.ChainID)
		if err != nil {
			return Invoice{}, err
		}
		if inv.SettlementWait, err = s.settlementWait(ctx, inv, head); err != nil {
			return Invoice{}, err
		}
		if inv.Sends, err = s.emails(ctx, inv.ID, outbox.Sent); err != nil {
			return Invoice{}, err
		}
		if inv.Reminders, err = s.reminders(ctx, inv.ID); err != nil {
			return Invoice{}, err
		}
		if inv.History, err = s.history(ctx, inv.ID); err != nil {
			return Invoice{}, err
		}
		if inv.Views, err = s.views(ctx, inv.ID); err != nil {
			return Invoice{}, err
		}
		if inv.Memo, err = s.memo(ctx, inv.ID); err != nil {
			return Invoice{}, err
		}
		if inv.Replaces, err = s.revision(ctx, `SELECT id, number, '' FROM invoices WHERE replaced_by = $1`,
			inv.ID); err != nil {
			return Invoice{}, err
		}
		until := reopenClose(inv.SettleDeadline, inv.receiverDeployedAt)
		if inv.PaymentStatus == ledger.ExpiredPartiallyPaid && inv.RefundStatus == "held" &&
			inv.ClosesAt.Equal(inv.ExpiresAt) && s.currentTime().Before(until) {
			var returned bool
			if err := s.pool.QueryRow(ctx, "SELECT EXISTS (SELECT 1 FROM receiver_outflows WHERE invoice_id = $1 AND kind IN ('refund','settlement'))", inv.OptionID).Scan(&returned); err != nil {
				return Invoice{}, err
			}
			position, err := ledger.ReadReopenPosition(ctx, s.pool, inv.OptionID)
			if err != nil {
				return Invoice{}, err
			}
			capacity := !returned && position != nil && position.Time < until.Unix()
			if inv.LinkID != "" && capacity {
				if err := s.pool.QueryRow(ctx, linkCapacitySQL, inv.LinkID).Scan(&capacity); err != nil {
					return Invoice{}, fmt.Errorf("read payment link capacity: %w", err)
				}
			}
			if capacity {
				inv.ReopenUntil = until
			}
		}
		inv.Retainer, err = s.retainer(ctx, inv.ID)
		return inv, err
	}
	return inv, err
}

// PaidAtSQL is the block time (unix seconds) of the last deposit booked to the owner on the option row whose id is
// the SQL expression option; later deposits are held. Read it once paid.
func PaidAtSQL(option string) string {
	return `(SELECT max(ct.block_time) FROM chain_transfers ct
		JOIN ledger_transactions l ON l.chain_transfer_id = ct.id
		JOIN ledger_entries e ON e.transaction_id = l.id AND e.account = 'recipient_payable'
		WHERE ct.invoice_id = ` + option + `)`
}

func (s *Service) settlementWait(ctx context.Context, inv Invoice, head finality.Block) (*SettlementWait, error) {
	if inv.PaymentStatus != ledger.Paid || inv.SettlementStatus == "settled" {
		return nil, nil
	}
	var status string
	var wait *string
	var next time.Time
	var signed *time.Time
	err := s.pool.QueryRow(ctx, `SELECT status, wait, next_attempt_at, signed_at FROM settlement_intents
		WHERE invoice_id = $1`, inv.OptionID).Scan(&status, &wait, &next, &signed)
	if errors.Is(err, pgx.ErrNoRows) {
		// Not expected: the ledger inserts the intent in the transaction that marks the invoice paid.
		return &SettlementWait{Kind: WaitSigning}, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read invoice %s settlement intent: %w", inv.ID, err)
	}
	switch {
	case status == "refused":
		return &SettlementWait{Kind: WaitRefused}, nil
	// A wait whose time has passed is over (a resolved stall can keep its kind), so it reads as the status alone.
	case wait != nil && *wait == "cap" && next.After(time.Now()):
		return &SettlementWait{Kind: WaitDailyLimit, Until: next.UTC()}, nil
	case wait != nil && next.After(time.Now()): // retry, or a sent settle the signer can't resolve yet
		return &SettlementWait{Kind: WaitRetrying, Until: next.UTC()}, nil
	case status == "sent" && signed != nil:
		// The settle mines moments after signing, so signed_at stands in for its block time.
		w := &SettlementWait{Kind: WaitFinalizing}
		if t := signed.Unix(); t > int64(head.Time) {
			w.TimeLeft = time.Duration(t-int64(head.Time)) * time.Second
		}
		return w, nil
	default:
		return &SettlementWait{Kind: WaitSigning}, nil
	}
}

func (s *Service) head(ctx context.Context, chainID uint64) (finality.Block, error) {
	return readHead(ctx, s.pool, chainID)
}

func readHead(ctx context.Context, db paymentReader, chainID uint64) (finality.Block, error) {
	var head finality.Block
	err := db.QueryRow(ctx, "SELECT last_finalized_block, last_finalized_time FROM chain_cursors WHERE chain_id = $1",
		chainID).Scan(&head.Number, &head.Time)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return finality.Block{}, fmt.Errorf("read chain %d cursor: %w", chainID, err)
	}
	return head, nil
}

func (s *Service) options(ctx context.Context, id string) ([]Option, error) {
	return readPaymentOptions(ctx, s.pool, id)
}

func readPaymentOptions(ctx context.Context, db paymentReader, id string) ([]Option, error) {
	options, err := readPaymentOptionsFor(ctx, db, []string{id}, false)
	return options[id], err
}

func readPaymentOptionsFor(ctx context.Context, db paymentReader, ids []string, activeOnly bool) (map[string][]Option, error) {
	rows, err := db.Query(ctx, `SELECT coalesce(i.main_id,i.id),i.id,i.chain_id,i.token_contract,t.symbol,t.decimals,c.name,
        i.amount::text,i.receive_address,i.closes_at FROM invoices i
        JOIN tokens t ON t.chain_id = i.chain_id AND t.contract = i.token_contract JOIN chains c ON c.chain_id = i.chain_id
        WHERE (i.id = ANY($1::text[]) OR i.main_id = ANY($1::text[])) AND (NOT $2
        OR i.main_id IS NULL
        OR i.id = (SELECT coalesce(m.chosen_id,m.id) FROM invoices m WHERE m.id=coalesce(i.main_id,i.id))
        OR EXISTS (SELECT 1 FROM chain_transfers d WHERE d.invoice_id=i.id AND d.status <> 'reorged')
        OR EXISTS (SELECT 1 FROM receiver_outflows o WHERE o.invoice_id=i.id)
        OR EXISTS (SELECT 1 FROM receiver_scans s WHERE s.invoice_id=i.id AND
            (s.booking_error IS NOT NULL OR s.reconciliation_error NOT IN ('rescan_required','opening_balance'))))
        ORDER BY coalesce(i.main_id,i.id),i.chain_id,t.symbol,i.token_contract`, ids, activeOnly)
	if err != nil {
		return nil, fmt.Errorf("read payment options: %w", err)
	}
	defer rows.Close()
	result := make(map[string][]Option, len(ids))
	for rows.Next() {
		var main, amount string
		var closes int64
		var option Option
		if err := rows.Scan(&main, &option.ID, &option.ChainID, &option.Token, &option.Symbol, &option.Decimals, &option.Network, &amount, &option.ReceiveAddress, &closes); err != nil {
			return nil, err
		}
		option.Amount, _ = new(big.Int).SetString(amount, 10)
		option.ClosesAt = time.Unix(closes, 0).UTC()
		result[main] = append(result[main], option)
	}
	return result, rows.Err()
}

// R-88.
func (s *Service) lines(ctx context.Context, id string) ([]Line, error) {
	rows, err := s.pool.Query(ctx, `SELECT description, quantity::text, unit_price::text, amount::text
		FROM invoice_lines WHERE invoice_id = $1 ORDER BY position`, id)
	if err != nil {
		return nil, fmt.Errorf("read invoice %s lines: %w", id, err)
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (Line, error) {
		var l Line
		var unitPrice, amount string
		err := row.Scan(&l.Description, &l.Quantity, &unitPrice, &amount)
		l.UnitPrice, _ = new(big.Int).SetString(unitPrice, 10)
		l.Amount, _ = new(big.Int).SetString(amount, 10)
		return l, err
	})
}

// revision reads the other invoice of a Revise with query, nil when there is none.
func (s *Service) revision(ctx context.Context, query, id string) (*Revision, error) {
	var r Revision
	err := s.pool.QueryRow(ctx, query, id).Scan(&r.ID, &r.Number, &r.PayToken)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	} else if err != nil {
		return nil, fmt.Errorf("read invoice %s revision: %w", id, err)
	}
	return &r, nil
}
