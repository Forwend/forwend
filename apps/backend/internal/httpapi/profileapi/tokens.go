package profileapi

import (
	"fmt"
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
		// A part left out stays as it is, so saving one never puts back another tab's change to the other (R-240).
		var body struct {
			Off        *[]tokenJSON `json:"off"`
			CrossChain *bool        `json:"crossChain"`
		}
		if err := httpio.DecodeJSON(w, r, &body); err != nil {
			httpio.WriteError(w, r, err)
			return
		}
		if body.Off == nil && body.CrossChain == nil {
			httpio.WriteError(w, r, fmt.Errorf("%w: give off, crossChain or both", profile.ErrInvalid))
			return
		}
		id := r.PathValue("profileId")
		var list []profile.TokenSwitch
		var err error
		if body.Off != nil {
			list, err = profiles.SetTokensOff(r.Context(), id, toPairs(*body.Off))
		} else {
			list, err = profiles.Tokens(r.Context(), id)
		}
		if err != nil {
			httpio.WriteError(w, r, err)
			return
		}
		if body.CrossChain != nil {
			if err := profiles.SetCrossChain(r.Context(), id, *body.CrossChain); err != nil {
				httpio.WriteError(w, r, err)
				return
			}
		}
		writeTokens(w, r, profiles, list)
	}
}
