package send

import (
	"context"
	"errors"
	"fmt"
	"math/big"
	"regexp"
	"strings"

	"github.com/ethereum/go-ethereum"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

var hashPattern = regexp.MustCompile(`^0x[0-9a-f]{64}$`)

const columns = `id::text, profile_id::text, chain_id, token_contract, from_address, to_address, to_profile_id::text,
	amount::text, status, tx_hash, failure, created_at, submitted_at, finished_at,
	(SELECT tk.symbol FROM tokens tk WHERE tk.chain_id = sends.chain_id AND tk.contract = sends.token_contract),
	(SELECT tk.decimals FROM tokens tk WHERE tk.chain_id = sends.chain_id AND tk.contract = sends.token_contract),
	network_fee::text, gas_limit, max_fee_per_gas::text, max_priority_fee_per_gas::text`

func scan(row pgx.Row) (Send, error) {
	var s Send
	var chainID int64
	var amount, fee string
	var limit *int64
	var maxFee, tip *string
	err := row.Scan(&s.ID, &s.ProfileID, &chainID, &s.Token, &s.From, &s.To, &s.ToProfileID, &amount, &s.Status,
		&s.TxHash, &s.Failure, &s.CreatedAt, &s.SubmittedAt, &s.FinishedAt, &s.Symbol, &s.Decimals, &fee, &limit, &maxFee,
		&tip)
	s.ChainID = uint64(chainID)
	s.Amount, _ = new(big.Int).SetString(amount, 10)
	s.NetworkFee, _ = new(big.Int).SetString(fee, 10)
	if limit != nil && maxFee != nil && tip != nil {
		s.Gas = &Gas{Limit: uint64(*limit)}
		s.Gas.MaxFeePerGas, _ = new(big.Int).SetString(*maxFee, 10)
		s.Gas.MaxPriorityFeePerGas, _ = new(big.Int).SetString(*tip, 10)
	}
	return s, err
}

// Submit records the hash the browser got from signing the send (R-212). The same hash again is a no-op. A send
// given up or replaced while the browser was signing takes its hash too: the money is moving.
func (s *Service) Submit(ctx context.Context, profileID, sendID, txHash string) (Send, error) {
	txHash = strings.ToLower(txHash)
	if !hashPattern.MatchString(txHash) {
		return Send{}, fmt.Errorf("%w: txHash is not a transaction hash", ErrInvalid)
	}
	out, err := scan(s.pool.QueryRow(ctx, `
		UPDATE sends SET status = 'submitted', tx_hash = $3, submitted_at = now(), finished_at = NULL
		WHERE id::text = $1 AND profile_id = $2 AND status IN ('prepared', 'expired', 'canceled') RETURNING `+columns,
		strings.ToLower(sendID), profileID, txHash))
	if errors.Is(err, pgx.ErrNoRows) {
		out, err = s.Get(ctx, profileID, sendID)
		if err != nil {
			return Send{}, err
		}
		if out.TxHash == nil || *out.TxHash != txHash {
			return Send{}, fmt.Errorf("%w: this send can't take a hash now", ErrInvalid)
		}
		return out, nil
	} else if pgErr := (*pgconn.PgError)(nil); errors.As(err, &pgErr) && pgErr.ConstraintName == "sends_tx" {
		return Send{}, fmt.Errorf("%w: this hash belongs to another send", ErrInvalid)
	} else if err != nil {
		return Send{}, fmt.Errorf("submit send: %w", err)
	}
	return out, nil
}

// Cancel gives up an unsigned send, as when the owner closes the review.
func (s *Service) Cancel(ctx context.Context, profileID, sendID string) error {
	tag, err := s.pool.Exec(ctx, `UPDATE sends SET status = 'canceled', finished_at = now()
		WHERE id::text = $1 AND profile_id = $2 AND status = 'prepared'`, strings.ToLower(sendID), profileID)
	if err != nil {
		return fmt.Errorf("cancel send: %w", err)
	}
	if tag.RowsAffected() == 0 {
		if _, err := s.Get(ctx, profileID, sendID); err != nil {
			return err
		}
		return fmt.Errorf("%w: only an unsigned send can be canceled", ErrInvalid)
	}
	return nil
}

// Get is the send with its status brought up to date from the chain.
func (s *Service) Get(ctx context.Context, profileID, sendID string) (Send, error) {
	out, err := scan(s.pool.QueryRow(ctx, "SELECT "+columns+" FROM sends WHERE id::text = $1 AND profile_id = $2",
		strings.ToLower(sendID), profileID))
	if errors.Is(err, pgx.ErrNoRows) {
		return Send{}, ErrNotFound
	} else if err != nil {
		return Send{}, fmt.Errorf("read send: %w", err)
	}
	return s.refresh(ctx, out)
}

// Pending is the profile's signed sends the watcher hasn't recorded yet, newest first, each brought up to date
// (R-215): the money lists show them until the transfer's own row takes their place.
func (s *Service) Pending(ctx context.Context, profileID string) ([]Send, error) {
	rows, err := s.pool.Query(ctx, "SELECT "+columns+` FROM sends WHERE profile_id = $1 AND status = 'submitted'
		ORDER BY submitted_at DESC LIMIT 20`, profileID)
	if err != nil {
		return nil, fmt.Errorf("read pending sends: %w", err)
	}
	open, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (Send, error) { return scan(r) })
	if err != nil {
		return nil, fmt.Errorf("read pending sends: %w", err)
	}
	out := []Send{}
	for _, o := range open {
		o, err := s.refresh(ctx, o)
		if err != nil {
			return nil, err
		}
		if o.Status == Submitted && !o.OnChain {
			out = append(out, o)
		}
	}
	return out, nil
}

