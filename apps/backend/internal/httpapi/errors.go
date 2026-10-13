package httpapi

import (
	"errors"
	"log/slog"
	"net/http"

	"github.com/ensp1re/forwend/apps/backend/internal/activity"
	"github.com/ensp1re/forwend/apps/backend/internal/auth"
	"github.com/ensp1re/forwend/apps/backend/internal/balance"
	"github.com/ensp1re/forwend/apps/backend/internal/document"
	"github.com/ensp1re/forwend/apps/backend/internal/invoice"
	"github.com/ensp1re/forwend/apps/backend/internal/profile"
	"github.com/ensp1re/forwend/apps/backend/internal/search"
)

// writeError maps a service error to the one error shape in docs/backend/api.md. Unknown errors are logged once and
// answered as a 500 without details. 400 and 422 messages say what to fix: our rule text or the JSON decoder's.
func writeError(w http.ResponseWriter, r *http.Request, err error) {
	status, code, message := http.StatusInternalServerError, "internal", "internal error"
	switch {
	case errors.Is(err, errMalformed):
		status, code, message = http.StatusBadRequest, "malformed_request", err.Error()
	case errors.Is(err, auth.ErrUnauthorized):
		status, code, message = http.StatusUnauthorized, "unauthorized", "missing or invalid access token"
	case errors.Is(err, auth.ErrForbidden):
		status, code, message = http.StatusForbidden, "forbidden", "not allowed for this profile"
	case errors.Is(err, invoice.ErrNotFound):
		status, code, message = http.StatusNotFound, "invoice_not_found", "invoice not found"
	case errors.Is(err, profile.ErrNoBillingDetails):
		status, code, message = http.StatusNotFound, "billing_details_not_found", "the profile has no billing details yet"
	case errors.Is(err, profile.ErrNotSignedUp):
		status, code, message = http.StatusNotFound, "not_signed_up", "sign up first with POST /v1/me"
	case errors.Is(err, document.ErrNotPaid):
		status, code, message = http.StatusConflict, "invoice_not_paid", "the invoice is not paid, so it has no receipt yet"
	case errors.Is(err, invoice.ErrConflict), errors.Is(err, profile.ErrConflict):
		status, code, message = http.StatusConflict, "idempotency_conflict", "Idempotency-Key was used with another request"
	case errors.Is(err, invoice.ErrInvalid), errors.Is(err, profile.ErrInvalid), errors.Is(err, activity.ErrInvalid),
		errors.Is(err, balance.ErrInvalid), errors.Is(err, search.ErrInvalid):
		status, code, message = http.StatusUnprocessableEntity, "invalid_value", err.Error()
	case errors.Is(err, invoice.ErrNotWatched):
		status, code, message = http.StatusServiceUnavailable, "network_not_ready", "this network is starting: try again in a minute"
	case errors.Is(err, invoice.ErrChainUnavailable):
		slog.Warn("recheck could not read the chain", "err", err)
		status, code, message = http.StatusServiceUnavailable, "network_unavailable", "could not read the network: try again shortly"
	case errors.Is(err, errRateLimited):
		status, code, message = http.StatusTooManyRequests, "rate_limited", "too many requests: wait Retry-After seconds"
	default:
		slog.Error("request failed", "method", r.Method, "path", r.URL.Path, "err", err)
	}
	writeJSON(w, status, map[string]map[string]string{"error": {"code": code, "message": message}})
}
