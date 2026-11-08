// Package send checks a send out of a profile wallet before the browser signs it, and follows it to the chain
// (R-211, R-212, D-119). The server never signs for a user's wallet (D-46).
package send

import (
	"errors"
	"math/big"
	"time"

	"github.com/ethereum/go-ethereum/ethclient"
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
	// Before this the chain is not asked for the receipt: the watcher usually records the transfer first.
	receiptAfter = 15 * time.Second
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
	// NetworkFee is the most the wallet pays for gas, in the token's base units: 0 where Forwend pays (D-119).
	NetworkFee *big.Int
	// Gas is what the browser signs with when the wallet pays; nil where Forwend pays.
	Gas *Gas
	// FeePaid is what the wallet really paid for gas once the send was mined, in the token's base units: 0 where
	// Forwend pays, nil until known (R-224).
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
	now     func() time.Time
}

func NewService(pool *pgxpool.Pool, clients Clients) *Service {
	return &Service{pool: pool, clients: clients, now: time.Now}
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
