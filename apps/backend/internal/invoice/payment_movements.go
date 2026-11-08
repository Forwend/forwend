package invoice

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"math/big"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

const MaxPaymentExportRows = 10000

var ErrTooManyMovements = errors.New("too many payment movements in the period")

type MovementQuery struct {
	PaymentQuery
	PaymentID, After string
	From, To         time.Time
}

type PaymentMovement struct {
	Livemode                                                           bool
	Network                                                            string
	ID, State                                                          string
	RecordedAt                                                         time.Time
	PaymentID, OptionID, StoreID, StoreName                            string
	Source                                                             PaymentSource
	DocumentKind                                                       DocumentKind
	Number                                                             *int64
	Reference, Title                                                   string
	ChainID                                                            uint64
	Token, Symbol                                                      string
	Decimals                                                           *int
	Kind                                                               string
	SourceAmount, BookedAmount, ReceiverDelta, PayableDelta, HeldDelta *big.Int
	TxHash, BlockHash                                                  string
	LogIndex, TransferLogIndex, BlockNumber, VerifiedBlock             *uint64
	VerifiedHash                                                       string
	BlockTime                                                          *time.Time
	From, To, Status                                                   string
	Verified                                                           bool
	PolicyException, ReconciliationError                               string
}

type MovementPage struct {
	SnapshotAt time.Time
	Items      []PaymentMovement
	NextCursor string
}

func paymentScope(profileID string, q MovementQuery) ([]any, string, error) {
	q.PaymentQuery.Cursor = ""
	args, where, err := paymentWhere(profileID, q.PaymentQuery)
	if err != nil {
		return nil, "", err
	}
	if q.PaymentID != "" {
		id := strings.ToLower(q.PaymentID)
		if len(id) != 66 || !strings.HasPrefix(id, "0x") || strings.Trim(id[2:], "0123456789abcdef") != "" {
			return nil, "", ErrPaymentNotFound
		}
		args = append(args, id)
		where += fmt.Sprintf(" AND id = $%d", len(args))
	}
	return args, `payment_scope AS (SELECT invoices.id,invoices.store_id,coalesce((SELECT name FROM stores s WHERE s.id = invoices.store_id),'') AS store_name,
   CASE WHEN invoices.link_id IS NOT NULL THEN 'payment_link' ELSE invoices.purpose END AS source,
   (SELECT livemode FROM chains WHERE chain_id = invoices.chain_id) AS livemode,invoices.document_kind,invoices.number,coalesce(invoices.reference,'') AS reference,coalesce(invoices.title,'') AS title
   FROM ` + invoicesCurrent + ` WHERE ` + where + `)`, nil
}

const paymentMovementIndex = `, movement_index AS (
 SELECT 'ledger:' || t.id::text AS id,t.id AS row_id,'ledger' AS source_type,t.created_at AS recorded_at
 FROM ledger_transactions t JOIN invoices i ON i.id = t.invoice_id JOIN payment_scope p ON p.id = coalesce(i.main_id,i.id)
 UNION ALL
 SELECT 'deposit:' || d.id::text,d.id,'deposit',d.created_at FROM chain_transfers d
 JOIN invoices i ON i.id = d.invoice_id JOIN payment_scope p ON p.id = coalesce(i.main_id,i.id)
 WHERE NOT d.booked AND d.status <> 'reorged'
 UNION ALL
 SELECT 'outflow:' || o.id::text,o.id,'outflow',o.created_at FROM receiver_outflows o
 JOIN invoices i ON i.id = o.invoice_id JOIN payment_scope p ON p.id = coalesce(i.main_id,i.id)
 WHERE o.ledger_transaction_id IS NULL
 )`

func selectedMovementsSQL(scope, where string) string {
	return "WITH " + scope + paymentMovementIndex + ", selected_movements AS (SELECT * FROM movement_index WHERE " + where + " ORDER BY recorded_at DESC,id DESC LIMIT $2)"
}

