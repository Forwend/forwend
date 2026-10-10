// Package settlement is the signer: it settles each paid invoice once, with the executor key, after checking the
// terms against the database and the chain (R-22). It signs only factory.deploy(terms) and receiver.settle().
package settlement

import (
	"context"
	"crypto/ecdsa"
	"errors"
	"fmt"
	"math/big"
	"time"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/ethereum/go-ethereum/ethclient"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// AttemptTimeout bounds one intent's work, so a provider that stops answering can't stall every other intent.
const AttemptTimeout = 3 * time.Minute

// errStopped ends a run early in tests that simulate the signer being killed.
var errStopped = errors.New("signer stopped")

// Signer runs settlement intents. Run one Signer per executor key: two would race for nonces.
type Signer struct {
	pool    *pgxpool.Pool
	key     *ecdsa.PrivateKey
	sender  common.Address
	clients map[uint64]*ethclient.Client
	// stopAfter simulates a crash in tests: "save" stops after the signed settle is saved, "send" after it is sent.
	stopAfter      string
	attemptTimeout time.Duration
	codeWait       time.Duration
}

func NewSigner(pool *pgxpool.Pool, key *ecdsa.PrivateKey, clients map[uint64]*ethclient.Client) *Signer {
	return &Signer{pool: pool, key: key, sender: crypto.PubkeyToAddress(key.PublicKey), clients: clients,
		attemptTimeout: AttemptTimeout, codeWait: CodeWait}
}

// intent is one settlement intent with its invoice's terms.
type intent struct {
	id                 int64
	status             string
	sender             *string
	nonce              *int64
	txHash             *string
	rawTx              []byte
	invoiceID, payment string
	chainID            uint64
	token, recipient   string
	factory, receive   string
	wallet             *string
	amount             *big.Int
	expires, deadline  uint64
}

// Run works through every due pending or sent intent on the chains this signer serves (those with a client).
// One intent's failure doesn't stop the others.
func (s *Signer) Run(ctx context.Context) error {
	chains := make([]int64, 0, len(s.clients))
	for id := range s.clients {
		chains = append(chains, int64(id))
	}
	rows, err := s.pool.Query(ctx, `SELECT si.id FROM settlement_intents si JOIN invoices i ON i.id = si.invoice_id
		WHERE si.status IN ('pending', 'sent') AND si.next_attempt_at <= now() AND i.chain_id = ANY($1)
		ORDER BY si.id`, chains)
	if err != nil {
		return fmt.Errorf("list settlement intents: %w", err)
	}
	ids, err := pgx.CollectRows(rows, pgx.RowTo[int64])
	if err != nil {
		return fmt.Errorf("list settlement intents: %w", err)
	}
	var errs []error
	for _, id := range ids {
		attempt, cancel := context.WithTimeout(ctx, s.attemptTimeout)
		err := s.settle(attempt, id)
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
		SELECT si.id, si.status, si.sender, si.nonce, si.tx_hash, si.raw_tx, i.id, i.payment_status, i.chain_id, i.token_contract,
		       i.recipient_address, i.factory_address, i.receive_address,
		       (SELECT w.address FROM profile_wallets w WHERE w.profile_id = i.profile_id AND w.chain_family = i.chain_family),
		       i.amount::text, i.expires_at, i.settle_deadline
		FROM settlement_intents si JOIN invoices i ON i.id = si.invoice_id WHERE si.id = $1`, id).Scan(
		&in.id, &in.status, &in.sender, &in.nonce, &in.txHash, &in.rawTx, &in.invoiceID, &in.payment, &in.chainID, &in.token,
		&in.recipient, &in.factory, &in.receive, &in.wallet, &amount, &in.expires, &in.deadline)
	if err != nil {
		return intent{}, fmt.Errorf("read settlement intent %d: %w", id, err)
	}
	in.amount, _ = new(big.Int).SetString(amount, 10)
	return in, nil
}
