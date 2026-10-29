package invoice

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/forwend/forwend/apps/backend/internal/finality"
	"github.com/forwend/forwend/apps/backend/internal/ledger"
	"github.com/forwend/forwend/apps/backend/internal/webhook"
	"github.com/jackc/pgx/v5"
)

const PaymentDetailDeposits = 100

type PaymentOption struct {
	Option
	State             *ledger.ReceiverState
	Settlement        *PaymentSettlement
	DepositsTruncated bool
}

type PaymentSettlement struct {
	Status, Wait  string
	Attempts      int64
	NextAttemptAt time.Time
	CreatedAt     time.Time
	SignedAt      *time.Time
	TxHash        string
	ReceiptTxHash *string
	ReceiptBlock  *uint64
	ReceiptTime   *uint64
	Progress      *finality.Progress
}

type PaymentDelivery = webhook.PaymentDelivery

type PaymentDetails struct {
	DeliveryCount int64
	Invoice       Invoice
	SnapshotAt    time.Time
	Options       []PaymentOption
	Deliveries    []PaymentDelivery
	Problems      []PaymentProblem
}

func (s *Service) PaymentDetails(ctx context.Context, profileID, id string, q PaymentQuery) (PaymentDetails, error) {
	id = strings.ToLower(id)
	if len(id) != 66 || !strings.HasPrefix(id, "0x") || strings.Trim(id[2:], "0123456789abcdef") != "" {
		return PaymentDetails{}, ErrPaymentNotFound
	}
	q.Limit, q.Cursor = 1, ""
	args, where, err := paymentWhere(profileID, q)
	if err != nil {
		return PaymentDetails{}, err
	}
	args = append(args, id)
	where += fmt.Sprintf(" AND id = $%d", len(args))
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return PaymentDetails{}, err
	}
	defer tx.Rollback(ctx)
	result := PaymentDetails{}
	result.Invoice, err = scanInvoice(tx.QueryRow(ctx, "SELECT "+invoiceColumns+" FROM "+invoicesCurrent+" WHERE "+where+" LIMIT $2", args...))
	if errors.Is(err, ErrNotFound) {
		return PaymentDetails{}, ErrPaymentNotFound
	}
	if err != nil {
		return PaymentDetails{}, err
	}
	if err := tx.QueryRow(ctx, "SELECT transaction_timestamp()").Scan(&result.SnapshotAt); err != nil {
		return PaymentDetails{}, err
	}
	optionGroups, err := readOperationOptions(ctx, tx, []Invoice{result.Invoice}, q.Summary)
	if err != nil {
		return PaymentDetails{}, err
	}
	result.Options = optionGroups[id]
	for i := range result.Options {
		option := &result.Options[i]
		head := finality.Block{}
		if err := tx.QueryRow(ctx, "SELECT last_finalized_block,last_finalized_time FROM chain_cursors WHERE chain_id = $1", option.ChainID).Scan(&head.Number, &head.Time); err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return PaymentDetails{}, err
		}
		if settlement := option.Settlement; settlement != nil && settlement.ReceiptBlock != nil && head.Number != 0 {
			progress := finality.ProgressOf(finality.Block{Number: *settlement.ReceiptBlock, Time: *settlement.ReceiptTime}, head)
			settlement.Progress = &progress
		}
		if option.Deposits, err = readDeposits(ctx, tx, option.ID, head, PaymentDetailDeposits); err != nil {
			return PaymentDetails{}, err
		}
		option.DepositsTruncated = option.State.TotalDeposits > int64(len(option.Deposits))
		if option.ID == result.Invoice.OptionID {
			result.Invoice.Amounts = option.Amounts
		}
		result.Problems = append(result.Problems, optionProblems(result.Invoice, *option, result.SnapshotAt)...)
	}
	receipts, err := readPaymentReceipts(ctx, tx, []string{id})
	if err != nil {
		return PaymentDetails{}, err
	}
	result.Invoice.Receipts = receipts[id]
	if result.Invoice.Lines, err = s.lines(ctx, id); err != nil {
		return PaymentDetails{}, err
	}

	result.Deliveries, err = webhook.PaymentDeliveries(ctx, tx, id)
	if err != nil {
		return PaymentDetails{}, err
	}
	for _, delivery := range result.Deliveries {
		result.DeliveryCount = delivery.Total
		if delivery.Status == "failed" || !delivery.Enabled && delivery.Status == "pending" {
			result.Problems = append(result.Problems, PaymentProblem{Code: ProblemWebhookDelivery, Action: ActionReviewWebhooks, EndpointID: delivery.EndpointID, EventID: delivery.EventID})
		}
	}
	return result, tx.Commit(ctx)
}

func readPaymentSettlements(ctx context.Context, db paymentReader, ids []string) (map[string]*PaymentSettlement, error) {
	rows, err := db.Query(ctx, `SELECT invoice_id,status,coalesce(wait,''),attempts,next_attempt_at,created_at,signed_at,coalesce(tx_hash,''),receipt_tx_hash,receipt_block,receipt_time
 FROM settlement_intents WHERE invoice_id = ANY($1::text[])`, ids)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := make(map[string]*PaymentSettlement)
	for rows.Next() {
		var id string
		settlement := &PaymentSettlement{}
		if err := rows.Scan(&id, &settlement.Status, &settlement.Wait, &settlement.Attempts, &settlement.NextAttemptAt, &settlement.CreatedAt, &settlement.SignedAt, &settlement.TxHash, &settlement.ReceiptTxHash, &settlement.ReceiptBlock, &settlement.ReceiptTime); err != nil {
			return nil, err
		}
		result[id] = settlement
	}
	return result, rows.Err()
}

func readOperationOptions(ctx context.Context, db paymentReader, invoices []Invoice, activeOnly bool) (map[string][]PaymentOption, error) {
	mains := make([]string, len(invoices))
	for i := range invoices {
		mains[i] = invoices[i].ID
	}
	grouped, err := readPaymentOptionsFor(ctx, db, mains, activeOnly)
	if err != nil {
		return nil, err
	}
	var ids []string
	for _, options := range grouped {
		for _, option := range options {
			ids = append(ids, option.ID)
		}
	}
	amounts, err := ledger.ReadAmountsFor(ctx, db, ids)
	if err != nil {
		return nil, err
	}
	states, err := ledger.ReadReceiverStates(ctx, db, ids, amounts)
	if err != nil {
		return nil, err
	}
	settlements, err := readPaymentSettlements(ctx, db, ids)
	if err != nil {
		return nil, err
	}
	result := make(map[string][]PaymentOption, len(invoices))
	for main, options := range grouped {
		for _, option := range options {
			option.Amounts = amounts[option.ID]
			result[main] = append(result[main], PaymentOption{Option: option, State: states[option.ID], Settlement: settlements[option.ID]})
		}
	}
	return result, nil
}
