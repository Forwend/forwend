package profileapi

import (
	"net/http"

	"github.com/ensp1re/forwend/apps/backend/internal/httpapi/httpio"
	"github.com/ensp1re/forwend/apps/backend/internal/httpapi/mid"
	"github.com/ensp1re/forwend/apps/backend/internal/profile"
)

// signUp is POST /v1/me: 201 when the personal profile is new, 200 when the user had signed up before.
func signUp(profiles *profile.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user := mid.SignedInUser(r)
		list, created, err := profiles.SignUp(r.Context(), user)
		if err != nil {
			httpio.WriteError(w, r, err)
			return
		}
		at, err := profiles.OnboardedAt(r.Context(), user)
		if err != nil {
			httpio.WriteError(w, r, err)
			return
		}
		status := http.StatusOK
		if created {
			status = http.StatusCreated
		}
		httpio.WriteJSON(w, status, toMeJSON(list, at))
	}
}

// getMe is GET /v1/me: the signed-in user's profiles, oldest first.
func getMe(profiles *profile.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user := mid.SignedInUser(r)
		list, err := profiles.List(r.Context(), user)
		if err != nil {
			httpio.WriteError(w, r, err)
			return
		}
		at, err := profiles.OnboardedAt(r.Context(), user)
		if err != nil {
			httpio.WriteError(w, r, err)
			return
		}
		httpio.WriteJSON(w, http.StatusOK, toMeJSON(list, at))
	}
}

// onboard is POST /v1/me/onboarding: 201 when this call made the first-run choice, 200 when it was made before.
func onboard(profiles *profile.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body onboardingBody
		if err := httpio.DecodeJSON(w, r, &body); err != nil {
			httpio.WriteError(w, r, err)
			return
		}
		list, at, onboarded, err := profiles.Onboard(r.Context(), mid.SignedInUser(r), body.Choices)
		if err != nil {
			httpio.WriteError(w, r, err)
			return
		}
		status := http.StatusOK
		if onboarded {
			status = http.StatusCreated
		}
		httpio.WriteJSON(w, status, toMeJSON(list, &at))
	}
}

// createProfile is POST /v1/profiles: 201 when created, 200 when the same request is repeated.
func createProfile(profiles *profile.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		key, err := httpio.IdempotencyKey(r)
		if err != nil {
			httpio.WriteError(w, r, err)
			return
		}
		var body createProfileBody
		if err := httpio.DecodeJSON(w, r, &body); err != nil {
			httpio.WriteError(w, r, err)
			return
		}
		p, created, err := profiles.Create(r.Context(), mid.SignedInUser(r), key, body.Kind, body.Name)
		if err != nil {
			httpio.WriteError(w, r, err)
			return
		}
		status := http.StatusOK
		if created {
			status = http.StatusCreated
		}
		httpio.WriteJSON(w, status, toProfileJSON(p))
	}
}

// putBillingDetails is PUT /v1/profiles/{profileId}/billing-details: creates or replaces them, 200 either way.
func putBillingDetails(profiles *profile.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body billingDetailsBody
		if err := httpio.DecodeJSON(w, r, &body); err != nil {
			httpio.WriteError(w, r, err)
			return
		}
		d, err := profiles.SaveBillingDetails(r.Context(), r.PathValue("profileId"), profile.BillingDetails{
			Name: body.Name, Address: body.Address, Country: body.Country, TaxID: body.TaxID, Email: body.Email})
		if err != nil {
			httpio.WriteError(w, r, err)
			return
		}
		httpio.WriteJSON(w, http.StatusOK, toBillingDetailsJSON(d))
	}
}

// getBillingDetails is GET /v1/profiles/{profileId}/billing-details: 404 until they are saved.
func getBillingDetails(profiles *profile.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		d, err := profiles.BillingDetails(r.Context(), r.PathValue("profileId"))
		if err != nil {
			httpio.WriteError(w, r, err)
			return
		}
		httpio.WriteJSON(w, http.StatusOK, toBillingDetailsJSON(d))
	}
}
