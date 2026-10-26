package profileapi

import (
	"net/http"

	"github.com/forwend/forwend/apps/backend/internal/httpapi/httpio"
	"github.com/forwend/forwend/apps/backend/internal/profile"
)

type tokensJSON struct {
	Tokens []tokenSwitchJSON `json:"tokens"`
}

// R-136.
func getTokens(profiles *profile.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		list, err := profiles.Tokens(r.Context(), r.PathValue("profileId"))
		if err != nil {
			httpio.WriteError(w, r, err)
			return
		}
		httpio.WriteJSON(w, http.StatusOK, tokensJSON{Tokens: toTokensJSON(list)})
	}
}

func putTokens(profiles *profile.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Off []tokenJSON `json:"off"`
		}
		if err := httpio.DecodeJSON(w, r, &body); err != nil {
			httpio.WriteError(w, r, err)
			return
		}
		list, err := profiles.SetTokensOff(r.Context(), r.PathValue("profileId"), toPairs(body.Off))
		if err != nil {
			httpio.WriteError(w, r, err)
			return
		}
		httpio.WriteJSON(w, http.StatusOK, tokensJSON{Tokens: toTokensJSON(list)})
	}
}
