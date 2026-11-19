package ledger

import (
	"context"
	"errors"
	"fmt"
	"math/big"

	"github.com/forwend/forwend/apps/backend/internal/history"
	"github.com/jackc/pgx/v5"
)

// leastAmount is the least an option's payments must add up to before they choose it (D-76): a tenth of the amount, at
// most 1.00 USD (one whole token of a stablecoin, D-75). A partial payment then chooses, and a stranger's dust can't.
const leastAmount = `least(greatest(div(i.amount, 10), 1), (10::numeric ^ tk.decimals)::numeric(78, 0))`

// optionTotals are the on-time payments of the options of invoice $1, each with its option's running total; the caller
// adds the status it counts.
const optionTotals = `SELECT t.invoice_id, t.block_time, t.chain_id, t.block_number, t.log_index, t.booked,
	    sum(t.amount) OVER (PARTITION BY t.invoice_id ORDER BY t.block_time, t.block_number, t.log_index) AS total,
	    ` + leastAmount + ` AS least
	FROM chain_transfers t JOIN invoices i ON i.id = t.invoice_id
	JOIN tokens tk ON tk.chain_id = i.chain_id AND tk.contract = i.token_contract
	WHERE coalesce(i.main_id, i.id) = $1 AND t.block_time <= i.closes_at`

// ChoosingSeenSQL is true while a payment that can choose an option of invoice $1 is seen, final or not.
const ChoosingSeenSQL = `EXISTS (SELECT 1 FROM (` + optionTotals + ` AND t.status <> 'reorged') s WHERE total >= least)`

// optionChoice is where one option of a payer-chooses invoice stands.
type optionChoice struct {
	noneChosen bool // every payment is the payer's until one chooses
	superseded bool // another option is chosen: this one's money is held for the payer
	// applyEarlier: this option is chosen, so its parts held while nothing was chosen pay the creator (applyHeldParts),
	// unless it takes no more money (a cancel, D-26) or a return of it is under way.
	applyEarlier bool
	shown        bool // the row invoices_current shows: the chosen option, or the main row until one is chosen
	// closedEverywhere: with nothing chosen past the close, every enabled option chain is final past it too, so no
	// payment made before the close can still come.
	closedEverywhere bool
}

// chooseOption (R-56, D-76): the first option whose final payments add up to its least amount is the invoice's, under
// the main row's lock so two options can't both win; money on any other option is held for the payer. waiting is true
// while a payment that can choose is seen but not final.
func chooseOption(ctx context.Context, tx pgx.Tx, invoiceID, group, current, refund, settlementState string, closesAt,
	finalizedTime int64) (c optionChoice, waiting bool, err error) {
	var chosen *string
	if err := tx.QueryRow(ctx, "SELECT chosen_id FROM invoices WHERE id = $1 FOR NO KEY UPDATE", group).Scan(&chosen); err != nil {
		return c, false, fmt.Errorf("read invoice %s chosen option: %w", group, err)
	}
	if chosen == nil {
		// No other network is waited for: each payment is confirmed on its own network.
		var first string
		err := tx.QueryRow(ctx, `SELECT invoice_id FROM (`+optionTotals+` AND t.status = 'confirmed') s
			WHERE total >= least ORDER BY block_time, chain_id, block_number, log_index LIMIT 1`, group).Scan(&first)
		switch {
		case errors.Is(err, pgx.ErrNoRows):
			// Waits for the choice only while a payment that can choose confirms: dust never holds the page.
			var seen bool
			if err := tx.QueryRow(ctx, `SELECT `+ChoosingSeenSQL, group).Scan(&seen); err != nil || seen {
				return c, seen, err
			}
		case err != nil:
			return c, false, fmt.Errorf("read invoice %s first paid option: %w", group, err)
		default:
			if _, err := tx.Exec(ctx, "UPDATE invoices SET chosen_id = $2 WHERE id = $1", group, first); err != nil {
				return c, false, fmt.Errorf("choose invoice %s option %s: %w", group, first, err)
			}
			if err := history.Add(ctx, tx, group, history.OptionChosen, history.System, history.Data{Option: first}); err != nil {
				return c, false, err
			}
			chosen = &first
		}
	}
	c = optionChoice{
		noneChosen: chosen == nil,
		superseded: chosen != nil && *chosen != invoiceID,
		applyEarlier: chosen != nil && *chosen == invoiceID && refund != "refund_pending" && !Final(current) &&
			settlementState != "settled",
		shown:            chosen == nil && invoiceID == group || chosen != nil && *chosen == invoiceID,
		closedEverywhere: true,
	}
	if chosen == nil && finalizedTime > closesAt {
		// A payment made before the close may still come on an option chain not final past it.
		if err := tx.QueryRow(ctx, `SELECT NOT EXISTS (SELECT 1 FROM invoices o
			    JOIN chains c ON c.chain_id = o.chain_id AND c.enabled
			    LEFT JOIN chain_cursors cur ON cur.chain_id = o.chain_id
			    WHERE (o.id = $1 OR o.main_id = $1) AND coalesce(cur.last_finalized_time, 0) <= o.closes_at)`,
			group).Scan(&c.closedEverywhere); err != nil {
			return c, false, fmt.Errorf("read invoice %s option chains past its close: %w", group, err)
		}
	}
	return c, false, nil
}

