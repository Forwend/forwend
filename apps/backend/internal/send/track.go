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
	"github.com/forwend/forwend/apps/backend/internal/chain"
	"github.com/jackc/pgx/v5"
)

var hashPattern = regexp.MustCompile(`^0x[0-9a-f]{64}$`)

const columns = `id::text, profile_id::text, chain_id, token_contract, from_address, to_address, to_profile_id::text,
	amount::text, status, tx_hash, failure, created_at, submitted_at, finished_at,
	(SELECT tk.symbol FROM tokens tk WHERE tk.chain_id = sends.chain_id AND tk.contract = sends.token_contract),
	(SELECT tk.decimals FROM tokens tk WHERE tk.chain_id = sends.chain_id AND tk.contract = sends.token_contract),
	network_fee::text, gas_limit, max_fee_per_gas::text, max_priority_fee_per_gas::text, approved_at, fee_paid::text,
	fee_asset, privy_transaction_id,
	(SELECT w.provider_wallet_id FROM profile_wallets w WHERE w.address = sends.from_address)`

func scan(row pgx.Row) (Send, error) {
	var s Send
	var chainID int64
	var amount, fee string
	var limit *int64
	var maxFee, tip, paid *string
	err := row.Scan(&s.ID, &s.ProfileID, &chainID, &s.Token, &s.From, &s.To, &s.ToProfileID, &amount, &s.Status,
		&s.TxHash, &s.Failure, &s.CreatedAt, &s.SubmittedAt, &s.FinishedAt, &s.Symbol, &s.Decimals, &fee, &limit, &maxFee,
		&tip, &s.ApprovedAt, &paid, &s.FeeAsset, &s.RelayID, &s.walletID)
	if paid != nil {
		s.FeePaid, _ = new(big.Int).SetString(*paid, 10)
	}
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

// Pending is the profile's signed sends the watcher hasn't recorded yet, newest first, brought up to date.
func (s *Service) Pending(ctx context.Context, profileID string) ([]Send, error) {
	rows, err := s.pool.Query(ctx, "SELECT "+columns+` FROM sends WHERE profile_id = $1 AND status = 'submitted'
		AND chain_id IN (SELECT chain_id FROM chains WHERE livemode = (SELECT livemode FROM profiles WHERE id = $1))
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

// refresh moves the send on from what the chain shows. Only the watcher's matching wallet transfer makes it
// sent; nothing here ever sends again.
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
		if out.TxHash == nil {
			return s.relayed(ctx, out)
		}
	case Failed:
		// A dropped transaction can still be mined, and a revert in a reorged block can succeed: once the watcher
		// records its transfer as final, the send was sent after all.
		if out.Failure == nil || *out.Failure != "dropped" && *out.Failure != "reverted" {
			return out, nil
		}
		if out.TxHash == nil {
			return s.relayed(ctx, out)
		}
		if *out.Failure == "dropped" {
			if moved, next, _, err := s.rehash(ctx, out); moved || err != nil {
				return next, err
			}
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
		return s.finishMined(ctx, out, Sent, nil, nil)
	case out.Status == Failed:
		return out, nil
	case seen != nil:
		out.OnChain = true
		return out, nil
	case now.Sub(*out.SubmittedAt) < receiptAfter, !s.receiptDue(out.ID, now):
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
		// Privy may have sent the same user operation again under another hash.
		if moved, next, _, err := s.rehash(ctx, out); moved || err != nil {
			return next, err
		}
		dropped := "dropped"
		return s.finish(ctx, out, Failed, &dropped)
	case err != nil:
		return out, nil
	case !moves(receipt, out):
		// Mined without the transfer: the transaction or the wallet's call inside it reverted, and still paid its gas.
		reverted := "reverted"
		return s.finishMined(ctx, out, Failed, &reverted, receipt)
	}
	return out, nil // mined with the transfer: sent once the watcher records it
}

// moves reports whether the receipt holds the send's token Transfer out of the wallet.
func moves(r *types.Receipt, out Send) bool {
	if r.Status != types.ReceiptStatusSuccessful {
		return false
	}
	from, to := common.HexToAddress(out.From), common.HexToAddress(out.To)
	for _, l := range r.Logs {
		if l.Address == common.HexToAddress(out.Token) && len(l.Topics) == 3 && l.Topics[0] == chain.TransferTopic &&
			common.BytesToAddress(l.Topics[1].Bytes()) == from && common.BytesToAddress(l.Topics[2].Bytes()) == to &&
			new(big.Int).SetBytes(l.Data).Cmp(out.Amount) == 0 {
			return true
		}
	}
	return false
}

// unreported settles an approved send the browser never reported: a matching recorded transfer becomes its hash;
// with none, the approval ends after ApproveHold. A paymaster send gets a hash only from Privy.
func (s *Service) unreported(ctx context.Context, out Send) (Send, error) {
	// The watcher's place is read before its transfers, so a scan that commits in between only adds a transfer.
	var read bool
	if err := s.pool.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM chain_cursors WHERE chain_id = $1
		AND last_scanned_time >= $2)`, int64(out.ChainID), out.ApprovedAt.Add(ApproveHold).Unix()).Scan(&read); err != nil {
		return Send{}, fmt.Errorf("read chain cursor: %w", err)
	}
	var hash string
	err := s.pool.QueryRow(ctx, `
		SELECT w.tx_hash FROM wallet_transfers w WHERE w.chain_id = $1 AND w.wallet_address = $2 AND w.direction = 'out'
		AND w.token_contract = $3 AND w.counterparty = $4 AND w.amount = $5::numeric AND w.status <> 'reorged'
		AND w.created_at >= $6 AND $7::text IS NULL AND NOT EXISTS (SELECT 1 FROM sends x WHERE x.chain_id = w.chain_id
		    AND x.from_address = w.wallet_address AND x.tx_hash = w.tx_hash)
		ORDER BY w.block_number, w.log_index LIMIT 1`,
		int64(out.ChainID), out.From, out.Token, out.To, out.Amount.String(), *out.ApprovedAt, out.FeeAsset).Scan(&hash)
	if errors.Is(err, pgx.ErrNoRows) {
		// A transfer mined within the hold that the watcher hasn't read yet would otherwise free the wallet again.
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

// waiting reports whether the wallet has a transaction no block holds yet, or the node can't tell: a new send
// would go out after it.
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
	return s.finishPaid(ctx, out, status, failure, nil)
}

// finishMined ends a mined send with the gas its wallet paid, 0 when Forwend sponsored it; unreadable is unknown.
func (s *Service) finishMined(ctx context.Context, out Send, status Status, failure *string,
	receipt *types.Receipt) (Send, error) {
	paid := new(big.Int)
	if out.Gas != nil || out.FeeAsset != nil {
		paid = nil
		if receipt == nil {
			if client, err := s.client(out.ChainID); err == nil {
				receipt, _ = client.TransactionReceipt(ctx, common.HexToHash(*out.TxHash))
			}
		}
		if receipt != nil && out.FeeAsset != nil {
			paid = paymasterTook(receipt, out)
		} else if receipt != nil && receipt.EffectiveGasPrice != nil {
			// Wei of an 18-decimal gas coin (Arc) or attodollars (Tempo), in the token's base units, rounded up.
			wei := new(big.Int).Mul(receipt.EffectiveGasPrice, new(big.Int).SetUint64(receipt.GasUsed))
			paid = ceilDiv(wei, gasScale(out.Decimals))
		}
	}
	return s.finishPaid(ctx, out, status, failure, paid)
}

// paymasterTook is what a paymaster send's wallet paid beyond the send, counted only when the transaction moved
// the send and the rest is within PaymasterFeeSlack times the quoted fee: anything else is money out.
func paymasterTook(r *types.Receipt, out Send) *big.Int {
	took, back := new(big.Int), new(big.Int)
	if !moves(r, out) {
		return took
	}
	from, to, token := common.HexToAddress(out.From), common.HexToAddress(out.To), common.HexToAddress(out.Token)
	for _, l := range r.Logs {
		if l.Address != token || len(l.Topics) != 3 || l.Topics[0] != chain.TransferTopic {
			continue
		}
		src, dst := common.BytesToAddress(l.Topics[1].Bytes()), common.BytesToAddress(l.Topics[2].Bytes())
		switch value := new(big.Int).SetBytes(l.Data); {
		case src == from && dst != to:
			took.Add(took, value)
		case dst == from && src != from:
			back.Add(back, value)
		}
	}
	if took.Cmp(new(big.Int).Mul(out.NetworkFee, big.NewInt(chain.PaymasterFeeSlack))) > 0 {
		return new(big.Int)
	}
	if took.Sub(took, back).Sign() < 0 {
		took.SetInt64(0)
	}
	return took
}

func (s *Service) finishPaid(ctx context.Context, out Send, status Status, failure *string, paid *big.Int) (Send,
	error) {
	var fee *string
	if paid != nil {
		v := paid.String()
		fee = &v
	}
	next, err := scan(s.pool.QueryRow(ctx, `UPDATE sends SET status = $2, failure = $3, finished_at = now(),
		fee_paid = $5::numeric WHERE id = $1::uuid AND status = $4 RETURNING `+columns, out.ID, status, failure, out.Status,
		fee))
	if errors.Is(err, pgx.ErrNoRows) { // another read moved it first
		return s.Get(ctx, out.ProfileID, out.ID)
	} else if err != nil {
		return Send{}, fmt.Errorf("update send: %w", err)
	}
	return next, nil
}
