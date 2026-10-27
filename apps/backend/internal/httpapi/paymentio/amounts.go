package paymentio

import (
	"github.com/forwend/forwend/apps/backend/internal/httpapi/httpio"
	"github.com/forwend/forwend/apps/backend/internal/ledger"
)

type Amounts struct {
	ReconciliationStatus ledger.ReconciliationStatus `json:"reconciliationStatus"`
	Receiver             string                      `json:"receiver"`
	Payable              string                      `json:"payable"`
	Held                 string                      `json:"held"`
	Settled              string                      `json:"settled"`
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
		Refunded: a.Refunded.String(), ObservedRefunded: a.ObservedRefunded.String(), LastReturnTxHash: httpio.OrNull(a.LastReturnTxHash), Unreconciled: a.Unreconciled, HasPolicyException: a.HasPolicyException}
}
