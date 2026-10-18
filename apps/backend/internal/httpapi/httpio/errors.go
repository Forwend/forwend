// Package httpio reads requests and writes answers for every API module: JSON in and out, the one error
// shape of docs/backend/api.md, and the query parameters lists share.
package httpio

import (
	"errors"
	"log/slog"
	"net/http"

	"github.com/ensp1re/forwend/apps/backend/internal/activity"
	"github.com/ensp1re/forwend/apps/backend/internal/auth"
	"github.com/ensp1re/forwend/apps/backend/internal/balance"
	"github.com/ensp1re/forwend/apps/backend/internal/document"
	"github.com/ensp1re/forwend/apps/backend/internal/invoice"
	"github.com/ensp1re/forwend/apps/backend/internal/job"
	"github.com/ensp1re/forwend/apps/backend/internal/profile"
	"github.com/ensp1re/forwend/apps/backend/internal/search"
)

// ErrMalformed is a request the server can't parse: 400.
var ErrMalformed = errors.New("malformed request")

var ErrRateLimited = errors.New("rate limited")

// WriteError maps a service error to the one error shape in docs/backend/api.md. Unknown errors are logged once and
// answered as a 500 without details. 400 and 422 messages say what to fix: our rule text or the JSON decoder's.
func WriteError(w http.ResponseWriter, r *http.Request, err error) {
	status, code, message := http.StatusInternalServerError, "internal", "internal error"
	switch {
	case errors.Is(err, ErrMalformed):
		status, code, message = http.StatusBadRequest, "malformed_request", err.Error()
	case errors.Is(err, auth.ErrUnauthorized):
		status, code, message = http.StatusUnauthorized, "unauthorized", "missing or invalid access token"
	case errors.Is(err, auth.ErrForbidden):
		status, code, message = http.StatusForbidden, "forbidden", "not allowed for this profile"
	case errors.Is(err, invoice.ErrNotFound):
		status, code, message = http.StatusNotFound, "invoice_not_found", "invoice not found"
	case errors.Is(err, job.ErrNotFound):
		status, code, message = http.StatusNotFound, "job_not_found", "job not found"
	case errors.Is(err, job.ErrAccepted):
		status, code, message = http.StatusConflict, "job_accepted", "the client accepted the job, so it can't be deleted"
	case errors.Is(err, job.ErrNotAccepted):
		status, code, message = http.StatusConflict, "job_not_accepted", "a step is marked done once the client accepted the job"
	case errors.Is(err, job.ErrOutOfOrder):
		status, code, message = http.StatusConflict, "payment_out_of_order", "mark the earlier payments done first"
	case errors.Is(err, profile.ErrNoBillingDetails):
		status, code, message = http.StatusNotFound, "billing_details_not_found", "the profile has no billing details yet"
	case errors.Is(err, profile.ErrClientNotFound):
		status, code, message = http.StatusNotFound, "client_not_found", "client not found"
	case errors.Is(err, profile.ErrNotSignedUp):
		status, code, message = http.StatusNotFound, "not_signed_up", "sign up first with POST /v1/me"
	case errors.Is(err, document.ErrNotPaid):
		status, code, message = http.StatusConflict, "invoice_not_paid", "the invoice is not paid, so it has no receipt yet"
	case errors.Is(err, invoice.ErrReceiptSent):
		status, code, message = http.StatusConflict, "receipt_sent", "the receipt was already sent to the address given"
	case errors.Is(err, invoice.ErrNotCancelable):
		status, code, message = http.StatusConflict, "invoice_not_cancelable",
			"only an open invoice with no payment seen and its checkout still open can be canceled"
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
		errors.Is(err, activity.ErrInvalid),
		errors.Is(err, balance.ErrInvalid), errors.Is(err, search.ErrInvalid):
		status, code, message = http.StatusUnprocessableEntity, "invalid_value", err.Error()
	case errors.Is(err, invoice.ErrNotWatched):
		status, code, message = http.StatusServiceUnavailable, "network_not_ready", "this network is starting: try again in a minute"
	case errors.Is(err, invoice.ErrChainUnavailable):
		slog.Warn("recheck could not read the chain", "err", err)
		status, code, message = http.StatusServiceUnavailable, "network_unavailable", "could not read the network: try again shortly"
	case errors.Is(err, ErrRateLimited):
		status, code, message = http.StatusTooManyRequests, "rate_limited", "too many requests: wait Retry-After seconds"
	default:
		slog.Error("request failed", "method", r.Method, "path", r.URL.Path, "err", err)
	}
	WriteJSON(w, status, map[string]map[string]string{"error": {"code": code, "message": message}})
}
