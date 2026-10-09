package httpapi

import (
	"errors"
	"log/slog"
	"net/http"

	"github.com/ensp1re/forwend/apps/backend/internal/auth"
	"github.com/ensp1re/forwend/apps/backend/internal/invoice"
	"github.com/ensp1re/forwend/apps/backend/internal/profile"
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
	case errors.Is(err, profile.ErrNotSignedUp):
		status, code, message = http.StatusNotFound, "not_signed_up", "sign up first with POST /v1/me"
	case errors.Is(err, invoice.ErrConflict), errors.Is(err, profile.ErrConflict):
		status, code, message = http.StatusConflict, "idempotency_conflict", "Idempotency-Key was used with another request"
	case errors.Is(err, invoice.ErrInvalid), errors.Is(err, profile.ErrInvalid):
		status, code, message = http.StatusUnprocessableEntity, "invalid_value", err.Error()
	default:
		slog.Error("request failed", "method", r.Method, "path", r.URL.Path, "err", err)
	}
	writeJSON(w, status, map[string]map[string]string{"error": {"code": code, "message": message}})
}
