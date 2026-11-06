package send

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"math/big"
	"strings"

	"github.com/ethereum/go-ethereum"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/ethclient"
	"github.com/ethereum/go-ethereum/rpc"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// Request is what the owner asks to send. To is an address, or empty with ToProfileID for a transfer.
type Request struct {
	ChainID     uint64
	Token       string
	To          string
	ToProfileID string
	Amount      *big.Int
}

var (
	selTransfer  = common.Hex2Bytes("a9059cbb")
	selBalanceOf = common.Hex2Bytes("70a08231")
	// An EIP-7702 account's code is this prefix and the delegate's address: a wallet, not a contract.
	delegation = common.Hex2Bytes("ef0100")
)

// Prepare checks a send out of the profile's wallet and keeps it for the browser to sign (R-211). It replaces the
// wallet's earlier unsigned send on the chain, and fails with ErrBusy while a signed one is still on its way.
func (s *Service) Prepare(ctx context.Context, profileID string, req Request) (Send, error) {
	if req.Amount == nil || req.Amount.Sign() <= 0 {
		return Send{}, fmt.Errorf("%w: amount must be a positive number of base units", ErrInvalid)
	}
	var family string
	var sponsored bool
	err := s.pool.QueryRow(ctx, `
		SELECT c.chain_family, c.gas_sponsored FROM chains c JOIN tokens t ON t.chain_id = c.chain_id
		WHERE c.chain_id = $1 AND t.contract = $2 AND c.enabled AND t.enabled`,
		int64(req.ChainID), strings.ToLower(req.Token)).Scan(&family, &sponsored)
	if errors.Is(err, pgx.ErrNoRows) {
		return Send{}, fmt.Errorf("%w: token is not enabled on this network", ErrInvalid)
	} else if err != nil {
		return Send{}, fmt.Errorf("read chain: %w", err)
	}
	if !sponsored {
		return Send{}, fmt.Errorf("%w: sending on this network isn't available yet", ErrInvalid)
	}
	out := Send{ProfileID: profileID, ChainID: req.ChainID, Token: strings.ToLower(req.Token), Amount: req.Amount}
	err = s.pool.QueryRow(ctx, "SELECT address FROM profile_wallets WHERE profile_id = $1 AND chain_family = $2",
		profileID, family).Scan(&out.From)
	if errors.Is(err, pgx.ErrNoRows) {
		return Send{}, fmt.Errorf("%w: this profile has no wallet yet", ErrInvalid)
	} else if err != nil {
		return Send{}, fmt.Errorf("read wallet: %w", err)
	}
	if err := s.recipient(ctx, &out, req); err != nil {
		return Send{}, err
	}
	if err := s.finishOpen(ctx, out.From, out.ChainID); err != nil {
		return Send{}, err
	}
	client, err := s.client(out.ChainID)
	if err != nil {
		return Send{}, err
	}
	if err := checkOnChain(ctx, client, &out); err != nil {
		return Send{}, err
	}
	if out.ToProfileID == nil {
		var sentBefore bool
		err = s.pool.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM wallet_transfers WHERE wallet_address = $1
			AND direction = 'out' AND counterparty = $2 AND status <> 'reorged')`, out.From, out.To).Scan(&sentBefore)
		if err != nil {
			return Send{}, fmt.Errorf("read past sends: %w", err)
		}
		if !sentBefore {
			out.Warnings = append(out.Warnings, WarnNewRecipient)
		}
	}
	return s.keep(ctx, out)
}

// recipient sets To (and ToProfileID for one of the owner's profiles) or refuses the address.
func (s *Service) recipient(ctx context.Context, out *Send, req Request) error {
	if req.ToProfileID != "" {
		if req.To != "" {
			return fmt.Errorf("%w: give either to or toProfileId", ErrInvalid)
		}
		id := strings.ToLower(req.ToProfileID)
		err := s.pool.QueryRow(ctx, `
			SELECT w.address FROM profiles p JOIN profile_wallets w ON w.profile_id = p.id AND w.chain_family = 'evm'
			WHERE p.id::text = $1 AND p.id <> $2 AND p.user_id = (SELECT user_id FROM profiles WHERE id = $2)`,
			id, out.ProfileID).Scan(&out.To)
		if errors.Is(err, pgx.ErrNoRows) {
			return fmt.Errorf("%w: toProfileId is not another of your profiles with a wallet", ErrInvalid)
		} else if err != nil {
			return fmt.Errorf("read recipient profile: %w", err)
		}
		out.ToProfileID = &id
		return nil
	}
	to, err := parseAddress(req.To)
	if err != nil {
		return err
	}
	out.To = to
	if to == out.From {
		return fmt.Errorf("%w: this is the profile's own wallet", ErrInvalid)
	}
	var token bool
	var own *string
	err = s.pool.QueryRow(ctx, `
		SELECT EXISTS (SELECT 1 FROM tokens WHERE contract = $1),
		       (SELECT p.id::text FROM profile_wallets w JOIN profiles p ON p.id = w.profile_id
		        WHERE w.address = $1 AND p.user_id = (SELECT user_id FROM profiles WHERE id = $2))`,
		to, out.ProfileID).Scan(&token, &own)
	if err != nil {
		return fmt.Errorf("read recipient: %w", err)
	}
	if token {
		return fmt.Errorf("%w: this is a token's contract; money sent there is lost", ErrInvalid)
	}
	out.ToProfileID = own // a pasted address of another of the owner's profiles is a transfer
	return nil
}

// parseAddress takes a 0x address in one case, or mixed case only with a valid EIP-55 checksum.
func parseAddress(s string) (string, error) {
	s = strings.TrimSpace(s)
	if !strings.HasPrefix(s, "0x") || !common.IsHexAddress(s) {
		return "", fmt.Errorf("%w: to is not an address", ErrInvalid)
	}
	if body := s[2:]; body != strings.ToLower(body) && body != strings.ToUpper(body) &&
		common.HexToAddress(s).Hex() != s {
		return "", fmt.Errorf("%w: to has a wrong checksum; check every character", ErrInvalid)
	}
	a := common.HexToAddress(s)
	if a == (common.Address{}) {
		return "", fmt.Errorf("%w: to is the zero address; money sent there is lost", ErrInvalid)
	}
	return strings.ToLower(a.Hex()), nil
}

// checkOnChain reads the wallet's balance, dry-runs the transfer from the wallet and warns of a contract recipient.
func checkOnChain(ctx context.Context, client *ethclient.Client, out *Send) error {
	from, to, token := common.HexToAddress(out.From), common.HexToAddress(out.To), common.HexToAddress(out.Token)
	raw, err := client.CallContract(ctx, ethereum.CallMsg{To: &token,
		Data: append(bytes.Clone(selBalanceOf), common.LeftPadBytes(from.Bytes(), 32)...)}, nil)
	if err := refused(err); err != nil {
		return err
	}
	if len(raw) != 32 {
		return fmt.Errorf("%w: its balanceOf answered %d bytes", ErrRefused, len(raw))
	}
	if new(big.Int).SetBytes(raw).Cmp(out.Amount) < 0 {
		return fmt.Errorf("%w: amount is more than the wallet holds", ErrInvalid)
	}
	data := append(bytes.Clone(selTransfer), common.LeftPadBytes(to.Bytes(), 32)...)
	data = append(data, common.LeftPadBytes(out.Amount.Bytes(), 32)...)
	ok, err := client.CallContract(ctx, ethereum.CallMsg{From: from, To: &token, Data: data}, nil)
	if err := refused(err); err != nil {
		return err
	}
	if len(ok) == 32 && new(big.Int).SetBytes(ok).Sign() == 0 { // a token that returns false instead of reverting
		return ErrRefused
	}
	code, err := client.CodeAt(ctx, to, nil)
	if err != nil {
		return errors.Join(ErrUnavailable, fmt.Errorf("read recipient code: %w", err))
	}
	if len(code) > 0 && !(len(code) == 23 && bytes.HasPrefix(code, delegation)) {
		out.Warnings = append(out.Warnings, WarnContract)
	}
	return nil
}

// refused tells a token's revert from any other failed read, such as a rate limit or a node behind.
func refused(err error) error {
	if err == nil {
		return nil
	}
	// Every JSON-RPC error has ErrorData; a revert's carries the revert data.
	if dataErr := rpc.DataError(nil); errors.As(err, &dataErr) && dataErr.ErrorData() != nil ||
		strings.Contains(strings.ToLower(err.Error()), "revert") {
		return fmt.Errorf("%w: %s", ErrRefused, err.Error())
	}
	return errors.Join(ErrUnavailable, err)
}

// keep cancels the wallet's unsigned send on the chain and saves this one in its place.
func (s *Service) keep(ctx context.Context, out Send) (Send, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return Send{}, fmt.Errorf("begin: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	// The wallet's row lock makes the check and the insert one step for concurrent prepares.
	var busy bool
	err = tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM sends WHERE from_address = $1 AND chain_id = $2
		AND status = 'submitted') FROM profile_wallets WHERE address = $1 FOR UPDATE`, out.From, int64(out.ChainID)).
		Scan(&busy)
	if err != nil {
		return Send{}, fmt.Errorf("lock wallet: %w", err)
	}
	if busy {
		return Send{}, ErrBusy
	}
	if _, err = tx.Exec(ctx, `UPDATE sends SET status = 'canceled', finished_at = now()
		WHERE from_address = $1 AND chain_id = $2 AND status = 'prepared'`, out.From, int64(out.ChainID)); err != nil {
		return Send{}, fmt.Errorf("cancel unsigned send: %w", err)
	}
	err = tx.QueryRow(ctx, `
		INSERT INTO sends (profile_id, chain_id, chain_family, token_contract, from_address, to_address, to_profile_id,
		                   amount)
		VALUES ($1, $2, 'evm', $3, $4, $5, $6, $7::numeric) RETURNING id::text, status, created_at`,
		out.ProfileID, int64(out.ChainID), out.Token, out.From, out.To, out.ToProfileID, out.Amount.String()).
		Scan(&out.ID, &out.Status, &out.CreatedAt)
	if pgErr := (*pgconn.PgError)(nil); errors.As(err, &pgErr) && pgErr.ConstraintName == "sends_one_unsigned" {
		return Send{}, ErrBusy
	} else if err != nil {
		return Send{}, fmt.Errorf("save send: %w", err)
	}
	if err = tx.Commit(ctx); err != nil {
		return Send{}, fmt.Errorf("commit: %w", err)
	}
	return out, nil
}
