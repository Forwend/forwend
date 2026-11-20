package settlement

import (
	"context"
	"errors"
	"fmt"
	"math/big"
	"regexp"
	"strings"
	"time"

	"github.com/ethereum/go-ethereum"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/ethclient"
	"github.com/forwend/forwend/apps/backend/internal/address"
	"github.com/forwend/forwend/apps/backend/internal/history"
	"github.com/forwend/forwend/apps/backend/internal/ledger"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Returns of held money by hand: support finds the case, this checks it and locks the money; nothing here signs.

const refundSignature = "refund(address,uint256)"

var (
	refundSelector   = selector(refundSignature)
	transferSelector = selector("transfer(address,uint256)")
)

var (
	ErrNoCase         = errors.New("no invoice has that pay link, address or transaction")
	ErrNothingHeld    = errors.New("nothing is held for the payer")
	ErrReturnQueued   = errors.New("a return is already queued: send it, or release it first")
	ErrNoReturnQueued = errors.New("no return is queued")
	ErrNotYet         = errors.New("the contract returns nothing yet")
	ErrUnknownPayment = errors.New("that transaction is not a final payment to this invoice")
	ErrDestination    = errors.New("money can't be returned to that address")
	ErrAmountNeeded   = errors.New("several addresses paid: give the amount for this one")
	ErrTooMuch        = errors.New("more than is both held and refundable")
	ErrMoreThanPaid   = errors.New("more than this payer paid, less what was returned to them")
	ErrTooLittle      = errors.New("under 0.10 USD is not returned (D-90)")
	ErrUnbooked       = errors.New("money moved that the ledger hasn't booked yet: wait for a worker round, then try again")
	ErrCrossChain     = errors.New("NEAR Intents sent that payment from its own address: give -to, an address on this chain the payer proves is theirs")
	ErrMissedDeposit  = errors.New("the receiver holds more than the ledger booked: wait for a worker round; if it stays, record the missed deposit with ops deposit")
)

// Payment is a final payment to an option; with Quote or Relayed set, From is NEAR Intents, not the payer.
type Payment struct {
	TxHash, From                           string
	Amount                                 *big.Int
	BlockTime                              int64
	Quote, OriginChain, OriginTx, RefundTo string
	Relayed                                bool
}

// Held is one invoice option's money held for the payer, as the ledger and the chain see it now.
type Held struct {
	InvoiceID, Receive, Token, Symbol, PaymentStatus, RefundStatus string
	ChainID                                                        uint64
	Decimals                                                       int
	Held, Booked                                                   *big.Int // the ledger's held and receiver balances
	Reasons                                                        []string
	Payments                                                       []Payment
	Deployed, Settled                                              bool
	Balance, Refundable                                            *big.Int // the receiver's, on chain
	Deadline                                                       time.Time
	Authority                                                      common.Address
	terms                                                          address.Terms
	factory                                                        common.Address // the invoice's own
}

// Call is one transaction for the refund authority. Signature and Args give it to `cast send`.
type Call struct {
	To        common.Address
	Data      []byte
	Signature string
	Args      []string
}

// Return is a queued return: the money stays locked until its refund lands or it is released.
type Return struct {
	To       common.Address
	Amount   *big.Int
	Calls    []Call
	Warnings []string
}

var (
	payTokenIn = regexp.MustCompile(`(?:^|/(?:pay|embed)/)([0-9a-f]{64})(?:[/?#]|$)`)
	addressRef = regexp.MustCompile(`^0x[0-9a-f]{40}$`)
	hashRef    = regexp.MustCompile(`^0x[0-9a-f]{64}$`)
)

// CaseOption is an invoice option a support case is about, and the chain its money is on.
type CaseOption struct {
	ID      string
	ChainID uint64
}

// CaseOptions finds the options a case points to: a pay link or token, receive address, payment hash or invoice id.
func CaseOptions(ctx context.Context, db *pgxpool.Pool, ref string) ([]CaseOption, error) {
	ref = strings.ToLower(strings.TrimSpace(ref))
	var query string
	switch {
	case addressRef.MatchString(ref):
		query = "SELECT id, chain_id FROM invoices WHERE receive_address = $1 ORDER BY id"
	case hashRef.MatchString(ref):
		query = `SELECT i.id, i.chain_id FROM chain_transfers t JOIN invoices i ON i.id = t.invoice_id WHERE t.tx_hash = $1
			UNION SELECT o.id, o.chain_id FROM invoices o
			WHERE coalesce(o.main_id, o.id) = (SELECT coalesce(main_id, id) FROM invoices WHERE id = $1)
			ORDER BY 1`
	default:
		m := payTokenIn.FindStringSubmatch(ref)
		if m == nil {
			return nil, ErrNoCase
		}
		ref = m[1]
		query = `SELECT o.id, o.chain_id FROM invoices m JOIN invoices o ON o.id = m.id OR o.main_id = m.id
			WHERE m.pay_token = $1 ORDER BY o.main_id IS NOT NULL, o.id`
	}
	rows, err := db.Query(ctx, query, ref)
	if err != nil {
		return nil, fmt.Errorf("find the case: %w", err)
	}
	options, err := pgx.CollectRows(rows, pgx.RowToStructByPos[CaseOption])
	if err != nil {
		return nil, fmt.Errorf("find the case: %w", err)
	}
	if len(options) == 0 {
		return nil, ErrNoCase
	}
	return options, nil
}

// ReadHeld reads an option's held money from the ledger and its receiver from the chain.
func ReadHeld(ctx context.Context, db *pgxpool.Pool, client *ethclient.Client, invoiceID string) (Held, error) {
	h := Held{InvoiceID: invoiceID}
	err := db.QueryRow(ctx, `SELECT i.chain_id, i.receive_address, i.token_contract, coalesce(t.symbol, ''),
		coalesce(t.decimals, 0), i.payment_status, i.refund_status
		FROM invoices i LEFT JOIN tokens t ON t.chain_id = i.chain_id AND t.contract = i.token_contract WHERE i.id = $1`,
		invoiceID).Scan(&h.ChainID, &h.Receive, &h.Token, &h.Symbol, &h.Decimals, &h.PaymentStatus, &h.RefundStatus)
	if err != nil {
		return Held{}, fmt.Errorf("read invoice %s: %w", invoiceID, err)
	}
	factory, terms, err := readTerms(ctx, db, invoiceID)
	if err != nil {
		return Held{}, err
	}
	h.factory, h.terms = common.Address(factory), terms
	amounts, err := ledger.ReadAmounts(ctx, db, invoiceID)
	if err != nil {
		return Held{}, fmt.Errorf("read invoice %s amounts: %w", invoiceID, err)
	}
	h.Held, h.Booked = amounts.Held, amounts.Receiver
	rows, err := db.Query(ctx, `SELECT t.tx_hash, t.from_address, t.amount::text, t.block_time, coalesce(q.id::text, ''),
		    coalesce(q.origin_blockchain, ''), coalesce(q.origin_txs->0->>'hash', ''), coalesce(q.refund_to, ''),
		    EXISTS (SELECT 1 FROM chain_transfers d JOIN crosschain_quotes dq ON dq.option_id = d.invoice_id
		        WHERE d.chain_id = t.chain_id AND d.from_address = t.from_address AND EXISTS (SELECT 1
		        FROM jsonb_array_elements(dq.destination_txs) x WHERE lower(x->>'hash') = d.tx_hash))
		    OR EXISTS (SELECT 1 FROM crosschain_quotes pq WHERE pq.option_id = t.invoice_id
		        AND pq.deposit_seen_at IS NOT NULL AND pq.destination_txs = '[]'
		        AND pq.status NOT IN ('FAILED', 'REFUNDED'))
		FROM chain_transfers t LEFT JOIN LATERAL (SELECT * FROM crosschain_quotes q WHERE q.option_id = t.invoice_id
		    AND EXISTS (SELECT 1 FROM jsonb_array_elements(q.destination_txs) d WHERE lower(d->>'hash') = t.tx_hash)
		    LIMIT 1) q ON true
		WHERE t.invoice_id = $1 AND t.status = 'confirmed' AND t.booked ORDER BY t.block_number, t.log_index`, invoiceID)
	if err != nil {
		return Held{}, fmt.Errorf("read invoice %s payments: %w", invoiceID, err)
	}
	h.Payments, err = pgx.CollectRows(rows, func(row pgx.CollectableRow) (Payment, error) {
		var p Payment
		var amount string
		err := row.Scan(&p.TxHash, &p.From, &amount, &p.BlockTime, &p.Quote, &p.OriginChain, &p.OriginTx, &p.RefundTo, &p.Relayed)
		p.Amount, _ = new(big.Int).SetString(amount, 10)
		return p, err
	})
	if err != nil {
		return Held{}, fmt.Errorf("read invoice %s payments: %w", invoiceID, err)
	}
	rows, err = db.Query(ctx, `SELECT data->>'reason' FROM history_events WHERE invoice_id = $1 AND kind = $2
		GROUP BY 1 ORDER BY min(id)`, invoiceID, history.Held)
	if err != nil {
		return Held{}, fmt.Errorf("read invoice %s held reasons: %w", invoiceID, err)
	}
	if h.Reasons, err = pgx.CollectRows(rows, pgx.RowTo[string]); err != nil {
		return Held{}, fmt.Errorf("read invoice %s held reasons: %w", invoiceID, err)
	}
	status, err := factoryStatus(ctx, client, h.factory, h.terms)
	if err != nil {
		return Held{}, err
	}
	h.Deployed, h.Settled, h.Balance, h.Refundable = status.Deployed, status.Settled, status.Balance, status.Refundable
	h.Deadline = time.Unix(int64(status.Deadline), 0).UTC()
	if h.Authority, err = refundAuthority(ctx, client, h.factory); err != nil {
		return Held{}, err
	}
	return h, nil
}

// QueueReturn checks a return, locks the money and gives the refund authority's calls; to defaults to the payer.
func QueueReturn(ctx context.Context, db *pgxpool.Pool, client *ethclient.Client, invoiceID, txHash string,
	to *common.Address, amount *big.Int) (Return, error) {
	h, err := ReadHeld(ctx, db, client, invoiceID)
	if err != nil {
		return Return{}, err
	}
	switch {
	case h.RefundStatus == "refund_pending":
		return Return{}, ErrReturnQueued
	case h.Held.Sign() <= 0:
		return Return{}, ErrNothingHeld
	// Money left the receiver and the ledger hasn't booked it. Past the deadline of an invoice never settled the
	// contract lets the whole balance out, so a second return would take the creator's money.
	case h.Balance.Cmp(h.Booked) < 0:
		return Return{}, ErrUnbooked
	}
	// A payment not booked yet could hide such a gap, and its money is another payer's.
	if err := checkBooked(ctx, db, invoiceID); err != nil {
		return Return{}, err
	}
	// More on chain than every recorded payment: a deposit the scan missed. Until it is booked, the ledger would book
	// this refund against the wrong payer's money.
	if new(big.Int).Sub(h.Balance, h.Booked).Cmp(ledger.DustExcess(h.Decimals)) >= 0 {
		return Return{}, ErrMissedDeposit
	}
	var paid *Payment
	senders, relays := map[string]bool{}, map[string]bool{}
	for i, p := range h.Payments {
		senders[payer(p)] = true
		if p.Quote != "" || p.Relayed {
			relays[p.From] = true
		}
		if strings.EqualFold(p.TxHash, txHash) {
			paid = &h.Payments[i]
		}
	}
	if paid == nil {
		return Return{}, ErrUnknownPayment
	}
	// A receive address is public: anyone can pay a little to it and ask for a return. Each payer gets back at most
	// what they paid, so a return never takes another payer's held money.
	var hashes []string
	paidBy, own := new(big.Int), ""
	for _, p := range h.Payments {
		if payer(p) == payer(*paid) {
			hashes = append(hashes, p.TxHash)
			paidBy.Add(paidBy, p.Amount)
		}
	}
	if paid.Quote == "" && !paid.Relayed {
		own = paid.From
	}
	left := func(db querier) (*big.Int, error) {
		returned, err := returnedTo(ctx, db, invoiceID, own, hashes)
		if err != nil {
			return nil, err
		}
		return returned.Sub(paidBy, returned), nil
	}
	payerLeft, err := left(db)
	if err != nil {
		return Return{}, err
	}
	r := Return{To: common.HexToAddress(paid.From)}
	switch {
	case to != nil:
		r.To = *to
	case paid.Quote != "" || paid.Relayed:
		return Return{}, ErrCrossChain
	}
	receive, token := common.HexToAddress(h.Receive), common.HexToAddress(h.Token)
	if relays[strings.ToLower(r.To.Hex())] {
		return Return{}, ErrDestination
	}
	if err := refuseDestination(ctx, db, r.To, receive, token); err != nil {
		return Return{}, err
	}
	limit := minBig(h.Held, h.Refundable)
	if limit.Sign() <= 0 {
		if h.Settled || !time.Now().Before(h.Deadline) {
			return Return{}, ErrNotYet
		}
		return Return{}, fmt.Errorf("%w: all of it becomes refundable after %s", ErrNotYet, h.Deadline.Format(time.RFC3339))
	}
	r.Amount = amount
	if r.Amount == nil {
		if len(senders) > 1 {
			return Return{}, ErrAmountNeeded
		}
		r.Amount = minBig(limit, payerLeft)
	}
	// 0.10 USD: every token Forwend takes is a stablecoin worth 1 USD.
	least := new(big.Int).Exp(big.NewInt(10), big.NewInt(int64(h.Decimals)), nil)
	if r.Amount.Cmp(least.Div(least, big.NewInt(10))) < 0 {
		return Return{}, ErrTooLittle
	}
	if r.Amount.Cmp(limit) > 0 {
		return Return{}, ErrTooMuch
	}
	if r.Amount.Cmp(payerLeft) > 0 {
		return Return{}, ErrMoreThanPaid
	}
	switch {
	case paid.Quote != "":
		r.Warnings = append(r.Warnings, fmt.Sprintf("The payer paid through NEAR Intents on %s (transaction %s): check "+
			"their proof that this address is theirs.", paid.OriginChain, paid.OriginTx))
	case paid.Relayed:
		r.Warnings = append(r.Warnings, "NEAR Intents delivered this payment and no quote names it yet: find the payer's "+
			"quote and check their proof that this address is theirs.")
	case !senders[strings.ToLower(r.To.Hex())]:
		r.Warnings = append(r.Warnings, "No payment came from this address: check the payer's proof that it is theirs.")
	}
	if r.Warnings, err = contractWarning(ctx, client, r.To, r.Warnings); err != nil {
		return Return{}, err
	}
	// A dry run as the chain would see it: a blocklisted address, a paused token or a short balance fails here,
	// before the Safe's owners sign.
	args := common.LeftPadBytes(r.To.Bytes(), 32)
	args = append(args, common.LeftPadBytes(r.Amount.Bytes(), 32)...)
	transfer := append(append([]byte{}, transferSelector...), args...)
	if _, err := client.CallContract(ctx, ethereum.CallMsg{From: receive, To: &token, Data: transfer}, nil); err != nil {
		return Return{}, fmt.Errorf("the token refuses this transfer: %w", err)
	}
	refund := append(append([]byte{}, refundSelector...), args...)
	if h.Deployed {
		if _, err := client.CallContract(ctx, ethereum.CallMsg{From: h.Authority, To: &receive, Data: refund}, nil); err != nil {
			return Return{}, fmt.Errorf("the receiver refuses this refund: %w", err)
		}
	} else {
		deploy, err := deployCall(h.factory, invoiceID, h.terms)
		if err != nil {
			return Return{}, err
		}
		r.Calls = append(r.Calls, deploy)
	}
	r.Calls = append(r.Calls, Call{To: receive, Data: refund, Signature: refundSignature,
		Args: []string{strings.ToLower(r.To.Hex()), r.Amount.String()}})
	// The lock: until the refund lands, nothing settles this money to the creator and the owner can't reopen it.
	// Another return may have been booked since the reads above: the amount must still be held once the row is ours.
	err = setRefundStatus(ctx, db, invoiceID, "held", "refund_pending", history.ReturnQueued,
		history.Data{Amount: r.Amount.String(), To: strings.ToLower(r.To.Hex()), TxHash: paid.TxHash}, func(tx pgx.Tx) error {
			now, err := ledger.ReadAmounts(ctx, tx, invoiceID)
			if err != nil {
				return fmt.Errorf("read invoice %s amounts: %w", invoiceID, err)
			}
			if r.Amount.Cmp(now.Held) > 0 {
				return ErrTooMuch
			}
			payerLeft, err := left(tx)
			if err != nil {
				return err
			}
			if r.Amount.Cmp(payerLeft) > 0 {
				return ErrMoreThanPaid
			}
			return checkBooked(ctx, tx, invoiceID)
		})
	if errors.Is(err, errUnchanged) {
		return Return{}, ErrReturnQueued
	}
	if err != nil {
		return Return{}, err
	}
	return r, nil
}

// ReleaseReturn unlocks a queued return the refund authority will not send.
func ReleaseReturn(ctx context.Context, db *pgxpool.Pool, invoiceID string) error {
	err := setRefundStatus(ctx, db, invoiceID, "refund_pending", "held", history.ReturnReleased, history.Data{}, nil)
	if errors.Is(err, errUnchanged) {
		return ErrNoReturnQueued
	}
	return err
}

// payer names who made a payment; NEAR Intents sends all cross-chain payments from one address, so each quote is one.
func payer(p Payment) string {
	switch {
	case p.Quote != "":
		return "quote " + p.Quote
	case p.Relayed:
		return "payment " + p.TxHash
	}
	return p.From
}

type querier interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}