const paymentMovementRows = `, journal AS (
 SELECT t.id,t.invoice_id,t.kind,t.chain_transfer_id,t.created_at,
   coalesce(sum(e.amount) FILTER (WHERE e.account = 'receiver'),0) AS receiver,
   -coalesce(sum(e.amount) FILTER (WHERE e.account = 'recipient_payable'),0) AS payable,
   -coalesce(sum(e.amount) FILTER (WHERE e.account = 'payer_held'),0) AS held
 FROM ledger_transactions t JOIN selected_movements selection ON selection.source_type = 'ledger' AND selection.row_id = t.id
 JOIN ledger_entries e ON e.transaction_id = t.id JOIN invoices i ON i.id = t.invoice_id
 JOIN payment_scope p ON p.id = coalesce(i.main_id,i.id) GROUP BY t.id
 ), movements AS (
 SELECT 'ledger:' || j.id::text AS id,'booked' AS state,j.created_at AS recorded_at,p.id AS payment_id,i.id AS option_id,
   coalesce(p.store_id::text,'') AS store_id,p.store_name,p.source,p.livemode,p.document_kind,p.number,p.reference,p.title,
   i.chain_id,(SELECT name FROM chains WHERE chain_id = i.chain_id) AS network,i.token_contract AS token,tk.symbol,tk.decimals,j.kind,
   CASE WHEN j.kind IN ('deposit','refund','settlement','network_fee','platform_fee') THEN coalesce(d.amount,o.amount) END AS source_amount,
   abs(j.receiver) AS booked_amount,j.receiver,j.payable,j.held,
   coalesce(d.tx_hash,o.tx_hash,'') AS tx_hash,
   coalesce(d.log_index,o.log_index) AS log_index,coalesce(d.log_index,o.transfer_log_index) AS transfer_log_index,coalesce(d.block_hash,o.block_hash,'') AS block_hash,
   coalesce(d.block_number,o.block_number) AS block_number,coalesce(d.block_time,o.block_time) AS block_time,
   CASE WHEN j.kind = 'deposit' THEN d.from_address WHEN j.kind IN ('refund','settlement','network_fee','platform_fee') THEN coalesce(o.receiver_address,'') ELSE '' END AS from_address,
   CASE WHEN j.kind = 'deposit' THEN d.to_address WHEN j.kind IN ('refund','settlement','network_fee','platform_fee') THEN coalesce(o.destination,'') ELSE '' END AS to_address,
   CASE WHEN j.kind = 'deposit' OR o.id IS NOT NULL THEN 'confirmed' WHEN j.kind IN ('refund','settlement','network_fee','platform_fee') THEN 'unmatched' ELSE 'internal' END AS status,
   CASE WHEN j.kind = 'deposit' THEN d.id IS NOT NULL WHEN j.kind IN ('refund','settlement','network_fee','platform_fee') THEN o.id IS NOT NULL ELSE false END AS verified,
   coalesce(d.block_number,o.block_number) AS verified_block,coalesce(d.block_hash,o.block_hash,'') AS verified_hash,
   coalesce(o.policy_exception,'') AS policy_exception,
   CASE WHEN j.kind IN ('refund','settlement','network_fee','platform_fee') AND o.id IS NULL
      THEN 'source_evidence_missing' ELSE coalesce(o.reconciliation_error,'') END AS reconciliation_error
 FROM journal j JOIN invoices i ON i.id = j.invoice_id JOIN payment_scope p ON p.id = coalesce(i.main_id,i.id)
 JOIN tokens tk ON tk.chain_id = i.chain_id AND tk.contract = i.token_contract
 LEFT JOIN chain_transfers d ON d.id = j.chain_transfer_id AND j.kind = 'deposit'
 LEFT JOIN receiver_outflows o ON o.ledger_transaction_id = j.id
 UNION ALL
 SELECT 'deposit:' || d.id::text,'observed',d.created_at,p.id,i.id,coalesce(p.store_id::text,''),p.store_name,p.source,p.livemode,p.document_kind,
   p.number,p.reference,p.title,d.chain_id,(SELECT name FROM chains WHERE chain_id = d.chain_id),d.token_contract,tk.symbol,tk.decimals,'deposit',d.amount,NULL,NULL,NULL,NULL,
   d.tx_hash,d.log_index,d.log_index,d.block_hash,d.block_number,d.block_time,d.from_address,d.to_address,d.status,d.status = 'confirmed',
   CASE WHEN d.status = 'confirmed' THEN d.block_number END,CASE WHEN d.status = 'confirmed' THEN d.block_hash ELSE '' END,'',
   CASE WHEN d.status = 'confirmed' THEN 'awaiting_booking' ELSE 'awaiting_verification' END
 FROM chain_transfers d JOIN selected_movements selection ON selection.source_type = 'deposit' AND selection.row_id = d.id
 JOIN invoices i ON i.id = d.invoice_id JOIN payment_scope p ON p.id = coalesce(i.main_id,i.id)
 JOIN tokens tk ON tk.chain_id = d.chain_id AND tk.contract = d.token_contract
 UNION ALL
 SELECT 'outflow:' || o.id::text,'observed',o.created_at,p.id,i.id,coalesce(p.store_id::text,''),p.store_name,p.source,p.livemode,p.document_kind,
   p.number,p.reference,p.title,o.chain_id,(SELECT name FROM chains WHERE chain_id = o.chain_id),o.token_contract,coalesce(tk.symbol,''),tk.decimals,o.kind,o.amount,NULL,NULL,NULL,NULL,
   o.tx_hash,o.log_index,o.transfer_log_index,o.block_hash,o.block_number,o.block_time,o.receiver_address,o.destination,'confirmed',true,o.block_number,o.block_hash,
   coalesce(o.policy_exception,''),o.reconciliation_error
 FROM receiver_outflows o JOIN selected_movements selection ON selection.source_type = 'outflow' AND selection.row_id = o.id
 JOIN invoices i ON i.id = o.invoice_id JOIN payment_scope p ON p.id = coalesce(i.main_id,i.id)
 LEFT JOIN tokens tk ON tk.chain_id = o.chain_id AND tk.contract = o.token_contract
 )`

