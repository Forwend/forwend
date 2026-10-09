package httpapi

import (
	"net/http"
	"time"

	"github.com/ensp1re/forwend/apps/backend/internal/profile"
)

type createProfileBody struct {
	Kind string `json:"kind"`
	Name string `json:"name"`
}

type profileJSON struct {
	ProfileID     string  `json:"profileId"`
	Kind          string  `json:"kind"`
	Name          *string `json:"name"`
	WalletAddress *string `json:"walletAddress"`
	CreatedAt     string  `json:"createdAt"`
}

type meJSON struct {
	Profiles []profileJSON `json:"profiles"`
}

// signUp is POST /v1/me: 201 when the personal profile is new, 200 when the user had signed up before.
func signUp(profiles *profile.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		list, created, err := profiles.SignUp(r.Context(), r.Context().Value(userKey{}).(string))
		if err != nil {
			writeError(w, r, err)
			return
		}
		status := http.StatusOK
		if created {
			status = http.StatusCreated
		}
		writeJSON(w, status, toMeJSON(list))
	}
}

// getMe is GET /v1/me: the signed-in user's profiles, oldest first.
func getMe(profiles *profile.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		list, err := profiles.List(r.Context(), r.Context().Value(userKey{}).(string))
		if err != nil {
			writeError(w, r, err)
			return
		}
		writeJSON(w, http.StatusOK, toMeJSON(list))
	}
}

// createProfile is POST /v1/profiles: 201 when created, 200 when the same request is repeated.
func createProfile(profiles *profile.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		key, err := idempotencyKey(r)
		if err != nil {
			writeError(w, r, err)
			return
		}
		var body createProfileBody
		if err := decodeJSON(w, r, &body); err != nil {
			writeError(w, r, err)
			return
		}
		p, created, err := profiles.Create(r.Context(), r.Context().Value(userKey{}).(string), key, body.Kind, body.Name)
		if err != nil {
			writeError(w, r, err)
			return
		}
		status := http.StatusOK
		if created {
			status = http.StatusCreated
		}
		writeJSON(w, status, toProfileJSON(p))
	}
}

func toMeJSON(list []profile.Profile) meJSON {
	out := meJSON{Profiles: []profileJSON{}}
	for _, p := range list {
		out.Profiles = append(out.Profiles, toProfileJSON(p))
	}
	return out
}

func toProfileJSON(p profile.Profile) profileJSON {
	out := profileJSON{ProfileID: p.ID, Kind: p.Kind, CreatedAt: p.CreatedAt.UTC().Format(time.RFC3339)}
	if p.Name != "" {
		out.Name = &p.Name
	}
	if p.WalletAddress != "" {
		out.WalletAddress = &p.WalletAddress
	}
	return out
}
