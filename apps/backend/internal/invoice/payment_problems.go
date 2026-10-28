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
	case state.BookingError != "":
		add(ProblemReconciliation, ActionReviewFunds, state.BookingError)
	case amounts.ReconciliationStatus == ledger.ReconciliationPending:
		if state.TotalDeposits == 0 && state.UnbookedOutflows == 0 && amounts.Receiver.Sign() == 0 {
			break
		}
		reason := "movement_booking"
		if !state.HistoryComplete {
			reason = "historical_coverage"
		}
		add(ProblemVerification, ActionWait, reason)
	case state.ReconciliationError != "":
		add(ProblemReconciliation, ActionReviewFunds, state.ReconciliationError)
	case state.BalanceDifference != nil && state.BalanceDifference.Sign() != 0:
		add(ProblemReconciliation, ActionReviewFunds, "balance_difference")
	case !state.HistoryComplete && state.TotalDeposits > 0:
		add(ProblemVerification, ActionWait, "historical_coverage")
	case state.UnprovedDeposits > 0 || state.UnbookedDeposits > 0:
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
		reason := "after_checkout_close"
		switch {
		case inv.OptionLocked && inv.OptionID != option.ID:
			reason = ledger.HeldOtherOption
		case state.PaymentStatus == ledger.Canceled:
			reason = ledger.HeldCanceled
		case state.PaymentStatus == ledger.ExpiredPartiallyPaid || state.PaymentStatus == ledger.Expired:
			reason = ledger.HeldExpired
		case state.PaymentStatus == ledger.Paid:
			reason = "payment_completed"
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