const movementColumns = `id,state,recorded_at,payment_id,option_id,store_id,store_name,source,livemode,document_kind,number,reference,title,
 chain_id,network,token,symbol,decimals,kind,source_amount::text,booked_amount::text,receiver::text,payable::text,held::text,
 tx_hash,log_index,transfer_log_index,block_hash,block_number,block_time,from_address,to_address,status,verified,verified_block,verified_hash,policy_exception,reconciliation_error`

func movementWhere(q MovementQuery, args []any) ([]any, string, error) {
	if !q.From.Before(q.To) {
		return nil, "", fmt.Errorf("%w: from must be before to", ErrInvalid)
	}
	args = append(args, q.From, q.To)
	where := fmt.Sprintf("recorded_at >= $%d AND recorded_at < $%d", len(args)-1, len(args))
	if q.After != "" {
		at, id, err := decodeMovementCursor(q.After)
		if err != nil {
			return nil, "", err
		}
		args = append(args, at, id)
		where += fmt.Sprintf(" AND (recorded_at,id) < ($%d,$%d)", len(args)-1, len(args))
	}
	return args, where, nil
}

func (s *Service) PaymentMovements(ctx context.Context, profileID string, q MovementQuery) (MovementPage, error) {
	args, scope, err := paymentScope(profileID, q)
	if err != nil {
		return MovementPage{}, err
	}
	scopeArgs := args
	args, where, err := movementWhere(q, args)
	if err != nil {
		return MovementPage{}, err
	}
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return MovementPage{}, err
	}
	defer tx.Rollback(ctx)
	if q.PaymentID != "" {
		var exists bool
		// The scope includes the same filters and access boundaries as the rows below.
		if err := tx.QueryRow(ctx, "WITH "+scope+" SELECT EXISTS (SELECT 1 FROM payment_scope) AND $2::int > 0", scopeArgs...).Scan(&exists); err != nil {
			return MovementPage{}, err
		}
		if !exists {
			return MovementPage{}, ErrPaymentNotFound
		}
	}
	result := MovementPage{Items: []PaymentMovement{}}
	if err := tx.QueryRow(ctx, "SELECT transaction_timestamp()").Scan(&result.SnapshotAt); err != nil {
		return MovementPage{}, err
	}
	rows, err := tx.Query(ctx, selectedMovementsSQL(scope, where)+paymentMovementRows+" SELECT "+movementColumns+" FROM movements ORDER BY recorded_at DESC,id DESC", args...)
	if err != nil {
		return MovementPage{}, err
	}
	result.Items, err = pgx.CollectRows(rows, scanPaymentMovement)
	if err != nil {
		return MovementPage{}, err
	}
	if len(result.Items) > q.Limit {
		result.Items = result.Items[:q.Limit]
		last := result.Items[q.Limit-1]
		result.NextCursor = base64.RawURLEncoding.EncodeToString([]byte(last.RecordedAt.UTC().Format(time.RFC3339Nano) + "|" + last.ID))
	}
	return result, tx.Commit(ctx)
}

