package ledger

import (
	"context"
	"fmt"
	"log/slog"
	"math/big"
	"time"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/ethereum/go-ethereum/ethclient"
	"github.com/forwend/forwend/apps/backend/internal/chain"
	"github.com/jackc/pgx/v5"
)

const BalanceTimeout = 10 * time.Second

// BalanceOf reads from an RPC other than the watcher's, at its finalized block, so one bad provider can't mark an
// invoice paid (D-15, D-45). An answer from behind the watcher's finalized block can miss deposits and is not used.
type BalanceOf func(ctx context.Context, chainID uint64, token, holder string) (balance *big.Int, block uint64, err error)

// BalanceFrom reads balances with one client per chain: give it RPCs other than the watcher's (D-15).
func BalanceFrom(clients map[uint64]*ethclient.Client) BalanceOf {
	// Every RPC in the chain list serves eth_call at its finalized block.
	return func(ctx context.Context, chainID uint64, token, holder string) (*big.Int, uint64, error) {
		client, ok := clients[chainID]
		if !ok {
			return nil, 0, fmt.Errorf("no balance RPC for chain %d", chainID)
		}
		return BalanceSnapshot(client)(ctx, chainID, token, holder)
	}
}

// BalanceSnapshot shares the selected provider's finalized header within one sequential ledger round.
// A new round gets a new snapshot; failed header reads are never kept.
func BalanceSnapshot(client *ethclient.Client) BalanceOf {
	var block *chain.Block
	return func(ctx context.Context, chainID uint64, token, holder string) (*big.Int, uint64, error) {
		if block == nil {
			head, err := chain.Finalized(ctx, client)
			if err != nil {
				return nil, 0, fmt.Errorf("read chain %d finalized block: %w", chainID, err)
			}
			block = &head
		}
		value, err := chain.TokenBalanceAtHash(ctx, client, chainID, token, holder, block.Hash)
		return value, block.Number, err
	}
}

// DeployedAt reads factory.deployedAt(receiver) at the finalized block: 0 when the receiver is not deployed. An early
// deploy, a refund authority recovery, ends the receiver's settle window at deployedAt + 30 days (R-130).
type DeployedAt func(ctx context.Context, chainID uint64, factory, receiver string) (uint64, error)

// DeployedFrom reads with BalanceFrom's clients, the RPC pool per chain.
func DeployedFrom(clients map[uint64]*ethclient.Client) DeployedAt {
	return func(ctx context.Context, chainID uint64, factory, receiver string) (uint64, error) {
		client, ok := clients[chainID]
		if !ok {
			return 0, fmt.Errorf("no deployedAt RPC for chain %d", chainID)
		}
		final, err := chain.Finalized(ctx, client)
		if err != nil {
			return 0, fmt.Errorf("deployedAt %s on chain %d: read finalized block: %w", receiver, chainID, err)
		}
		to := common.HexToAddress(factory)
		data := append(crypto.Keccak256([]byte("deployedAt(address)"))[:4],
			common.LeftPadBytes(common.HexToAddress(receiver).Bytes(), 32)...)
		out, err := chain.CallAtHash(ctx, client, to, data, final.Hash)
		if err != nil {
			return 0, fmt.Errorf("deployedAt %s on chain %d: %w", receiver, chainID, err)
		}
		// Empty means no factory there: never read as "not deployed".
		if len(out) != 32 {
			return 0, fmt.Errorf("deployedAt %s on chain %d: %d-byte answer", receiver, chainID, len(out))
		}
		return new(big.Int).SetBytes(out).Uint64(), nil
	}
}

// funded asks the selected RPC whether the receive address holds at least every booked deposit (D-15).
func (s *Service) funded(ctx context.Context, tx pgx.Tx, invoiceID string, chainID, finalized uint64, token, receive string) (bool, error) {
	booked, onChain, block, err := s.compare(ctx, tx, invoiceID, chainID, finalized, token, receive)
	if err != nil || onChain == nil {
		return false, err
	}
	if onChain.Cmp(booked) < 0 {
		slog.Warn("receive address holds less than booked; not paid", "invoice", invoiceID,
			"booked", booked.String(), "onChain", onChain.String())
		return false, nil
	}
	return true, Unbooked(ctx, tx, invoiceID, booked, onChain, block)
}

// Unbooked alerts when the receive address holds at least DustExcess more than booked while every transfer the scan saw
// is booked: a deposit the scan missed. Its excess alert holds the invoice's refunds (bookOutflow), never "paid" or the
// settle: settle pays out only the amount, and the rest stays held for its payer. A balance read at a block the scan
// hasn't reached yet can show a deposit it will still record, so it says nothing.
func Unbooked(ctx context.Context, tx pgx.Tx, invoiceID string, booked, onChain *big.Int, block uint64) error {
	if onChain.Cmp(booked) <= 0 {
		return nil
	}
	var missed bool
	var decimals int
	if err := tx.QueryRow(ctx, `SELECT c.last_finalized_block >= $2 AND NOT EXISTS (SELECT 1 FROM chain_transfers t
		    WHERE t.invoice_id = i.id AND t.status <> 'reorged' AND NOT t.booked), tk.decimals
		FROM invoices i JOIN chain_cursors c ON c.chain_id = i.chain_id
		JOIN tokens tk ON tk.chain_id = i.chain_id AND tk.contract = i.token_contract WHERE i.id = $1`, invoiceID,
		int64(block)).Scan(&missed, &decimals); err != nil || !missed ||
		new(big.Int).Sub(onChain, booked).Cmp(DustExcess(decimals)) < 0 {
		return err
	}
	slog.Error("ALERT receive address holds money with no booked transfer", "invoice", invoiceID,
		"booked", booked.String(), "onChain", onChain.String(),
		"next", "record the deposit with ops deposit -tx <transaction> <invoice>, then return it with ops return")
	return alertAgainLater(ctx, tx, invoiceID, true)
}