// returnedTo sums an option's booked refunds to a payer: to own, or where support queued a return of their payment.
func returnedTo(ctx context.Context, db querier, invoiceID, own string, hashes []string) (*big.Int, error) {
	var sum string
	if err := db.QueryRow(ctx, `SELECT coalesce(sum(o.amount), 0)::text FROM receiver_outflows o
		WHERE o.invoice_id = $1 AND o.kind = 'refund' AND o.ledger_transaction_id IS NOT NULL AND (o.destination = $2
		    OR o.destination IN (SELECT e.data->>'to' FROM history_events e
		        WHERE e.invoice_id = (SELECT coalesce(main_id, id) FROM invoices WHERE id = $1) AND e.kind = $3
		        AND e.data->>'txHash' = ANY($4)))`, invoiceID, own, history.ReturnQueued, hashes).Scan(&sum); err != nil {
		return nil, fmt.Errorf("read invoice %s returns to the payer: %w", invoiceID, err)
	}
	returned, _ := new(big.Int).SetString(sum, 10)
	return returned, nil
}

// checkBooked is ErrUnbooked while a payment or a receiver outflow of the invoice waits for the ledger.
func checkBooked(ctx context.Context, db querier, invoiceID string) error {
	var unbooked bool
	if err := db.QueryRow(ctx, `SELECT
		EXISTS (SELECT 1 FROM chain_transfers WHERE invoice_id = $1 AND status <> 'reorged' AND NOT booked) OR
		EXISTS (SELECT 1 FROM receiver_outflows WHERE invoice_id = $1 AND kind <> 'recovery' AND ledger_transaction_id IS NULL)`,
		invoiceID).Scan(&unbooked); err != nil {
		return fmt.Errorf("read invoice %s unbooked movements: %w", invoiceID, err)
	}
	if unbooked {
		return ErrUnbooked
	}
	return nil
}

