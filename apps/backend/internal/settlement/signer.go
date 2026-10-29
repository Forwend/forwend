// Package settlement is the signer: it settles each paid invoice once with the executor key, after checking the terms
// against the database and the chain (R-22). It signs only deploy, settle and a self-transfer that fills a nonce gap.
package settlement

import (
	"context"
	"crypto/ecdsa"
	"errors"
	"fmt"
	"log/slog"
	"math/big"
	"sync"
	"time"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/ethereum/go-ethereum/ethclient"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// AttemptTimeout bounds one intent's work, so a provider that stops answering can't stall every other intent.
const AttemptTimeout = 3 * time.Minute

// LockKey is the signer's Postgres advisory lock: one signer runs at a time, since two would race for nonces.
const LockKey int64 = 0x666f7277656e6402 // "forwend" 2

// errStopped ends a run early in tests that simulate the signer being killed.
var errStopped = errors.New("signer stopped")

// Run one Signer per executor key: two would race for nonces.
type Signer struct {
	pool    *pgxpool.Pool
	key     *ecdsa.PrivateKey
	sender  common.Address
	clients map[uint64]*ethclient.Client
	// stopAfter simulates a crash in tests: "save" stops after the signed settle is saved, "send" after it is sent.
	stopAfter      string
	attemptTimeout time.Duration
	codeWait       time.Duration
	replaceAfter   time.Duration
	// held reports whether this signer still holds its lock (D-71): checked before each intent, since a round can
	// outlast a dropped lock connection.
	held  func(context.Context) error
	users *userTurns
	// gasCheckedAt paces the executor's gas check: a drain shows long before the signer can't pay a settle.
	gasCheckedAt time.Time
}

func NewSigner(pool *pgxpool.Pool, key *ecdsa.PrivateKey, clients map[uint64]*ethclient.Client) *Signer {
	return &Signer{pool: pool, key: key, sender: crypto.PubkeyToAddress(key.PublicKey), clients: clients,
		attemptTimeout: AttemptTimeout, codeWait: CodeWait, replaceAfter: ReplaceAfter, users: &userTurns{}}
}

type intent struct {
	id                 int64
	status             string
	sender             *string
	nonce              *int64
	txHash             *string
	rawTx              []byte
	replaced           []string // hashes of earlier versions of the saved settle, same nonce
	signedAt           time.Time
	invoiceID, payment string
	chainID            uint64
	token, recipient   string
	factory, receive   string
	wallet             *string
	amount             *big.Int
	expires, deadline  uint64
}

// Run serves only the chains this signer has a client for; one intent's failure doesn't stop the others.
func (s *Signer) Run(ctx context.Context) error {
	if time.Since(s.gasCheckedAt) >= GasCheckEvery {
		s.gasCheckedAt = time.Now()
		for id, client := range s.clients {
			checkCtx, cancel := context.WithTimeout(ctx, s.attemptTimeout) // a hanging RPC must not stall the round
			if err := checkGas(checkCtx, client, id, s.sender, GasAlertSettlements); errors.Is(err, errFundIt) {
				slog.Error("ALERT executor gas runs low", "chain", id, "err", err.Error())
			}
			cancel()
		}
	}
	chains := make([]int64, 0, len(s.clients))
	for id := range s.clients {
		chains = append(chains, int64(id))
	}
	rows, err := s.pool.Query(ctx, `SELECT si.id, p.user_id::text, si.status FROM settlement_intents si JOIN invoices i ON i.id = si.invoice_id
		JOIN profiles p ON p.id = i.profile_id
		WHERE si.status IN ('pending', 'sent') AND si.next_attempt_at <= now() AND i.chain_id = ANY($1)
		ORDER BY si.id`, chains)
	if err != nil {
		return fmt.Errorf("list settlement intents: %w", err)
	}
	type work struct {
		ID     int64
		User   string
		Status string
	}
	ids, err := pgx.CollectRows(rows, pgx.RowToStructByPos[work])
	if err != nil {
		return fmt.Errorf("list settlement intents: %w", err)
	}
	var errs []error
	for _, item := range ids {
		id := item.ID
		if s.held != nil {
			if err := s.held(ctx); err != nil {
				return errors.Join(append(errs, err)...)
			}
		}
		attempt, cancel := context.WithTimeout(ctx, s.attemptTimeout)
		release := func() {}
		var err error
		if item.Status == "pending" {
			release, err = s.users.take(attempt, item.User)
		}
		if err == nil {
			release = sync.OnceFunc(release)
			if s.held != nil {
				err = s.held(attempt)
			}
			if err == nil {
				err = s.settle(attempt, id, release)
			}
			release()
		}
		cancel()
		if errors.Is(err, errStopped) {
			return err
		}
		if err != nil {
			errs = append(errs, fmt.Errorf("settlement intent %d: %w", id, err))
			// An RPC or database error: wait before the next try instead of hammering every run.
			if _, werr := s.pool.Exec(ctx, `UPDATE settlement_intents SET next_attempt_at = now() + interval '30 seconds'
				WHERE id = $1 AND status IN ('pending', 'sent')`, id); werr != nil {
				errs = append(errs, werr)
			}
		}
	}
	return errors.Join(errs...)
}

func (s *Signer) load(ctx context.Context, id int64) (intent, error) {
	var in intent
	var amount string
	err := s.pool.QueryRow(ctx, `
		SELECT si.id, si.status, si.sender, si.nonce, si.tx_hash, si.raw_tx, si.replaced_hashes,
		       coalesce(si.signed_at, si.updated_at), i.id, i.payment_status, i.chain_id, i.token_contract,
		       i.recipient_address, i.factory_address, i.receive_address,
		       (SELECT w.address FROM profile_wallets w WHERE w.profile_id = i.profile_id AND w.chain_family = i.chain_family),
		       i.amount::text, i.expires_at, i.settle_deadline
		FROM settlement_intents si JOIN invoices i ON i.id = si.invoice_id WHERE si.id = $1`, id).Scan(
		&in.id, &in.status, &in.sender, &in.nonce, &in.txHash, &in.rawTx, &in.replaced, &in.signedAt, &in.invoiceID,
		&in.payment, &in.chainID, &in.token, &in.recipient, &in.factory, &in.receive, &in.wallet, &amount, &in.expires, &in.deadline)
	if err != nil {
		return intent{}, fmt.Errorf("read settlement intent %d: %w", id, err)
	}
	in.amount, _ = new(big.Int).SetString(amount, 10)
	return in, nil
}
