// Package httpio holds the JSON and the error shape of docs/backend/api.md that every API module shares.
package httpio

import (
	"errors"
	"fmt"
	"log/slog"
	"net/http"

	"github.com/forwend/forwend/apps/backend/internal/activity"
	"github.com/forwend/forwend/apps/backend/internal/apikey"
	"github.com/forwend/forwend/apps/backend/internal/auth"
	"github.com/forwend/forwend/apps/backend/internal/balance"
	"github.com/forwend/forwend/apps/backend/internal/chain"
	"github.com/forwend/forwend/apps/backend/internal/document"
	"github.com/forwend/forwend/apps/backend/internal/invoice"
	"github.com/forwend/forwend/apps/backend/internal/job"
	"github.com/forwend/forwend/apps/backend/internal/ledger"
	"github.com/forwend/forwend/apps/backend/internal/link"
	"github.com/forwend/forwend/apps/backend/internal/profile"
	"github.com/forwend/forwend/apps/backend/internal/reauth"
	"github.com/forwend/forwend/apps/backend/internal/search"
	"github.com/forwend/forwend/apps/backend/internal/send"
	"github.com/forwend/forwend/apps/backend/internal/team"
	"github.com/forwend/forwend/apps/backend/internal/webhook"
)

var ErrMalformed = errors.New("malformed request")

var ErrRateLimited = errors.New("rate limited")

