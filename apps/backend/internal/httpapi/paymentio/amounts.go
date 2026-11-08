package paymentio

import (
	"math/big"

	"github.com/forwend/forwend/apps/backend/internal/httpapi/httpio"
	"github.com/forwend/forwend/apps/backend/internal/invoice"
	"github.com/forwend/forwend/apps/backend/internal/ledger"
)

// Fees are an option's fees, who pays them, and what the owner receives of the amount (R-228).
type Fees struct {
	NetworkFee  string `json:"networkFee"`
	PlatformFee string `json:"platformFee"`
	NetAmount   string `json:"netAmount"`
	FeesPaidBy  string `json:"feesPaidBy"`
}

func FromFees(amount *big.Int, f invoice.Fees) Fees {
	return Fees{NetworkFee: f.Network.String(), PlatformFee: f.Platform.String(), NetAmount: f.Net(amount).String(),
		FeesPaidBy: f.PaidBy}
}

type Amounts struct {
	ReconciliationStatus ledger.ReconciliationStatus `json:"reconciliationStatus"`
	Receiver             string                      `json:"receiver"`
	Payable              string                      `json:"payable"`
	Held                 string                      `json:"held"`
	Settled              string                      `json:"settled"`
	Fees                 string                      `json:"fees"`
	Refunded             string                      `json:"refunded"`
	ObservedRefunded     string                      `json:"observedRefunded"`
	LastReturnTxHash     *string                     `json:"lastReturnTxHash"`
	Unreconciled         bool                        `json:"unreconciled"`
	HasPolicyException   bool                        `json:"hasPolicyException"`
}

func FromAmounts(a *ledger.Amounts) *Amounts {
	if a == nil {
		return nil
	}
	return &Amounts{ReconciliationStatus: a.ReconciliationStatus, Receiver: a.Receiver.String(), Payable: a.Payable.String(), Held: a.Held.String(), Settled: a.Settled.String(),
		Fees: a.Fees.String(), Refunded: a.Refunded.String(), ObservedRefunded: a.ObservedRefunded.String(), LastReturnTxHash: httpio.OrNull(a.LastReturnTxHash), Unreconciled: a.Unreconciled, HasPolicyException: a.HasPolicyException}
}
