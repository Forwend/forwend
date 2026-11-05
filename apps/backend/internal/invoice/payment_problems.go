package invoice

import (
	"math/big"
	"time"

	"github.com/forwend/forwend/apps/backend/internal/chain"
	"github.com/forwend/forwend/apps/backend/internal/ledger"
)

type PaymentProblemCode string
type PaymentAction string

const (
	ProblemVerification      PaymentProblemCode = "verification_pending"
	ProblemReconciliation    PaymentProblemCode = "reconciliation_required"
	ProblemPartialPayment    PaymentProblemCode = "partial_payment"
	ProblemHeldFunds         PaymentProblemCode = "held_funds"
	ProblemOutflowUnbooked   PaymentProblemCode = "outflow_unreconciled"
	ProblemPolicyException   PaymentProblemCode = "funds_movement_exception"
	ProblemSettlementDelayed PaymentProblemCode = "settlement_delayed"
	ProblemSettlementRefused PaymentProblemCode = "settlement_refused"
	ProblemWebhookDelivery   PaymentProblemCode = "webhook_delivery"
	ActionWait               PaymentAction      = "wait"
	ActionShareCheckout      PaymentAction      = "share_checkout"
	ActionReviewFunds        PaymentAction      = "review_funds"
	ActionReviewSettlement   PaymentAction      = "review_settlement"
	ActionReviewWebhooks     PaymentAction      = "review_webhooks"
	ActionAskAdmin           PaymentAction      = "ask_admin"
)

const SettlementAttentionAfter = 15 * time.Minute

type PaymentProblem struct {
	Code                                  PaymentProblemCode
	Action                                PaymentAction
	OptionID, EndpointID, EventID, Reason string
	Asset                                 *chain.Asset
	Amount                                *big.Int
}

func optionProblems(inv Invoice, option PaymentOption, at time.Time) []PaymentProblem {
	var result []PaymentProblem
	add := func(code PaymentProblemCode, action PaymentAction, reason string) {
		result = append(result, PaymentProblem{Code: code, Action: action, OptionID: option.ID, Reason: reason, Asset: &option.Asset})
	}
	state, amounts := option.State, option.Amounts
	switch {
	case amounts.Receiver.Sign() < 0 || amounts.Payable.Sign() < 0 || amounts.Held.Sign() < 0:
		add(ProblemReconciliation, ActionReviewFunds, "negative_legacy_balance")
	case amounts.ReconciliationStatus == ledger.ReconciliationPending:
		if state.TotalDeposits == 0 && state.UnbookedOutflows == 0 && amounts.Receiver.Sign() == 0 {
			break
		}
		add(ProblemVerification, ActionWait, "movement_booking")
	case state.ReconciliationError != "":
		add(ProblemReconciliation, ActionReviewFunds, state.ReconciliationError)
	case state.UnbookedDeposits > 0:
		add(ProblemVerification, ActionWait, "deposit_booking")
	case amounts.Unreconciled:
		add(ProblemReconciliation, ActionReviewFunds, "unmatched_financial_evidence")
	}
	if state.UnbookedOutflows > 0 {
		action := ActionReviewFunds
		if amounts.ReconciliationStatus == ledger.ReconciliationPending {
			action = ActionWait
		}
		add(ProblemOutflowUnbooked, action, "outflow_booking")
	}
	if amounts.HasPolicyException {
		add(ProblemPolicyException, ActionReviewFunds, "authority_allocation")
	}
	if state.PaymentStatus == ledger.PartiallyPaid && amounts.Payable.Sign() > 0 && amounts.Payable.Cmp(option.Amount) < 0 {
		action := ActionShareCheckout
		if inv.Closed || inv.PayToken == "" || amounts.Unreconciled {
			action = ActionWait
		}
		add(ProblemPartialPayment, action, "")
		result[len(result)-1].Amount = new(big.Int).Sub(option.Amount, amounts.Payable)
	}
	if amounts.Held.Sign() > 0 {
		// A reason only when the ledger's one reason covers all of it: on-time dust, older holds and a part
		// return write none, or don't add up, so no sentence names a reason for money it doesn't describe.
		var reason string
		if h := option.HeldHistory; h.Amount != nil && h.Amount.Cmp(amounts.Held) == 0 {
			reason = h.Reason
		}
		add(ProblemHeldFunds, ActionReviewFunds, reason)
		result[len(result)-1].Amount = amounts.Held
	}
	if settlement := option.Settlement; settlement != nil && settlement.Status != "confirmed" {
		switch {
		case settlement.Status == "refused":
			add(ProblemSettlementRefused, ActionReviewSettlement, "terms_or_receiver")
		case settlement.Wait == "unresolved":
			add(ProblemSettlementDelayed, ActionReviewSettlement, "unresolved_transaction")
		case settlement.Wait != "":
			add(ProblemSettlementDelayed, ActionWait, settlement.Wait)
		case at.Sub(settlement.CreatedAt) >= SettlementAttentionAfter:
			add(ProblemSettlementDelayed, ActionWait, "awaiting_confirmation")
		}
	}
	return result
}