// recordAwaitingChoice shows money seen on a payer-chooses invoice while the choice waits (R-119): open becomes detected.
func recordAwaitingChoice(ctx context.Context, tx pgx.Tx, invoiceID, group, current string) error {
	if invoiceID != group || current != Open {
		return nil
	}
	if _, err := tx.Exec(ctx, "UPDATE invoices SET payment_status = $2 WHERE id = $1", group, Detected); err != nil {
		return err
	}
	if err := history.Add(ctx, tx, group, "invoice."+Detected, history.System, history.Data{}); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// applyHeldParts moves the held parts of option's on-time deposits, booked while no option was chosen, to the creator,
// at most up to; each part names its transfer, so readers see which deposits paid the creator. It returns what moved.
func applyHeldParts(ctx context.Context, tx pgx.Tx, option string, closesAt int64, up *big.Int) (*big.Int, error) {
	// A refund names no deposit, so after one, booked or not, a held deposit row may be money already returned: nothing
	// moves, and what is held stays the payer's.
	var refunded bool
	if err := tx.QueryRow(ctx, "SELECT EXISTS (SELECT 1 FROM receiver_outflows WHERE invoice_id = $1 AND kind = 'refund')",
		option).Scan(&refunded); err != nil || refunded {
		return new(big.Int), err
	}
	held, err := accountBalance(ctx, tx, option, "payer_held")
	if err != nil {
		return nil, err
	}
	left := minInt(new(big.Int).Set(up), held.Neg(held)) // a part already returned to its payer stays returned
	// Each deposit's held part net of what a reopen already gave the creator; one with a chosen booking is done.
	rows, err := tx.Query(ctx, `SELECT x.chain_transfer_id, (-sum(e.amount))::text
		FROM ledger_transactions x JOIN ledger_entries e ON e.transaction_id = x.id AND e.account = 'payer_held'
		JOIN chain_transfers t ON t.id = x.chain_transfer_id
		WHERE x.invoice_id = $1 AND x.kind IN ('deposit', 'reopen') AND t.block_time <= $2
		  AND NOT EXISTS (SELECT 1 FROM ledger_transactions c WHERE c.chain_transfer_id = x.chain_transfer_id
		                  AND c.kind = 'chosen')
		GROUP BY x.chain_transfer_id, t.block_number, t.log_index HAVING sum(e.amount) < 0
		ORDER BY t.block_number, t.log_index`, option, closesAt)
	if err != nil {
		return nil, fmt.Errorf("read invoice %s held parts: %w", option, err)
	}
	type part struct {
		Transfer int64
		Amount   string
	}
	parts, err := pgx.CollectRows(rows, pgx.RowToStructByPos[part])
	if err != nil {
		return nil, fmt.Errorf("read invoice %s held parts: %w", option, err)
	}
	moved := new(big.Int)
	for _, p := range parts {
		move, _ := new(big.Int).SetString(p.Amount, 10)
		move = minInt(move, new(big.Int).Sub(left, moved))
		if move.Sign() <= 0 {
			break
		}
		if _, err := book(ctx, tx, option, "chosen", &p.Transfer, new(big.Int), move, new(big.Int).Neg(move)); err != nil {
			return nil, err
		}
		moved.Add(moved, move)
	}
	return moved, nil
}