// DustExcess: an unexplained balance under 0.01 of a token with these decimals (one base unit when it has fewer than
// 2) doesn't stop expiry. Arc floors each native transfer but balanceOf floors their sum, so sub-micro sends leave dust
// no transfer explains, and anyone could send some to keep an invoice open for good. The dust stays for the Safe.
func DustExcess(decimals int) *big.Int {
	return new(big.Int).Exp(big.NewInt(10), big.NewInt(int64(max(decimals-2, 0))), nil)
}

// balanced asks the selected RPC whether the receive address holds exactly what is booked.
func (s *Service) balanced(ctx context.Context, tx pgx.Tx, invoiceID string, chainID, finalized uint64, token, receive string) (bool, error) {
	var waiting bool
	if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM invoice_balance_alerts WHERE invoice_id = $1
		AND next_check_at > now())`, invoiceID).Scan(&waiting); err != nil || waiting {
		return false, err
	}
	booked, onChain, _, err := s.compare(ctx, tx, invoiceID, chainID, finalized, token, receive)
	if err != nil || onChain == nil {
		return false, err
	}
	excess := new(big.Int).Sub(onChain, booked)
	var decimals int
	if excess.Sign() > 0 {
		if err := tx.QueryRow(ctx, "SELECT decimals FROM tokens WHERE chain_id = $1 AND contract = $2", int64(chainID),
			token).Scan(&decimals); err != nil {
			return false, fmt.Errorf("read invoice %s token decimals: %w", invoiceID, err)
		}
	}
	if excess.Cmp(DustExcess(decimals)) >= 0 {
		// A deposit the watcher never saw: an operator records it, then returns it (money-safety.md).
		slog.Error("ALERT receive address holds money with no booked transfer; not expiring", "invoice", invoiceID,
			"booked", booked.String(), "onChain", onChain.String(),
			"next", "record the deposit with ops deposit -tx <transaction> <invoice>, then return it with ops return")
		return false, alertAgainLater(ctx, tx, invoiceID, true)
	} else if excess.Sign() > 0 {
		slog.Warn("receive address holds dust no transfer explains; expiring", "invoice", invoiceID,
			"booked", booked.String(), "onChain", onChain.String())
	}
	if onChain.Cmp(booked) < 0 {
		slog.Error("ALERT receive address holds less than booked; not expiring", "invoice", invoiceID,
			"booked", booked.String(), "onChain", onChain.String())
		return false, alertAgainLater(ctx, tx, invoiceID, false)
	}
	if _, err := tx.Exec(ctx, "DELETE FROM invoice_balance_alerts WHERE invoice_id = $1", invoiceID); err != nil {
		return false, fmt.Errorf("clear invoice %s balance alert: %w", invoiceID, err)
	}
	return true, nil
}

// Backs off 1 min, doubling to at most a day, so unexplained balances can't use up the round's RPC calls (R-120).
// The exponent stops at 11 (34 h, over the cap): a larger one overflows Postgres's interval. excess is more on chain
// than booked: refunds of the invoice wait while it lasts (bookOutflow).
func alertAgainLater(ctx context.Context, tx pgx.Tx, invoiceID string, excess bool) error {
	if _, err := tx.Exec(ctx, `INSERT INTO invoice_balance_alerts (invoice_id, alerts, next_check_at, excess)
		VALUES ($1, 1, now() + interval '1 minute', $2)
		ON CONFLICT (invoice_id) DO UPDATE SET alerts = invoice_balance_alerts.alerts + 1, excess = excluded.excess,
		    next_check_at = now() + least(interval '1 minute' * power(2, least(invoice_balance_alerts.alerts, 11)),
		        interval '1 day')`,
		invoiceID, excess); err != nil {
		return fmt.Errorf("record invoice %s balance alert: %w", invoiceID, err)
	}
	return nil
}

// onChain is nil when the RPC snapshot is behind the watcher's finalized block: nothing is decided until it catches up.
// ponytail: the RPC call runs inside the transaction holding the invoice lock, bounded by BalanceTimeout.
func (s *Service) compare(ctx context.Context, tx pgx.Tx, invoiceID string, chainID, finalized uint64, token, receive string) (booked, onChain *big.Int, block uint64, err error) {
	if booked, err = accountBalance(ctx, tx, invoiceID, "receiver"); err != nil {
		return nil, nil, 0, err
	}
	ctx, cancel := context.WithTimeout(ctx, BalanceTimeout)
	defer cancel()
	onChain, block, err = s.balance(ctx, chainID, token, receive)
	if err != nil {
		return nil, nil, 0, fmt.Errorf("check invoice %s balance: %w", invoiceID, err)
	}
	if block < finalized {
		slog.Warn("RPC snapshot is behind the finalized block; deciding later", "invoice", invoiceID,
			"rpcBlock", block, "finalized", finalized)
		return booked, nil, block, nil
	}
	return booked, onChain, block, nil
}
