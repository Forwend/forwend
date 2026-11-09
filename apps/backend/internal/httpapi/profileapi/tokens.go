package profileapi

import (
	"net/http"

	"github.com/forwend/forwend/apps/backend/internal/httpapi/httpio"
	"github.com/forwend/forwend/apps/backend/internal/profile"
)

type tokensJSON struct {
	Tokens []tokenSwitchJSON `json:"tokens"`
	// R-240: payers may pay from other chains through NEAR Intents.
	CrossChain bool `json:"crossChain"`
}

// R-136.
func getTokens(profiles *profile.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		list, err := profiles.Tokens(r.Context(), r.PathValue("profileId"))
		if err != nil {
			httpio.WriteError(w, r, err)
			return
		}
		writeTokens(w, r, profiles, list)
	}
}

func writeTokens(w http.ResponseWriter, r *http.Request, profiles *profile.Service, list []profile.TokenSwitch) {
	on, err := profiles.CrossChain(r.Context(), r.PathValue("profileId"))
	if err != nil {
		httpio.WriteError(w, r, err)
		return
	}
	httpio.WriteJSON(w, http.StatusOK, tokensJSON{Tokens: toTokensJSON(list), CrossChain: on})
}

func putTokens(profiles *profile.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Off []tokenJSON `json:"off"`
			// Left out, the switch stays as it is (R-240).
			CrossChain *bool `json:"crossChain"`
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
		if body.CrossChain != nil {
			if err := profiles.SetCrossChain(r.Context(), r.PathValue("profileId"), *body.CrossChain); err != nil {
				httpio.WriteError(w, r, err)
				return
			}
		}
		writeTokens(w, r, profiles, list)
	}
}
