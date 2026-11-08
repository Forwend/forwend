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

// Returns of held money by hand (PLAN 11.10.3, D-118): support finds the case, this checks it against the ledger and
// the chain and locks the money, and the refund authority sends the calls it gives. Nothing here signs or holds a key.

var (
	refundSelector    = selector("refund(address,uint256)")
	transferSelector  = selector("transfer(address,uint256)")
	authoritySelector = selector("refundAuthority()")
)

const refundSignature = "refund(address,uint256)"

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
	ErrTooLittle      = errors.New("under 0.10 USD is not returned (D-90)")
	ErrUnbooked       = errors.New("money moved that the ledger hasn't booked yet: wait for a worker round, then try again")
)

// Payment is a final payment to an invoice option.
type Payment struct {
	TxHash, From string
	Amount       *big.Int
	BlockTime    int64
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

// CaseOptions finds the invoice options a support case points to: a pay link or its token, a receive address, a
// payment's transaction hash, or an invoice id from the owner's dashboard.
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
	var recipient, factory string
	var amount [3]string
	var expires, deadline int64
	err := db.QueryRow(ctx, `SELECT i.chain_id, i.receive_address, i.token_contract, coalesce(t.symbol, ''),
		coalesce(t.decimals, 0), i.payment_status, i.refund_status, i.recipient_address, i.amount::text,
		i.network_fee::text, i.platform_fee::text, i.expires_at, i.settle_deadline, i.factory_address
		FROM invoices i LEFT JOIN tokens t ON t.chain_id = i.chain_id AND t.contract = i.token_contract WHERE i.id = $1`,
		invoiceID).Scan(&h.ChainID, &h.Receive, &h.Token, &h.Symbol, &h.Decimals, &h.PaymentStatus, &h.RefundStatus,
		&recipient, &amount[0], &amount[1], &amount[2], &expires, &deadline, &factory)
	if err != nil {
		return Held{}, fmt.Errorf("read invoice %s: %w", invoiceID, err)
	}
	known, ok := address.KnownFactory(factory)
	if !ok {
		return Held{}, fmt.Errorf("invoice %s: its factory is not a Forwend factory", invoiceID)
	}
	h.factory = common.Address(known)
	if h.terms, err = termsOf(known, invoiceID, recipient, h.Token, amount, expires, deadline, h.ChainID, h.Receive); err != nil {
		return Held{}, err
	}
	amounts, err := ledger.ReadAmounts(ctx, db, invoiceID)
	if err != nil {
		return Held{}, fmt.Errorf("read invoice %s amounts: %w", invoiceID, err)
	}
	h.Held, h.Booked = amounts.Held, amounts.Receiver
	rows, err := db.Query(ctx, `SELECT tx_hash, from_address, amount::text, block_time FROM chain_transfers
		WHERE invoice_id = $1 AND status = 'confirmed' AND booked ORDER BY block_number, log_index`, invoiceID)
	if err != nil {
		return Held{}, fmt.Errorf("read invoice %s payments: %w", invoiceID, err)
	}
	h.Payments, err = pgx.CollectRows(rows, func(row pgx.CollectableRow) (Payment, error) {
		var p Payment
		var amount string
		err := row.Scan(&p.TxHash, &p.From, &amount, &p.BlockTime)
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
	out, err := client.CallContract(ctx, ethereum.CallMsg{To: &h.factory, Data: authoritySelector}, nil)
	if err != nil {
		return Held{}, fmt.Errorf("factory.refundAuthority: %w", err)
	}
	if len(out) != 32 {
		return Held{}, fmt.Errorf("factory.refundAuthority: %d-byte answer", len(out))
	}
	h.Authority = common.BytesToAddress(out)
	return h, nil
}

// termsOf builds an option's terms and checks they compute its stored receive address: money moves only by those.
func termsOf(factory [20]byte, invoiceID, recipient, token string, amount [3]string, expires, deadline int64, chainID uint64,
	receive string) (address.Terms, error) {
	var value [3]*big.Int // amount, network fee, platform fee
	for i, a := range amount {
		value[i], _ = new(big.Int).SetString(a, 10)
	}
	t := address.Terms{InvoiceID: [32]byte(common.FromHex(invoiceID)), Recipient: common.HexToAddress(recipient),
		Token: common.HexToAddress(token), Amount: value[0], ExpiresAt: uint64(expires), SettleDeadline: uint64(deadline),
		IntendedChainID: chainID, NetworkFee: value[1], PlatformFee: value[2]}
	if at, err := address.ReceiveAt(factory, t); err != nil || !strings.EqualFold(common.Address(at).Hex(), receive) {
		return address.Terms{}, fmt.Errorf("invoice %s: its terms do not compute its receive address", invoiceID)
	}
	return t, nil
}

// QueueReturn checks a return of held money against the ledger and the chain, locks the money and gives the calls
// for the refund authority. The destination defaults to the address that made the payment (D-118); the amount, to
// everything held and refundable when one address made every payment.
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
	var paid *Payment
	senders := map[string]bool{}
	for i, p := range h.Payments {
		senders[p.From] = true
		if strings.EqualFold(p.TxHash, txHash) {
			paid = &h.Payments[i]
		}
	}
	if paid == nil {
		return Return{}, ErrUnknownPayment
	}
	r := Return{To: common.HexToAddress(paid.From)}
	if to != nil {
		r.To = *to
	}
	receive, token := common.HexToAddress(h.Receive), common.HexToAddress(h.Token)
	if r.To == (common.Address{}) || r.To == receive || r.To == token || address.Ours(r.To) {
		return Return{}, ErrDestination
	}
	var invoiceAddress bool
	if err := db.QueryRow(ctx, "SELECT EXISTS (SELECT 1 FROM invoices WHERE receive_address = $1)",
		strings.ToLower(r.To.Hex())).Scan(&invoiceAddress); err != nil {
		return Return{}, fmt.Errorf("check the destination: %w", err)
	}
	if invoiceAddress {
		return Return{}, ErrDestination // another invoice's receiver: the money would be held there, not returned
	}
	limit := minInt(h.Held, h.Refundable)
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
		r.Amount = limit
	}
	// 0.10 USD: every token Forwend takes is a stablecoin worth 1 USD (D-75).
	least := new(big.Int).Exp(big.NewInt(10), big.NewInt(int64(h.Decimals)), nil)
	if r.Amount.Cmp(least.Div(least, big.NewInt(10))) < 0 {
		return Return{}, ErrTooLittle
	}
	if r.Amount.Cmp(limit) > 0 {
		return Return{}, ErrTooMuch
	}
	if !senders[strings.ToLower(r.To.Hex())] {
		r.Warnings = append(r.Warnings, "No payment came from this address: check the payer's proof that it is theirs.")
	}
	code, err := client.CodeAt(ctx, r.To, nil)
	if err != nil {
		return Return{}, fmt.Errorf("read the destination: %w", err)
	}
	if len(code) > 0 {
		r.Warnings = append(r.Warnings, "The destination is a contract (an exchange, an app or a smart wallet): check it can receive this token.")
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
		deploy, err := address.Call([20]byte(h.factory), "deploy", h.terms)
		if err != nil {
			return Return{}, err
		}
		signature, _ := address.Signature([20]byte(h.factory), "deploy")
		args, _ := address.Args([20]byte(h.factory), invoiceID, h.terms)
		r.Calls = append(r.Calls, Call{To: h.factory, Data: deploy, Signature: signature, Args: []string{args}})
	}
	r.Calls = append(r.Calls, Call{To: receive, Data: refund, Signature: refundSignature,
		Args: []string{strings.ToLower(r.To.Hex()), r.Amount.String()}})
	// The lock: until the refund lands, nothing settles this money to the creator and the owner can't reopen it.
	// Another return may have been booked since the reads above: the amount must still be held once the row is ours.
	err = setRefundStatus(ctx, db, invoiceID, "held", "refund_pending", history.ReturnQueued,
		history.Data{Amount: r.Amount.String(), To: strings.ToLower(r.To.Hex())}, func(tx pgx.Tx) error {
			now, err := ledger.ReadAmounts(ctx, tx, invoiceID)
			if err != nil {
				return fmt.Errorf("read invoice %s amounts: %w", invoiceID, err)
			}
			if r.Amount.Cmp(now.Held) > 0 {
				return ErrTooMuch
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

// checkBooked is ErrUnbooked while a payment or a receiver outflow of the invoice waits for the ledger.
func checkBooked(ctx context.Context, db interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}, invoiceID string) error {
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

// setRefundStatus moves the status from one value to another, with its history row in the same transaction. check,
// when given, runs holding the row, which the ledger also locks to book.
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

func minInt(a, b *big.Int) *big.Int {
	if a.Cmp(b) < 0 {
		return new(big.Int).Set(a)
	}
	return new(big.Int).Set(b)
}
