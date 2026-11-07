// Package sendapi serves sends and transfers out of a profile's wallet (R-211, R-212) of docs/backend/api.md.
package sendapi

import (
	"net/http"

	"github.com/forwend/forwend/apps/backend/internal/auth"
	"github.com/forwend/forwend/apps/backend/internal/httpapi/mid"
	"github.com/forwend/forwend/apps/backend/internal/send"
)

// Preparing a send only checks it, for the review. Approving it is the money action, so that needs a fresh sign-in,
// or Privy's MFA set up, which Privy then asks for as it signs (D-49); the browser signs it and reports the hash.
func Routes(mux *http.ServeMux, g mid.Guards, sends *send.Service) {
	mux.Handle("POST /v1/profiles/{profileId}/sends", g.Can(auth.MoneyMove)(prepareSend(sends)))
	// What the money lists show while a signed send waits for the watcher: whoever reads transactions reads these.
	mux.Handle("GET /v1/profiles/{profileId}/sends", g.Can(auth.MoneyRead)(listPendingSends(sends)))
	mux.Handle("GET /v1/profiles/{profileId}/sends/fee", g.Can(auth.MoneyMove)(getSendFee(sends)))
	mux.Handle("GET /v1/profiles/{profileId}/sends/{sendId}", g.Can(auth.MoneyMove)(getSend(sends)))
	// Approves a prepared send once: the browser signs only a send this answers as approved.
	mux.Handle("POST /v1/profiles/{profileId}/sends/{sendId}/approve", g.SigningCheck(auth.MoneyMove)(approveSend(sends)))
	mux.Handle("POST /v1/profiles/{profileId}/sends/{sendId}/submit", g.Can(auth.MoneyMove)(submitSend(sends)))
	mux.Handle("POST /v1/profiles/{profileId}/sends/{sendId}/cancel", g.Can(auth.MoneyMove)(cancelSend(sends)))
}
