// Package send checks a send out of a profile wallet before the browser signs it, and follows it to the chain
// (R-211, R-212, D-119). The server never signs for a user's wallet (D-46): a send whose fee a paymaster takes is a
// Privy request the user's key signs, which the server only sends on (R-225).
package send

import (
	"errors"
	"math/big"
	"sync"
	"time"

	"github.com/ethereum/go-ethereum/ethclient"
	"github.com/forwend/forwend/apps/backend/internal/privy"
	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	// ErrInvalid wraps a request value that breaks a rule; the message names it.
	ErrInvalid  = errors.New("invalid send")
	ErrNotFound = errors.New("send not found")
	// ErrBusy: the wallet has a send on its way on this chain; the next one waits for it.
	ErrBusy = errors.New("a send from this wallet is on its way")
	// ErrApproved: the send was approved already, so it may have been signed; signing it again needs a new summary.
	ErrApproved = errors.New("this send was approved already")
	// ErrRefused: the token's dry run of the transfer failed, as when an address is blocked or the token is paused.
	ErrRefused = errors.New("the token refuses this transfer")
	// ErrUnavailable: the chain can't be read just now.
	ErrUnavailable = errors.New("could not read the network")
)

type Status string

const (
	Prepared Status = "prepared"
	// Approved: Confirm it's you passed and the browser may sign it, once (R-211).
	Approved  Status = "approved"
	Submitted Status = "submitted"
	Sent      Status = "sent"
	Failed    Status = "failed"
	Canceled  Status = "canceled"
	Expired   Status = "expired"
)

type Warning string

const (
	// The recipient has code that isn't a wallet's EIP-7702 delegation: it may not be able to move the money on.
	WarnContract Warning = "contract"
	// This wallet has never sent to the address.
	WarnNewRecipient Warning = "newRecipient"
)

const (
	// A prepared send the browser never reported is given up after this.
	PrepareTTL = 10 * time.Minute
	// An approved send the browser never reported holds its wallet this long: its signature may have gone out though
	// the answer was lost. The watcher records such a transfer well within it.
	ApproveHold = 2 * time.Minute
	// A reported hash with no transaction on the chain after this is given up as dropped.
	DropAfter = 30 * time.Minute
	// RelayGiveUp: a relayed send Privy can't be read for, and that has no hash, ends after this.
	RelayGiveUp = 24 * time.Hour
	// relayBudget bounds Relay: Privy's answer, then the wait for its hash.
	relayBudget = 25 * time.Second
	// Before this the chain is not asked for the receipt: the watcher usually records the transfer first.
	receiptAfter = 15 * time.Second
	// A send sheet polls every 1.5 s; the chain is asked for a send's receipt at most this often, to spare the api's
	// RPC budget.
	receiptEvery = 5 * time.Second
)

type Send struct {
	ID          string
	ProfileID   string
	ChainID     uint64
	Token       string
	Symbol      string
	Decimals    int
	From        string
	To          string
	ToProfileID *string
	Amount      *big.Int
	Status      Status
	// OnChain: a submitted send whose transfer the watcher has seen in a block that isn't final yet.
	OnChain     bool
	TxHash      *string
	Failure     *string
	CreatedAt   time.Time
	ApprovedAt  *time.Time
	SubmittedAt *time.Time
	FinishedAt  *time.Time
	// NetworkFee is what the wallet pays for gas, in the token's base units (D-119): the most it pays where it signs
	// with Gas, Forwend's estimate where a paymaster takes it, 0 for a send Forwend sponsored before D-121.
	NetworkFee *big.Int
	// Gas is what the browser signs with when the wallet pays its gas coin; nil otherwise.
	Gas *Gas
	// FeeAsset is the Privy asset a paymaster takes the fee in (R-225); nil otherwise.
	FeeAsset *string
	// RelayID is Privy's transaction id for a send it carries; only Privy gives its hash.
	RelayID *string
	// Relay is set by Approve where FeeAsset is: the request the user's key signs.
	Relay *privy.Request
	// walletID is the wallet's Privy id.
	walletID string
	// FeePaid is what the wallet really paid for gas once the send was mined, in the token's base units: 0 for a send
	// Forwend sponsored, nil until known (R-224).
	FeePaid *big.Int
	// Warnings are set by Prepare only.
	Warnings []Warning
}

// Gas caps a send the wallet pays for (R-216): at these values the fee is at most NetworkFee.
type Gas struct {
	Limit                uint64
	MaxFeePerGas         *big.Int
	MaxPriorityFeePerGas *big.Int
}

// Clients gives the RPC client of an enabled chain.
type Clients func(chainID uint64) (*ethclient.Client, error)

type Service struct {
	pool    *pgxpool.Pool
	clients Clients
	privy   *privy.Client
	now     func() time.Time
	// relayWait is how long Relay asks Privy for the hash before it answers.
	relayWait time.Duration
	mu        sync.Mutex
	// receiptReads holds, per send ID, when its receipt was last asked for within receiptEvery.
	receiptReads map[string]time.Time
}

func NewService(pool *pgxpool.Pool, clients Clients, privy *privy.Client) *Service {
	return &Service{pool: pool, clients: clients, privy: privy, now: time.Now, relayWait: 10 * time.Second,
		receiptReads: map[string]time.Time{}}
}

// receiptDue reports whether the send's receipt may be read now, and if so counts this read.
func (s *Service) receiptDue(id string, now time.Time) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	if last, ok := s.receiptReads[id]; ok && now.Sub(last) < receiptEvery {
		return false
	}
	for k, last := range s.receiptReads {
		if now.Sub(last) >= receiptEvery {
			delete(s.receiptReads, k)
		}
	}
	s.receiptReads[id] = now
	return true
}

func (s *Service) client(chainID uint64) (*ethclient.Client, error) {
	if s.clients == nil {
		return nil, ErrUnavailable
	}
	c, err := s.clients(chainID)
	if err != nil {
		return nil, errors.Join(ErrUnavailable, err)
	}
	return c, nil
}
