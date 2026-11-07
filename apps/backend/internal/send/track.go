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
	network_fee::text, gas_limit, max_fee_per_gas::text, max_priority_fee_per_gas::text, approved_at`

func scan(row pgx.Row) (Send, error) {
	var s Send
	var chainID int64
	var amount, fee string
	var limit *int64
	var maxFee, tip *string
	err := row.Scan(&s.ID, &s.ProfileID, &chainID, &s.Token, &s.From, &s.To, &s.ToProfileID, &amount, &s.Status,
		&s.TxHash, &s.Failure, &s.CreatedAt, &s.SubmittedAt, &s.FinishedAt, &s.Symbol, &s.Decimals, &fee, &limit, &maxFee,
		&tip, &s.ApprovedAt)
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

// Submit records the hash the browser got from signing the send (R-212). The same hash again is a no-op. Only an
// approved send takes one, including one whose hold ended while the browser was signing: the browser signs only after
// the approve, and a hash on a send never approved would explain away money that left without one (D-49).
func (s *Service) Submit(ctx context.Context, profileID, sendID, txHash string) (Send, error) {
	txHash = strings.ToLower(txHash)
	if !hashPattern.MatchString(txHash) {
		return Send{}, fmt.Errorf("%w: txHash is not a transaction hash", ErrInvalid)
	}
	out, err := scan(s.pool.QueryRow(ctx, `
		UPDATE sends SET status = 'submitted', tx_hash = $3, submitted_at = now(), finished_at = NULL
		WHERE id::text = $1 AND profile_id = $2 AND approved_at IS NOT NULL AND status IN ('approved', 'expired')
		RETURNING `+columns,
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

// Approve lets the browser sign a prepared send, once: a second approve is ErrApproved, so one summary is never
// signed twice. A send no longer prepared, such as one past PrepareTTL, comes back as it is.
func (s *Service) Approve(ctx context.Context, profileID, sendID string) (Send, error) {
	out, err := s.Get(ctx, profileID, sendID)
	if err != nil {
		return Send{}, err
	}
	if out.Status == Approved {
		return Send{}, ErrApproved
	}
	if out.Status != Prepared {
		return out, nil
	}
	approved, err := scan(s.pool.QueryRow(ctx, `UPDATE sends SET status = 'approved', approved_at = now()
		WHERE id = $1 AND status = 'prepared' RETURNING `+columns, out.ID))
	if errors.Is(err, pgx.ErrNoRows) { // approved, given up or replaced since the read
		if out, err = s.Get(ctx, profileID, sendID); err == nil && out.Status == Approved {
			return Send{}, ErrApproved
		}
		return out, err
	} else if err != nil {
		return Send{}, fmt.Errorf("approve send: %w", err)
	}
	approved.Gas, approved.NetworkFee = out.Gas, out.NetworkFee
	return approved, nil
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
		WHERE from_address = $1 AND chain_id = $2 AND status IN ('prepared', 'approved', 'submitted')`, wallet, int64(chainID))
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
	case Approved:
		return s.unreported(ctx, out)
	case Submitted:
	case Failed:
		// A transaction given up as dropped can still be mined: once the watcher records its transfer as final, the
		// send was sent after all.
		if out.Failure == nil || *out.Failure != "dropped" {
			return out, nil
		}
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
	case out.Status == Failed:
		return out, nil
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
		// A waiting transaction has no receipt either: one the node still knows, or can't tell about, isn't dropped.
		if _, _, err := client.TransactionByHash(ctx, common.HexToHash(*out.TxHash)); !errors.Is(err, ethereum.NotFound) {
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

// unreported settles an approved send the browser never reported: its signature may have gone out though the answer
// was lost. The wallet's transfer to the same address and amount that the watcher recorded since the approve, and no
// send claims, becomes its hash; with none, the approval ends after ApproveHold, once the watcher has read the chain
// past it and the wallet has no transaction still waiting.
func (s *Service) unreported(ctx context.Context, out Send) (Send, error) {
	// The watcher's place is read before its transfers: a scan that commits in between then only adds a transfer,
	// and never looks past the hold without it.
	var read bool
	if err := s.pool.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM chain_cursors WHERE chain_id = $1
		AND last_scanned_time >= $2)`, int64(out.ChainID), out.ApprovedAt.Add(ApproveHold).Unix()).Scan(&read); err != nil {
		return Send{}, fmt.Errorf("read chain cursor: %w", err)
	}
	var hash string
	err := s.pool.QueryRow(ctx, `
		SELECT w.tx_hash FROM wallet_transfers w WHERE w.chain_id = $1 AND w.wallet_address = $2 AND w.direction = 'out'
		AND w.token_contract = $3 AND w.counterparty = $4 AND w.amount = $5::numeric AND w.status <> 'reorged'
		AND w.created_at >= $6 AND NOT EXISTS (SELECT 1 FROM sends x WHERE x.chain_id = w.chain_id
		    AND x.from_address = w.wallet_address AND x.tx_hash = w.tx_hash)
		ORDER BY w.block_number, w.log_index LIMIT 1`,
		int64(out.ChainID), out.From, out.Token, out.To, out.Amount.String(), *out.ApprovedAt).Scan(&hash)
	if errors.Is(err, pgx.ErrNoRows) {
		// A transfer mined within the hold that the watcher hasn't read yet would otherwise free the wallet for the
		// same money again.
		if s.now().Sub(*out.ApprovedAt) < ApproveHold || !read || s.waiting(ctx, out) {
			return out, nil
		}
		return s.finish(ctx, out, Expired, nil)
	} else if err != nil {
		return Send{}, fmt.Errorf("read wallet transfer: %w", err)
	}
	next, err := scan(s.pool.QueryRow(ctx, `UPDATE sends SET status = 'submitted', tx_hash = $2, submitted_at = now()
		WHERE id = $1::uuid AND status = 'approved' RETURNING `+columns, out.ID, hash))
	if errors.Is(err, pgx.ErrNoRows) { // the browser's report came first
		return s.Get(ctx, out.ProfileID, out.ID)
	} else if err != nil {
		return Send{}, fmt.Errorf("record unreported send: %w", err)
	}
	return s.refresh(ctx, next)
}

// waiting reports whether the wallet has a transaction no block holds yet, or the node can't tell. The lost signature
// may be that transaction, and a new send would be signed at the next nonce and go out after it.
func (s *Service) waiting(ctx context.Context, out Send) bool {
	client, err := s.client(out.ChainID)
	if err != nil {
		return true
	}
	from := common.HexToAddress(out.From)
	pending, err := client.PendingNonceAt(ctx, from)
	if err != nil {
		return true
	}
	mined, err := client.NonceAt(ctx, from, nil)
	return err != nil || pending > mined
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
