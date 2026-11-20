// Package send checks a profile wallet's send before the browser signs it, then follows it; the server never signs.
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
	ErrRefused     = errors.New("the token refuses this transfer")
	ErrUnavailable = errors.New("could not read the network")
)

type Status string

const (
	Prepared Status = "prepared"
	// Approved: Confirm it's you passed and the browser may sign it, once.
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
	WarnContract     Warning = "contract"
	WarnNewRecipient Warning = "newRecipient"
)

const (
	// A prepared send the browser never reported is given up after this.
	PrepareTTL = 10 * time.Minute
	// An approved send the browser never reported holds its wallet this long: its signature may have gone out.
	ApproveHold = 2 * time.Minute
	// A reported hash with no transaction on the chain after this is given up as dropped.
	DropAfter = 30 * time.Minute
	// RelayGiveUp: a relayed send Privy can't be read for, and that has no hash, ends after this.
	RelayGiveUp = 24 * time.Hour
	// relayBudget bounds Relay: Privy's answer, then the wait for its hash.
	relayBudget = 25 * time.Second
	// Before this the chain is not asked for the receipt: the watcher usually records the transfer first.
	receiptAfter = 15 * time.Second
	// The chain is asked for a send's receipt at most this often (sheets poll every 1.5 s), to spare the RPC budget.
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
	OnChain     bool // seen in a block that isn't final yet
	TxHash      *string
	Failure     *string
	CreatedAt   time.Time
	ApprovedAt  *time.Time
	SubmittedAt *time.Time
	FinishedAt  *time.Time
	NetworkFee  *big.Int // token base units; 0: Forwend sponsored
	Gas         *Gas     // nil unless the wallet pays its gas coin
	FeeAsset    *string  // Privy asset a paymaster takes; else nil
	RelayID     *string
	Relay       *privy.Request // set by Approve where FeeAsset is
	walletID    string
	FeePaid     *big.Int // once mined; 0: sponsored, nil: unknown
	Warnings    []Warning
}

// Gas caps a send the wallet pays for: at these values the fee is at most NetworkFee.
type Gas struct {
	Limit                uint64
	MaxFeePerGas         *big.Int
	MaxPriorityFeePerGas *big.Int
}

type Clients func(chainID uint64) (*ethclient.Client, error)

type Service struct {
	pool         *pgxpool.Pool
	clients      Clients
	privy        *privy.Client
	now          func() time.Time
	relayWait    time.Duration
	mu           sync.Mutex
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