func scanPaymentMovement(row pgx.CollectableRow) (PaymentMovement, error) {
	var movement PaymentMovement
	var source, booked, receiver, payable, held *string
	var blockTime *int64
	err := row.Scan(&movement.ID, &movement.State, &movement.RecordedAt, &movement.PaymentID, &movement.OptionID, &movement.StoreID, &movement.StoreName,
		&movement.Source, &movement.Livemode, &movement.DocumentKind, &movement.Number, &movement.Reference, &movement.Title, &movement.ChainID, &movement.Network, &movement.Token, &movement.Symbol, &movement.Decimals,
		&movement.Kind, &source, &booked, &receiver, &payable, &held, &movement.TxHash, &movement.LogIndex, &movement.TransferLogIndex, &movement.BlockHash, &movement.BlockNumber, &blockTime,
		&movement.From, &movement.To, &movement.Status, &movement.Verified, &movement.VerifiedBlock, &movement.VerifiedHash, &movement.PolicyException, &movement.ReconciliationError)
	if err != nil {
		return PaymentMovement{}, err
	}
	for target, text := range map[**big.Int]*string{&movement.SourceAmount: source, &movement.BookedAmount: booked, &movement.ReceiverDelta: receiver, &movement.PayableDelta: payable, &movement.HeldDelta: held} {
		if text != nil {
			*target, _ = new(big.Int).SetString(*text, 10)
		}
	}
	if blockTime != nil {
		at := time.Unix(*blockTime, 0).UTC()
		movement.BlockTime = &at
	}
	return movement, nil
}

func decodeMovementCursor(cursor string) (time.Time, string, error) {
	if len(cursor) > 256 {
		return time.Time{}, "", fmt.Errorf("%w: invalid movement cursor", ErrInvalid)
	}
	raw, err := base64.RawURLEncoding.DecodeString(cursor)
	at, id, ok := strings.Cut(string(raw), "|")
	parsed, parseErr := time.Parse(time.RFC3339Nano, at)
	kind, number, hasNumber := strings.Cut(id, ":")
	_, numberErr := strconv.ParseUint(number, 10, 64)
	if err != nil || parseErr != nil || !ok || !hasNumber || numberErr != nil ||
		kind != "ledger" && kind != "deposit" && kind != "outflow" {
		return time.Time{}, "", fmt.Errorf("%w: invalid movement cursor", ErrInvalid)
	}
	return parsed, id, nil
}

func PaymentUSDValue(units *big.Int, decimals int) string {
	return new(big.Rat).SetFrac(units, new(big.Int).Exp(big.NewInt(10), big.NewInt(int64(decimals)), nil)).FloatString(decimals)
}

func (s *Service) ExportPaymentMovements(ctx context.Context, profileID string, q MovementQuery, write func(PaymentMovement) error) (time.Time, error) {
	if q.After != "" {
		return time.Time{}, fmt.Errorf("%w: exports use a period, not a cursor", ErrInvalid)
	}
	args, scope, err := paymentScope(profileID, q)
	if err != nil {
		return time.Time{}, err
	}
	args[1] = MaxPaymentExportRows + 1
	scopeArgs := args
	args, where, err := movementWhere(q, args)
	if err != nil {
		return time.Time{}, err
	}
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return time.Time{}, err
	}
	defer tx.Rollback(ctx)
	if q.PaymentID != "" {
		var exists bool
		if err := tx.QueryRow(ctx, "WITH "+scope+" SELECT EXISTS (SELECT 1 FROM payment_scope) AND $2::int > 0", scopeArgs...).Scan(&exists); err != nil {
			return time.Time{}, err
		}
		if !exists {
			return time.Time{}, ErrPaymentNotFound
		}
	}
	var at time.Time
	if err := tx.QueryRow(ctx, "SELECT transaction_timestamp()").Scan(&at); err != nil {
		return time.Time{}, err
	}
	prefix := selectedMovementsSQL(scope, where)
	var count int
	if err := tx.QueryRow(ctx, prefix+" SELECT count(*) FROM selected_movements", args...).Scan(&count); err != nil {
		return time.Time{}, err
	}
	if count > MaxPaymentExportRows {
		return time.Time{}, ErrTooManyMovements
	}
	rows, err := tx.Query(ctx, prefix+paymentMovementRows+" SELECT "+movementColumns+" FROM movements ORDER BY recorded_at DESC,id DESC", args...)
	if err != nil {
		return time.Time{}, err
	}
	for rows.Next() {
		movement, err := scanPaymentMovement(rows)
		if err != nil {
			rows.Close()
			return time.Time{}, err
		}
		if err := write(movement); err != nil {
			rows.Close()
			return time.Time{}, err
		}
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return time.Time{}, err
	}
	return at, tx.Commit(ctx)
}
