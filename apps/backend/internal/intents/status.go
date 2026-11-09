package intents

import (
	"context"
	"encoding/json"
	"fmt"
	"net/url"
	"regexp"
	"slices"
	"time"
)

// 1Click's swap statuses. Success, Refunded and Failed are final.
const (
	PendingDeposit    = "PENDING_DEPOSIT"
	KnownDepositTx    = "KNOWN_DEPOSIT_TX"
	IncompleteDeposit = "INCOMPLETE_DEPOSIT"
	Processing        = "PROCESSING"
	Success           = "SUCCESS"
	Refunded          = "REFUNDED"
	Failed            = "FAILED"
)

var statuses = []string{PendingDeposit, KnownDepositTx, IncompleteDeposit, Processing, Success, Refunded, Failed}

// Tx is a transaction 1Click names, with its explorer link: https only, so an owner's page never opens another scheme.
type Tx struct {
	Hash        string `json:"hash"`
	ExplorerURL string `json:"explorerUrl"`
}

// Status is what 1Click says happened to a deposit address's swap. An amount is "" until 1Click knows it.
type Status struct {
	Status                         string
	UpdatedAt                      time.Time
	Deposited, Delivered, Refunded string
	RefundReason                   string
	OriginTxs, DestinationTxs      []Tx
}

var (
	baseUnits  = regexp.MustCompile(`^[0-9]{1,78}$`)
	txHash     = regexp.MustCompile(`^[A-Za-z0-9:_-]{1,200}$`)
	reasonText = regexp.MustCompile(`^[A-Z0-9_]{1,64}$`)
)

// Status reads 1Click's status of the swap at depositAddress. It is for showing progress only: paid still comes from
// the Base balance (R-119, R-234).
func (c *Client) Status(ctx context.Context, depositAddress string) (Status, error) {
	answer, err := c.call(ctx, "GET", "/v0/status?depositAddress="+url.QueryEscape(depositAddress), nil)
	if err != nil {
		return Status{}, err
	}
	var a struct {
		Status      string    `json:"status"`
		UpdatedAt   time.Time `json:"updatedAt"`
		SwapDetails struct {
			DepositedAmount          *string `json:"depositedAmount"`
			AmountOut                *string `json:"amountOut"`
			RefundedAmount           *string `json:"refundedAmount"`
			RefundReason             *string `json:"refundReason"`
			OriginChainTxHashes      []Tx    `json:"originChainTxHashes"`
			DestinationChainTxHashes []Tx    `json:"destinationChainTxHashes"`
		} `json:"swapDetails"`
	}
	if err := json.Unmarshal(answer, &a); err != nil || !slices.Contains(statuses, a.Status) {
		return Status{}, fmt.Errorf("%w: status answer", errUnavailable)
	}
	d := a.SwapDetails
	s := Status{Status: a.Status, UpdatedAt: a.UpdatedAt, Deposited: amount(d.DepositedAmount),
		Delivered: amount(d.AmountOut), Refunded: amount(d.RefundedAmount), OriginTxs: txs(d.OriginChainTxHashes),
		DestinationTxs: txs(d.DestinationChainTxHashes)}
	if d.RefundReason != nil && reasonText.MatchString(*d.RefundReason) {
		s.RefundReason = *d.RefundReason
	}
	return s, nil
}

func amount(s *string) string {
	if s == nil || !baseUnits.MatchString(*s) {
		return ""
	}
	return *s
}

// txs keeps at most 10 well-formed transactions; a link that isn't https is dropped, the hash kept.
func txs(in []Tx) []Tx {
	out := []Tx{}
	for _, t := range in {
		if len(out) == 10 || !txHash.MatchString(t.Hash) {
			continue
		}
		if u, err := url.Parse(t.ExplorerURL); err != nil || u.Scheme != "https" || u.Host == "" || len(t.ExplorerURL) > 500 {
			t.ExplorerURL = ""
		}
		out = append(out, t)
	}
	return out
}

// Final reports whether 1Click is done with a swap.
func Final(status string) bool { return status == Success || status == Refunded || status == Failed }

// DepositSeen reports whether 1Click saw the payer's deposit.
func DepositSeen(status string) bool { return status != PendingDeposit }
