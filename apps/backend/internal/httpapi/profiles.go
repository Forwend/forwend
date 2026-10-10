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
	OnboardedAt *string       `json:"onboardedAt"`
	Profiles    []profileJSON `json:"profiles"`
}

type onboardingBody struct {
	Choices []string `json:"choices"`
}

// signUp is POST /v1/me: 201 when the personal profile is new, 200 when the user had signed up before.
func signUp(profiles *profile.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user := r.Context().Value(userKey{}).(string)
		list, created, err := profiles.SignUp(r.Context(), user)
		if err != nil {
			writeError(w, r, err)
			return
		}
		at, err := profiles.OnboardedAt(r.Context(), user)
		if err != nil {
			writeError(w, r, err)
			return
		}
		status := http.StatusOK
		if created {
			status = http.StatusCreated
		}
		writeJSON(w, status, toMeJSON(list, at))
	}
}

// getMe is GET /v1/me: the signed-in user's profiles, oldest first.
func getMe(profiles *profile.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user := r.Context().Value(userKey{}).(string)
		list, err := profiles.List(r.Context(), user)
		if err != nil {
			writeError(w, r, err)
			return
		}
		at, err := profiles.OnboardedAt(r.Context(), user)
		if err != nil {
			writeError(w, r, err)
			return
		}
		writeJSON(w, http.StatusOK, toMeJSON(list, at))
	}
}

// onboard is POST /v1/me/onboarding: 201 when this call made the first-run choice, 200 when it was made before.
func onboard(profiles *profile.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body onboardingBody
		if err := decodeJSON(w, r, &body); err != nil {
			writeError(w, r, err)
			return
		}
		list, at, onboarded, err := profiles.Onboard(r.Context(), r.Context().Value(userKey{}).(string), body.Choices)
		if err != nil {
			writeError(w, r, err)
			return
		}
		status := http.StatusOK
		if onboarded {
			status = http.StatusCreated
		}
		writeJSON(w, status, toMeJSON(list, &at))
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

type billingDetailsBody struct {
	Name    string `json:"name"`
	Address string `json:"address"`
	Country string `json:"country"`
	TaxID   string `json:"taxId"`
	Email   string `json:"email"`
}

type billingDetailsJSON struct {
	issuerJSON
	UpdatedAt string `json:"updatedAt"`
}

// putBillingDetails is PUT /v1/profiles/{profileId}/billing-details: creates or replaces them, 200 either way.
func putBillingDetails(profiles *profile.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body billingDetailsBody
		if err := decodeJSON(w, r, &body); err != nil {
			writeError(w, r, err)
			return
		}
		d, err := profiles.SaveBillingDetails(r.Context(), r.PathValue("profileId"), profile.BillingDetails{
			Name: body.Name, Address: body.Address, Country: body.Country, TaxID: body.TaxID, Email: body.Email})
		if err != nil {
			writeError(w, r, err)
			return
		}
		writeJSON(w, http.StatusOK, toBillingDetailsJSON(d))
	}
}

// getBillingDetails is GET /v1/profiles/{profileId}/billing-details: 404 until they are saved.
func getBillingDetails(profiles *profile.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		d, err := profiles.BillingDetails(r.Context(), r.PathValue("profileId"))
		if err != nil {
			writeError(w, r, err)
			return
		}
		writeJSON(w, http.StatusOK, toBillingDetailsJSON(d))
	}
}

func toBillingDetailsJSON(d profile.BillingDetails) billingDetailsJSON {
	return billingDetailsJSON{
		issuerJSON: issuerJSON{Name: d.Name, Address: d.Address, Country: d.Country, TaxID: orNull(d.TaxID),
			Email: d.Email},
		UpdatedAt: d.UpdatedAt.UTC().Format(time.RFC3339),
	}
}

func toMeJSON(list []profile.Profile, onboardedAt *time.Time) meJSON {
	out := meJSON{Profiles: []profileJSON{}}
	if onboardedAt != nil {
		at := onboardedAt.UTC().Format(time.RFC3339)
		out.OnboardedAt = &at
	}
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
