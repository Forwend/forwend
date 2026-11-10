package send

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"log/slog"
	"math/big"
	"strings"

	"github.com/ethereum/go-ethereum"
	"github.com/ethereum/go-ethereum/accounts/abi"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/ethclient"
	"github.com/ethereum/go-ethereum/rpc"
	"github.com/forwend/forwend/apps/backend/internal/chain"
	"github.com/forwend/forwend/apps/backend/internal/ledger"
	"github.com/forwend/forwend/apps/backend/internal/settlement"
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
	var nativeGas bool
	var feeAsset *string
	var decimals int
	err := s.pool.QueryRow(ctx, `
		SELECT c.chain_family, t.native_gas, t.fee_asset, t.decimals FROM chains c JOIN tokens t ON t.chain_id = c.chain_id
		WHERE c.chain_id = $1 AND t.contract = $2 AND c.enabled AND t.enabled
		  AND c.livemode = (SELECT livemode FROM profiles WHERE id = $3)`,
		int64(req.ChainID), strings.ToLower(req.Token), profileID).Scan(&family, &nativeGas, &feeAsset, &decimals)
	if errors.Is(err, pgx.ErrNoRows) {
		return Send{}, fmt.Errorf("%w: token is not enabled on this network in the profile's mode", ErrInvalid)
	} else if err != nil {
		return Send{}, fmt.Errorf("read chain: %w", err)
	}
	// The wallet pays its own fee in the token (D-121): as the chain's gas coin (R-216), or through a paymaster (R-225).
	if !nativeGas && feeAsset == nil {
		return Send{}, fmt.Errorf("%w: this network's gas is paid in another coin, so it offers no Send yet", ErrInvalid)
	}
	out := Send{ProfileID: profileID, ChainID: req.ChainID, Token: strings.ToLower(req.Token), Amount: req.Amount,
		FeeAsset: feeAsset}
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
	if feeAsset != nil {
		if out.NetworkFee, err = paymasterFee(ctx, client, out.ChainID, out.From, out.Token, out.To, out.Amount,
			decimals); err != nil {
			return Send{}, err
		}
		if err := covers(ctx, client, out); err != nil {
			return Send{}, err
		}
	} else if err := s.estimate(ctx, client, &out, decimals); err != nil {
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
	// The fee manager is no payee, and money sent there in a send would read as that send's Tempo fee (chain.TempoFee).
	if common.HexToAddress(to) == chain.TempoFeeManager {
		return fmt.Errorf("%w: this address takes network fees, not payments", ErrInvalid)
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

// refused tells a token's revert from any other failed read, such as a rate limit or a node behind. The client sees
// only a decoded revert reason: the provider's error text can name its URL, key or internals.
func refused(err error) error {
	if err == nil {
		return nil
	}
	// Every JSON-RPC error has ErrorData; a revert's carries the revert data.
	dataErr := rpc.DataError(nil)
	hasData := errors.As(err, &dataErr) && dataErr.ErrorData() != nil
	if !hasData && !strings.Contains(strings.ToLower(err.Error()), "revert") {
		return errors.Join(ErrUnavailable, err)
	}
	slog.Warn("token refused a send's dry run", "err", chain.Redact(err))
	if hasData {
		if text, _ := dataErr.ErrorData().(string); text != "" {
			if reason, err := abi.UnpackRevert(common.FromHex(text)); err == nil {
				return fmt.Errorf("%w: %.200s", ErrRefused, reason)
			}
		}
	}
	return ErrRefused
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
		AND status IN ('approved', 'submitted')) FROM profile_wallets WHERE address = $1 FOR UPDATE`, out.From, int64(out.ChainID)).
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
		                   amount, network_fee, gas_limit, max_fee_per_gas, max_priority_fee_per_gas, fee_asset)
		VALUES ($1, $2, 'evm', $3, $4, $5, $6, $7::numeric, $8::numeric, $9, $10::numeric, $11::numeric, $12)
		RETURNING id::text, status, created_at,
		    (SELECT symbol FROM tokens WHERE chain_id = $2 AND contract = $3),
		    (SELECT decimals FROM tokens WHERE chain_id = $2 AND contract = $3)`,
		out.ProfileID, int64(out.ChainID), out.Token, out.From, out.To, out.ToProfileID, out.Amount.String(),
		out.NetworkFee.String(), gasLimit(out.Gas), gasValue(out.Gas, func(g *Gas) *big.Int { return g.MaxFeePerGas }),
		gasValue(out.Gas, func(g *Gas) *big.Int { return g.MaxPriorityFeePerGas }), out.FeeAsset).
		Scan(&out.ID, &out.Status, &out.CreatedAt, &out.Symbol, &out.Decimals)
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

// nativeDecimals: an EVM chain's gas coin counts in 18 decimals (Arc's USDC too), whatever its token interface uses.
const nativeDecimals = 18

// estimate sets the gas the wallet pays (R-216). The amount and that fee must both fit the wallet's gas-coin balance.
func (s *Service) estimate(ctx context.Context, client *ethclient.Client, out *Send, decimals int) error {
	gas, fee, wei, err := feeFor(ctx, client, out.ChainID, out.From, out.Token, out.To, out.Amount, decimals)
	if err != nil {
		return err
	}
	// Tempo has no gas coin: a transfer of a USD token pays its fee in that token unless the wallet chose another, and
	// its native balance is a placeholder (R-223).
	from := common.HexToAddress(out.From)
	chosen, tempo, err := settlement.UserFeeToken(ctx, client, from)
	if err != nil {
		return errors.Join(ErrUnavailable, err)
	}
	if tempo {
		if chosen != (common.Address{}) && chosen != common.HexToAddress(out.Token) {
			return fmt.Errorf("%w: this wallet pays Tempo fees in another token", ErrInvalid)
		}
		out.NetworkFee, out.Gas = fee, &gas
		return covers(ctx, client, *out)
	}
	held, err := client.BalanceAt(ctx, from, nil)
	if err != nil {
		return errors.Join(ErrUnavailable, fmt.Errorf("read gas balance: %w", err))
	}
	scale := new(big.Int).Exp(big.NewInt(10), big.NewInt(int64(nativeDecimals-decimals)), nil)
	if need := new(big.Int).Add(new(big.Int).Mul(out.Amount, scale), wei); held.Cmp(need) < 0 {
		return fmt.Errorf("%w: amount plus the network fee is more than the wallet holds", ErrInvalid)
	}
	out.NetworkFee, out.Gas = fee, &gas
	return nil
}

// covers checks that the wallet's token balance holds the amount plus the fee, which comes out of the same token.
func covers(ctx context.Context, client *ethclient.Client, out Send) error {
	block, err := client.BlockNumber(ctx)
	if err != nil {
		return errors.Join(ErrUnavailable, fmt.Errorf("read the latest block: %w", err))
	}
	held, err := ledger.BalanceAt(ctx, client, out.ChainID, out.Token, out.From, block)
	if err != nil {
		return errors.Join(ErrUnavailable, fmt.Errorf("read token balance: %w", err))
	}
	if need := new(big.Int).Add(out.Amount, out.NetworkFee); held.Cmp(need) < 0 {
		return fmt.Errorf("%w: amount plus the network fee is more than the wallet holds", ErrInvalid)
	}
	return nil
}

// userOpGas is what a paymaster send adds to the transfer's own gas: the EIP-4337 user operation's checks, the
// paymaster's fee pull and the bundle's overhead, L1 data included.
// ponytail: a guess with room, not a measure; set it from the first live sends' receipts.
const userOpGas = 400_000

// paymasterFee is Forwend's estimate of what Privy's paymaster takes for the send, in the token's base units, rounded
// up (R-225): the transfer's gas plus userOpGas at the chain's fee cap, in dollars at the chain's ETH/USD feed. Privy
// quotes none, so the fee really taken can differ; FeePaid records it.
func paymasterFee(ctx context.Context, client *ethclient.Client, chainID uint64, from, token, to string,
	amount *big.Int, decimals int) (*big.Int, error) {
	gas, _, _, err := feeFor(ctx, client, chainID, from, token, to, amount, decimals)
	if err != nil {
		return nil, err
	}
	price, err := chain.EthPrice(ctx, client, chainID)
	if err != nil {
		return nil, errors.Join(ErrUnavailable, err)
	}
	units := new(big.Int).Mul(gas.MaxFeePerGas, new(big.Int).SetUint64(gas.Limit+userOpGas))
	units.Mul(units, price)
	units.Mul(units, new(big.Int).Exp(big.NewInt(10), big.NewInt(int64(decimals)), nil))
	scale := new(big.Int).Exp(big.NewInt(10), big.NewInt(nativeDecimals+chain.EthUSDDecimals), nil)
	units.Add(units, new(big.Int).Sub(scale, big.NewInt(1)))
	units.Div(units, scale)
	if units.Sign() == 0 {
		units.SetInt64(1)
	}
	return units, nil
}

// feeFor is the transfer's estimated gas and a fifth more, at the chain's fee cap (settlement.Fees, R-189): the
// gas to sign with, the most it costs in the token's base units (rounded up), and in the gas coin's wei.
func feeFor(ctx context.Context, client *ethclient.Client, chainID uint64, from, token, to string, amount *big.Int,
	decimals int) (Gas, *big.Int, *big.Int, error) {
	tokenAddr := common.HexToAddress(token)
	data := append(bytes.Clone(selTransfer), common.LeftPadBytes(common.HexToAddress(to).Bytes(), 32)...)
	word := common.LeftPadBytes(amount.Bytes(), 32)
	data = append(data, word...)
	gas, err := client.EstimateGas(ctx, ethereum.CallMsg{From: common.HexToAddress(from), To: &tokenAddr, Data: data})
	if err := refused(err); err != nil {
		return Gas{}, nil, nil, err
	}
	// Priced as if every amount byte were non-zero (16 gas, not 4): the fee is then the same for any amount, so the
	// fee shown before the amount is known still covers Max.
	gas += 12 * uint64(bytes.Count(word, []byte{0}))
	gas = gas * 6 / 5
	tip, feeCap, err := settlement.Fees(ctx, client, chainID)
	if err != nil {
		return Gas{}, nil, nil, errors.Join(ErrUnavailable, err)
	}
	wei := new(big.Int).Mul(feeCap, new(big.Int).SetUint64(gas))
	scale := new(big.Int).Exp(big.NewInt(10), big.NewInt(int64(nativeDecimals-decimals)), nil)
	fee := new(big.Int).Div(new(big.Int).Add(wei, new(big.Int).Sub(scale, big.NewInt(1))), scale)
	if fee.Sign() == 0 { // a chain quoting no fee at all: a wallet-paid send still shows one unit, never Free
		fee.SetInt64(1)
	}
	return Gas{Limit: gas, MaxFeePerGas: feeCap, MaxPriorityFeePerGas: tip}, fee, wei, nil
}

// Fee is what a send of the token on the chain to the address costs the profile's wallet now, in the token's base
// units (R-216, R-225), and whether a paymaster takes it. The amount step shows it and keeps room for it in Max;
// Prepare checks it again. An empty to estimates a send to the wallet itself.
func (s *Service) Fee(ctx context.Context, profileID string, chainID uint64, token, to string) (*big.Int, bool, error) {
	var nativeGas bool
	var feeAsset *string
	var decimals int
	var wallet string
	err := s.pool.QueryRow(ctx, `
		SELECT t.native_gas, t.fee_asset, t.decimals, w.address FROM chains c JOIN tokens t ON t.chain_id = c.chain_id
		JOIN profile_wallets w ON w.profile_id = $3 AND w.chain_family = c.chain_family
		WHERE c.chain_id = $1 AND t.contract = $2 AND c.enabled AND t.enabled
		  AND c.livemode = (SELECT livemode FROM profiles WHERE id = $3)`,
		int64(chainID), strings.ToLower(token), profileID).Scan(&nativeGas, &feeAsset, &decimals, &wallet)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, false, fmt.Errorf("%w: token is not enabled on this network, or the profile has no wallet", ErrInvalid)
	} else if err != nil {
		return nil, false, fmt.Errorf("read chain: %w", err)
	}
	if !nativeGas && feeAsset == nil {
		return nil, false, fmt.Errorf("%w: this network's gas is paid in another coin, so it offers no Send yet",
			ErrInvalid)
	}
	client, err := s.client(chainID)
	if err != nil {
		return nil, false, err
	}
	if to == "" {
		to = wallet
	} else if to, err = parseAddress(to); err != nil {
		return nil, false, err
	}
	// A one-unit transfer to the recipient costs what a send of any amount will (feeFor).
	if feeAsset != nil {
		fee, err := paymasterFee(ctx, client, chainID, wallet, token, to, big.NewInt(1), decimals)
		return fee, true, err
	}
	_, fee, _, err := feeFor(ctx, client, chainID, wallet, token, to, big.NewInt(1), decimals)
	return fee, false, err
}

func gasLimit(g *Gas) *int64 {
	if g == nil {
		return nil
	}
	limit := int64(g.Limit)
	return &limit
}

func gasValue(g *Gas, of func(*Gas) *big.Int) *string {
	if g == nil {
		return nil
	}
	v := of(g).String()
	return &v
}