var errUnchanged = errors.New("refund status changed meanwhile")

// setRefundStatus moves the status with its history row; check, if given, runs holding the row the ledger locks.
func setRefundStatus(ctx context.Context, db *pgxpool.Pool, invoiceID, from, to, kind string, data history.Data,
	check func(pgx.Tx) error) error {
	return pgx.BeginFunc(ctx, db, func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, "UPDATE invoices SET refund_status = $3 WHERE id = $1 AND refund_status = $2",
			invoiceID, from, to)
		if err != nil {
			return fmt.Errorf("invoice %s refund status: %w", invoiceID, err)
		}
		if tag.RowsAffected() == 0 {
			return errUnchanged
		}
		if check != nil {
			if err := check(tx); err != nil {
				return err
			}
		}
		return history.Add(ctx, tx, invoiceID, kind, history.System, data)
	})
}

// refuseDestination refuses zero, the receiver, the token, our contracts or another receiver (held there again).
func refuseDestination(ctx context.Context, db *pgxpool.Pool, to, receiver, token common.Address) error {
	if to == (common.Address{}) || to == receiver || to == token || address.Ours(to) {
		return ErrDestination
	}
	var invoiceAddress bool
	if err := db.QueryRow(ctx, "SELECT EXISTS (SELECT 1 FROM invoices WHERE receive_address = $1)",
		strings.ToLower(to.Hex())).Scan(&invoiceAddress); err != nil {
		return fmt.Errorf("check the destination: %w", err)
	}
	if invoiceAddress {
		return ErrDestination
	}
	return nil
}

func contractWarning(ctx context.Context, client *ethclient.Client, to common.Address, warnings []string) ([]string, error) {
	code, err := client.CodeAt(ctx, to, nil)
	if err != nil {
		return nil, fmt.Errorf("read the destination: %w", err)
	}
	if len(code) > 0 {
		warnings = append(warnings, "The destination is a contract (an exchange, an app or a smart wallet): check it can receive this token.")
	}
	return warnings, nil
}