// WriteError uses the error shape of docs/backend/api.md. Only 400 and 422 show err's text, which says what to fix.
func WriteError(w http.ResponseWriter, r *http.Request, err error) {
	status, code, message := http.StatusInternalServerError, "internal", "internal error"
	switch {
	case errors.Is(err, ErrInvalidQuery):
		status, code, message = http.StatusUnprocessableEntity, "invalid_value", err.Error()
	case errors.Is(err, invoice.ErrTooManyMovements):
		status, code, message = http.StatusUnprocessableEntity, "too_many_movements", "choose a shorter period or one store"
	case errors.Is(err, ErrMalformed):
		status, code, message = http.StatusBadRequest, "malformed_request", err.Error()
	case errors.Is(err, auth.ErrUnauthorized):
		status, code, message = http.StatusUnauthorized, "unauthorized", "missing or invalid access token"
	case errors.Is(err, auth.ErrForbidden):
		status, code, message = http.StatusForbidden, "forbidden", "not allowed for this profile"
	case errors.Is(err, invoice.ErrNotFound):
		status, code, message = http.StatusNotFound, "invoice_not_found", "invoice not found"
	case errors.Is(err, invoice.ErrPaymentNotFound):
		status, code, message = http.StatusNotFound, "payment_not_found", "payment not found"
	case errors.Is(err, invoice.ErrCheckoutNotFound):
		status, code, message = http.StatusNotFound, "checkout_not_found", "checkout session not found"
	case errors.Is(err, invoice.ErrCheckoutNotExpirable):
		status, code, message = http.StatusConflict, "checkout_not_expirable", "checkout cannot expire after payment is seen"
	case errors.Is(err, activity.ErrNotFound):
		status, code, message = http.StatusNotFound, "transaction_not_found", "transaction not found"
	case errors.Is(err, activity.ErrNotLabelable):
		status, code, message = http.StatusConflict, "not_labelable",
			"only money in that is neither an invoice payment nor an own transfer takes a label"
	case errors.Is(err, job.ErrNotFound):
		status, code, message = http.StatusNotFound, "job_not_found", "job not found"
	case errors.Is(err, job.ErrAccepted):
		status, code, message = http.StatusConflict, "job_accepted", "the client accepted the job, so it can't be deleted"
	case errors.Is(err, job.ErrNotAccepted):
		status, code, message = http.StatusConflict, "job_not_accepted", "the client has not accepted the job yet"
	case errors.Is(err, job.ErrOutOfOrder):
		status, code, message = http.StatusConflict, "payment_out_of_order", "mark the earlier payments done first"
	case errors.Is(err, job.ErrChangeNotAccepted):
		status, code, message = http.StatusConflict, "change_not_accepted", "the client has not accepted this change yet"
	case errors.Is(err, job.ErrChangePending):
		status, code, message = http.StatusConflict, "change_pending", "a change waits for the client's acceptance"
	case errors.Is(err, job.ErrJobFinished):
		status, code, message = http.StatusConflict, "job_finished", "the job's last payment is done: more work is a new job"
	case errors.Is(err, job.ErrNotWithdrawable):
		status, code, message = http.StatusConflict, "payment_not_withdrawable",
			"only the last payment, a change the client has not accepted, can be withdrawn"
	case errors.Is(err, profile.ErrNoBillingDetails):
		status, code, message = http.StatusNotFound, "billing_details_not_found", "the profile has no billing details yet"
	case errors.Is(err, profile.ErrClientNotFound):
		status, code, message = http.StatusNotFound, "client_not_found", "client not found"
	case errors.Is(err, auth.ErrReauthRequired):
		status, code, message = http.StatusUnauthorized, "reauth_required",
			"sign in again: this needs a sign-in from the last 5 minutes"
	case errors.Is(err, profile.ErrStoreNotFound):
		status, code, message = http.StatusNotFound, "store_not_found", "store not found"
	case errors.Is(err, profile.ErrNoLogo):
		status, code, message = http.StatusNotFound, "logo_not_found", "the store has no logo"
	case errors.Is(err, profile.ErrNotMerchant):
		status, code, message = http.StatusConflict, "not_merchant", "only a merchant profile has stores"
	case errors.Is(err, reauth.ErrWrongCode):
		status, code, message = http.StatusUnprocessableEntity, "wrong_code", "wrong or expired code: check it or ask for a new one"
	case errors.Is(err, reauth.ErrTooSoon):
		status, code, message = http.StatusTooManyRequests, "code_sent_recently", "a code was sent a moment ago: enter it, or wait Retry-After seconds"
	case errors.Is(err, reauth.ErrTooMany):
		status, code, message = http.StatusTooManyRequests, "too_many_codes", "too many codes this hour: wait Retry-After seconds"
	case errors.Is(err, reauth.ErrNoTwoStep):
		status, code, message = http.StatusConflict, "two_step_not_set_up", "set up two-step verification at Privy first"
	case errors.Is(err, reauth.ErrNoAddress):
		status, code, message = http.StatusConflict, "no_login_email", "this account has no email to send a code to"
	case errors.Is(err, reauth.ErrNoEmail), errors.Is(err, reauth.ErrNoSession):
		status, code, message = http.StatusServiceUnavailable, "code_unavailable", "a code can't be sent now: sign out and sign in again"
	case errors.Is(err, send.ErrNotFound):
		status, code, message = http.StatusNotFound, "send_not_found", "send not found"
	case errors.Is(err, send.ErrBusy):
		status, code, message = http.StatusConflict, "send_in_progress",
			"a send from this wallet is on its way on this network: wait until it is sent"
	case errors.Is(err, send.ErrApproved):
		status, code, message = http.StatusConflict, "send_approved",
			"this send was approved already and may have gone out: check Transactions, then prepare it again"
	case errors.Is(err, send.ErrRefused):
		status, code, message = http.StatusUnprocessableEntity, "transfer_refused", err.Error()
	case errors.Is(err, send.ErrUnavailable):
		slog.Warn("send could not read the chain", "err", chain.Redact(err))
		status, code, message = http.StatusServiceUnavailable, "network_unavailable", "could not read the network: try again shortly"
	case errors.Is(err, link.ErrNotFound):
		status, code, message = http.StatusNotFound, "link_not_found", "payment link not found"
	case errors.Is(err, webhook.ErrNotConfigured):
		status, code, message = http.StatusServiceUnavailable, "webhooks_not_configured",
			"webhooks are off on this server: it has no WEBHOOK_SECRET_KEY"
	case errors.Is(err, webhook.ErrNotFound):
		status, code, message = http.StatusNotFound, "endpoint_not_found", "webhook endpoint not found"
	case errors.Is(err, webhook.ErrNoDelivery):
		status, code, message = http.StatusNotFound, "delivery_not_found", "webhook delivery not found"
	case errors.Is(err, webhook.ErrPersonal):
		status, code, message = http.StatusConflict, "personal_profile", "a personal profile has no webhooks"
	case errors.Is(err, apikey.ErrUnknownKey):
		status, code, message = http.StatusUnauthorized, "invalid_api_key",
			"the API key is unknown, revoked or past its overlap"
	case errors.Is(err, apikey.ErrNotFound):
		status, code, message = http.StatusNotFound, "key_not_found", "API key not found"
	case errors.Is(err, apikey.ErrPersonal):
		status, code, message = http.StatusConflict, "personal_profile", "a personal profile has no API keys"
	case errors.Is(err, link.ErrOff):
		status, code, message = http.StatusConflict, "link_off", "the owner turned this payment link off"
	case errors.Is(err, link.ErrEnded):
		status, code, message = http.StatusConflict, "link_ended", "this payment link has ended"
	case errors.Is(err, link.ErrFull), errors.Is(err, invoice.ErrLinkAtCapacity):
		status, code, message = http.StatusConflict, "link_full", "this payment link has no available purchase slots"
	case errors.Is(err, link.ErrNotReady):
		status, code, message = http.StatusConflict, "link_not_ready", link.ErrNotReady.Error()
	case errors.Is(err, link.ErrChanged):
		status, code, message = http.StatusConflict, "link_changed", "this link changed; review the current offer and try again"
	case errors.Is(err, link.ErrPersonal):
		status, code, message = http.StatusConflict, "personal_profile",
			"a personal profile asks for money with requests, not payment links"
	case errors.Is(err, team.ErrNotMerchant):
		status, code, message = http.StatusConflict, "not_merchant", "only a merchant profile has a team"
	case errors.Is(err, team.ErrMemberNotFound):
		status, code, message = http.StatusNotFound, "member_not_found", "member not found"
	case errors.Is(err, team.ErrInviteNotFound):
		status, code, message = http.StatusNotFound, "invite_not_found", "the invite is used, revoked, expired or unknown"
	case errors.Is(err, team.ErrOtherEmail):
		status, code, message = http.StatusForbidden, "invite_for_another_email",
			"sign in with the email address the invite was sent to"
	case errors.Is(err, team.ErrOnTeam):
		status, code, message = http.StatusConflict, "already_on_team", "that account is already on the team"
	case errors.Is(err, profile.ErrNotSignedUp):
		status, code, message = http.StatusNotFound, "not_signed_up", "sign up first with POST /v1/me"
	case errors.Is(err, document.ErrNotPaid):
		status, code, message = http.StatusConflict, "invoice_not_paid", "the invoice is not paid, so it has no receipt yet"
	case errors.Is(err, invoice.ErrPickLocked):
		status, code, message = http.StatusConflict, "pick_locked", "money was seen on this invoice, so its option no longer changes"
	case errors.Is(err, invoice.ErrReceiptSent):
		status, code, message = http.StatusConflict, "receipt_sent", "the receipt was already sent to the address given"
	case errors.Is(err, invoice.ErrNotCancelable):
		status, code, message = http.StatusConflict, "invoice_not_cancelable",
			"only an open invoice with no payment seen and its checkout still open can be canceled"
	case errors.Is(err, invoice.ErrNotEditable):
		status, code, message = http.StatusConflict, "invoice_not_editable",
			"the reference, note and due date change only before any payment while the checkout is open"
	case errors.Is(err, ledger.ErrReconciliationPending):
		status, code, message = http.StatusConflict, "payment_reconciliation_pending", "Payment records are still syncing. Try again shortly."
	case errors.Is(err, invoice.ErrNotReopenable):
		status, code, message = http.StatusConflict, "invoice_not_reopenable",
			"only an invoice that closed partly paid, with no refund under way, can reopen, once, a day or more before its settle deadline"
	case errors.Is(err, invoice.ErrNoClientEmail):
		status, code, message = http.StatusConflict, "client_email_required", "the invoice has no client email to send it to"
	case errors.Is(err, invoice.ErrClosed):
		status, code, message = http.StatusConflict, "invoice_closed", "the invoice can no longer be paid, so it can't be sent"
	case errors.Is(err, invoice.ErrDueDateRequired):
		status, code, message = http.StatusConflict, "due_date_required", "reminders count from the due date, and the invoice has none"
	case errors.Is(err, invoice.ErrRemindersStopped):
		status, code, message = http.StatusConflict, "reminders_stopped", "the client stopped the reminders for this invoice"
	case errors.Is(err, invoice.ErrBillingDetailsRequired):
		status, code, message = http.StatusConflict, "billing_details_required",
			"a freelancer or merchant profile saves its billing details before its first invoice"
	case errors.Is(err, invoice.ErrConflict), errors.Is(err, profile.ErrConflict), errors.Is(err, job.ErrConflict):
		status, code, message = http.StatusConflict, "idempotency_conflict", "Idempotency-Key was used with another request"
	case errors.Is(err, invoice.ErrInvalid), errors.Is(err, profile.ErrInvalid), errors.Is(err, job.ErrInvalid),
		errors.Is(err, activity.ErrInvalid), errors.Is(err, team.ErrInvalid), errors.Is(err, link.ErrInvalid),
		errors.Is(err, apikey.ErrInvalid), errors.Is(err, webhook.ErrInvalid),
		errors.Is(err, balance.ErrInvalid), errors.Is(err, search.ErrInvalid), errors.Is(err, send.ErrInvalid):
		status, code, message = http.StatusUnprocessableEntity, "invalid_value", err.Error()
	case errors.Is(err, activity.ErrTooMany):
		status, code, message = http.StatusUnprocessableEntity, "too_many_transactions",
			fmt.Sprintf("more than %d transactions in these days: choose a shorter period", activity.MaxExportRows)
	case errors.Is(err, invoice.ErrNotWatched):
		status, code, message = http.StatusServiceUnavailable, "network_not_ready", "this network is starting: try again in a minute"
	case errors.Is(err, invoice.ErrChainUnavailable):
		slog.Warn("recheck could not read the chain", "err", err)
		status, code, message = http.StatusServiceUnavailable, "network_unavailable", "could not read the network: try again shortly"
	case errors.Is(err, webhook.ErrQueueFull):
		status, code, message = http.StatusTooManyRequests, "webhook_queue_full", "webhook queue is full: wait for pending deliveries"
	case errors.Is(err, ErrRateLimited):
		status, code, message = http.StatusTooManyRequests, "rate_limited", "too many requests: wait Retry-After seconds"
	default:
		// The route, not the path: a link token in the path must never reach the log.
		slog.Error("request failed", "route", r.Pattern, "err", err)
	}
	WriteJSON(w, status, map[string]map[string]string{"error": {"code": code, "message": message}})
}