// finishOpen brings the wallet's open sends on the chain up to date, so a finished one no longer holds the next.
func (s *Service) finishOpen(ctx context.Context, wallet string, chainID uint64) error {
	rows, err := s.pool.Query(ctx, "SELECT "+columns+` FROM sends
		WHERE from_address = $1 AND chain_id = $2 AND status IN ('prepared', 'submitted')`, wallet, int64(chainID))
	if err != nil {
		return fmt.Errorf("read open sends: %w", err)
	}
	open, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (Send, error) { return scan(r) })
	if err != nil {
		return fmt.Errorf("read open sends: %w", err)
	}
	for _, o := range open {
		if _, err := s.refresh(ctx, o); err != nil && !errors.Is(err, ErrUnavailable) {
			return err
		}
	}
	return nil
}

// refresh moves the send on from what the chain shows (R-212). Only the watcher's wallet transfer out of the wallet
// with this hash, token, recipient and amount makes it sent; nothing here ever sends again.
func (s *Service) refresh(ctx context.Context, out Send) (Send, error) {
	now := s.now()
	switch out.Status {
	case Prepared:
		if now.Sub(out.CreatedAt) < PrepareTTL {
			return out, nil
		}
		return s.finish(ctx, out, Expired, nil)
	case Submitted:
	default:
		return out, nil
	}
	var seen *string
	err := s.pool.QueryRow(ctx, `
		SELECT status FROM wallet_transfers WHERE chain_id = $1 AND tx_hash = $2 AND wallet_address = $3
		AND direction = 'out' AND token_contract = $4 AND counterparty = $5 AND amount = $6::numeric
		AND status <> 'reorged' ORDER BY status = 'confirmed' DESC LIMIT 1`,
		int64(out.ChainID), *out.TxHash, out.From, out.Token, out.To, out.Amount.String()).Scan(&seen)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return Send{}, fmt.Errorf("read wallet transfer: %w", err)
	}
	switch {
	case seen != nil && *seen == "confirmed":
		return s.finish(ctx, out, Sent, nil)
	case seen != nil:
		out.OnChain = true
		return out, nil
	case now.Sub(*out.SubmittedAt) < receiptAfter:
		return out, nil
	}
	client, err := s.client(out.ChainID)
	if err != nil {
		return out, nil // the next read tries again
	}
	receipt, err := client.TransactionReceipt(ctx, common.HexToHash(*out.TxHash))
	switch {
	case errors.Is(err, ethereum.NotFound):
		if now.Sub(*out.SubmittedAt) < DropAfter {
			return out, nil
		}
		dropped := "dropped"
		return s.finish(ctx, out, Failed, &dropped)
	case err != nil:
		return out, nil
	case !moves(receipt, out):
		// Mined without the transfer: the transaction or the wallet's call inside it reverted.
		reverted := "reverted"
		return s.finish(ctx, out, Failed, &reverted)
	}
	return out, nil // mined with the transfer: sent once the watcher records it
}

var transferTopic = common.HexToHash("0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef")

// moves reports whether the receipt holds the send's token Transfer out of the wallet.
func moves(r *types.Receipt, out Send) bool {
	if r.Status != types.ReceiptStatusSuccessful {
		return false
	}
	from, to := common.HexToAddress(out.From), common.HexToAddress(out.To)
	for _, l := range r.Logs {
		if l.Address == common.HexToAddress(out.Token) && len(l.Topics) == 3 && l.Topics[0] == transferTopic &&
			common.BytesToAddress(l.Topics[1].Bytes()) == from && common.BytesToAddress(l.Topics[2].Bytes()) == to &&
			new(big.Int).SetBytes(l.Data).Cmp(out.Amount) == 0 {
			return true
		}
	}
	return false
}

func (s *Service) finish(ctx context.Context, out Send, status Status, failure *string) (Send, error) {
	next, err := scan(s.pool.QueryRow(ctx, `UPDATE sends SET status = $2, failure = $3, finished_at = now()
		WHERE id = $1::uuid AND status = $4 RETURNING `+columns, out.ID, status, failure, out.Status))
	if errors.Is(err, pgx.ErrNoRows) { // another read moved it first
		return s.Get(ctx, out.ProfileID, out.ID)
	} else if err != nil {
		return Send{}, fmt.Errorf("update send: %w", err)
	}
	return next, nil
}
