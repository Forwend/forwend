package invoice

import (
	"context"
	"errors"
	"fmt"
	"math/big"
	"strings"
	"time"

	"github.com/ensp1re/forwend/apps/backend/internal/finality"
	"github.com/ensp1re/forwend/apps/backend/internal/ledger"
	"github.com/ensp1re/forwend/apps/backend/internal/outbox"
	"github.com/jackc/pgx/v5"
)

// Get reads an invoice by its on-chain id (0x + 64 hex); an option's id reads the invoice it belongs to.
func (s *Service) Get(ctx context.Context, id string) (Invoice, error) {
	return s.get(ctx, "", id)
}

// GetOfProfile is Get for the profile's owner: another profile's invoice is ErrNotFound.
func (s *Service) GetOfProfile(ctx context.Context, profileID, id string) (Invoice, error) {
	return s.get(ctx, profileID, id)
}

// get reads any profile's invoice when profileID is "".
func (s *Service) get(ctx context.Context, profileID, id string) (Invoice, error) {
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
	if inv.Options, err = s.options(ctx, inv.ID); err != nil {
		return Invoice{}, err
	}
	if inv.Lines, err = s.lines(ctx, inv.ID); err != nil {
		return Invoice{}, err
	}
	// The last deposit that booked money to the creator is the one that completed the amount: later ones are held.
	var paidAt *int64
	var settledAt *time.Time
	err = s.pool.QueryRow(ctx, `SELECT t.symbol, t.decimals, c.name,
		(SELECT max(ct.block_time) FROM chain_transfers ct
		 JOIN ledger_transactions l ON l.chain_transfer_id = ct.id
		 JOIN ledger_entries e ON e.transaction_id = l.id AND e.account = 'recipient_payable'
		 WHERE ct.invoice_id = $3),
		(SELECT created_at FROM ledger_transactions WHERE invoice_id = $3 AND kind = 'settlement')
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
	// Each option's own deposits: on an option that was not chosen they are held for the payer (D-76).
	for i, o := range inv.Options {
		if inv.Options[i].Deposits, err = s.deposits(ctx, o.ID, o.ChainID, inv.ExpiresAt); err != nil {
			return Invoice{}, err
		}
		if o.ID == inv.OptionID {
			inv.Deposits = inv.Options[i].Deposits
		}
	}
	if profileID != "" { // the owner's read only; the public one leaves it out
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
		inv.Reminders, err = s.reminders(ctx, inv.ID)
		return inv, err
	}
	return inv, err
}

// settlementWait reads why a paid, unsettled invoice still waits, from its intent's status and stored wait kind.
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
		// The ledger queues the intent in the same transaction as paid; none yet means the next round makes it.
		return &SettlementWait{Kind: WaitSigning}, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read invoice %s settlement intent: %w", inv.ID, err)
	}
	switch {
	case status == "refused":
		return &SettlementWait{Kind: WaitRefused}, nil
	// A wait whose time has passed is over: the signer is on it again (a resolved stall can keep its kind until
	// confirmed), so it reads as the status alone.
	case wait != nil && *wait == "cap" && next.After(time.Now()):
		return &SettlementWait{Kind: WaitDailyLimit, Until: next.UTC()}, nil
	case wait != nil && next.After(time.Now()): // retry, or a sent settle the signer can't resolve yet
		return &SettlementWait{Kind: WaitRetrying, Until: next.UTC()}, nil
	case status == "sent" && signed != nil:
		// The settle mines within moments of signing, so its block time is about signed_at: what is left is the chain
		// time the finalized head must still cover, as for a deposit (finality.ProgressOf).
		w := &SettlementWait{Kind: WaitFinalizing}
		if t := signed.Unix(); t > int64(head.Time) {
			w.TimeLeft = time.Duration(t-int64(head.Time)) * time.Second
		}
		return w, nil
	default:
		return &SettlementWait{Kind: WaitSigning}, nil
	}
}

// deposits lists the invoice's transfers that are not reorged, with progress toward the chain's finalized block head.
func (s *Service) deposits(ctx context.Context, id string, chainID uint64, expiresAt time.Time) ([]Deposit, error) {
	head, err := s.head(ctx, chainID)
	if err != nil {
		return nil, err
	}
	rows, err := s.pool.Query(ctx, `SELECT tx_hash, log_index, from_address, amount::text, block_number, block_time, status,
		       coalesce(detected_finalized_block, 0)
		FROM chain_transfers WHERE invoice_id = $1 AND status <> 'reorged' ORDER BY block_number, log_index`, id)
	if err != nil {
		return nil, fmt.Errorf("read invoice %s deposits: %w", id, err)
	}
	defer rows.Close()
	out := []Deposit{}
	for rows.Next() {
		var d Deposit
		var amount string
		var blockTime, seenFinalized uint64
		if err := rows.Scan(&d.TxHash, &d.LogIndex, &d.From, &amount, &d.BlockNumber, &blockTime, &d.Status,
			&seenFinalized); err != nil {
			return nil, fmt.Errorf("read invoice %s deposits: %w", id, err)
		}
		d.Amount, _ = new(big.Int).SetString(amount, 10)
		d.BlockTime = time.Unix(int64(blockTime), 0).UTC()
		d.Late = int64(blockTime) > expiresAt.Unix()
		if d.Status != "confirmed" {
			d.Progress = finality.ProgressOf(finality.Block{Number: d.BlockNumber, Time: blockTime}, head)
			d.BlocksTotal = d.BlocksLeft
			if seenFinalized > 0 && seenFinalized < d.BlockNumber {
				d.BlocksTotal = max(d.BlocksLeft, d.BlockNumber-seenFinalized)
			}
		}
		out = append(out, d)
	}
	return out, rows.Err()
}

// head is the chain's finalized block as the worker last read it; zero before its first scan.
func (s *Service) head(ctx context.Context, chainID uint64) (finality.Block, error) {
	var head finality.Block
	err := s.pool.QueryRow(ctx, "SELECT last_finalized_block, last_finalized_time FROM chain_cursors WHERE chain_id = $1",
		chainID).Scan(&head.Number, &head.Time)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return finality.Block{}, fmt.Errorf("read chain %d cursor: %w", chainID, err)
	}
	return head, nil
}

// options lists the invoice's accepted options, ordered by chain and symbol: one for a fixed invoice.
func (s *Service) options(ctx context.Context, id string) ([]Option, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT i.id, i.chain_id, i.token_contract, t.symbol, t.decimals, c.name, i.amount::text, i.receive_address
		FROM invoices i JOIN tokens t ON t.chain_id = i.chain_id AND t.contract = i.token_contract
		JOIN chains c ON c.chain_id = i.chain_id
		WHERE i.id = $1 OR i.main_id = $1 ORDER BY i.chain_id, t.symbol, i.token_contract`, id)
	if err != nil {
		return nil, fmt.Errorf("read invoice %s options: %w", id, err)
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (Option, error) {
		var o Option
		var amount string
		err := row.Scan(&o.ID, &o.ChainID, &o.Token, &o.Symbol, &o.Decimals, &o.Network, &amount, &o.ReceiveAddress)
		o.Amount, _ = new(big.Int).SetString(amount, 10)
		return o, err
	})
}

// lines reads the invoice's line items in order (R-88); none when it has no breakdown.
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
