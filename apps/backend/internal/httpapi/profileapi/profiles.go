package profileapi

import (
	"fmt"
	"net/http"

	"github.com/forwend/forwend/apps/backend/internal/httpapi/httpio"
	"github.com/forwend/forwend/apps/backend/internal/httpapi/mid"
	"github.com/forwend/forwend/apps/backend/internal/profile"
)

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

func onboard(profiles *profile.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body onboardingBody
		if err := httpio.DecodeJSON(w, r, &body); err != nil {
			httpio.WriteError(w, r, err)
			return
		}
		list, at, onboarded, err := profiles.Onboard(r.Context(), mid.SignedInUser(r), body.Choices, body.Names)
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

// R-80.
func getNotifications(profiles *profile.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		n, err := profiles.Notifications(r.Context(), r.PathValue("profileId"))
		if err != nil {
			httpio.WriteError(w, r, err)
			return
		}
		httpio.WriteJSON(w, http.StatusOK, toNotificationsJSON(n))
	}
}

// The address is the login email and can't be set here.
func putNotifications(profiles *profile.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body notificationsBody
		if err := httpio.DecodeJSON(w, r, &body); err != nil {
			httpio.WriteError(w, r, err)
			return
		}
		if body.Email == nil {
			httpio.WriteError(w, r, fmt.Errorf("%w: email: give true or false", profile.ErrInvalid))
			return
		}
		n, err := profiles.SetNotifications(r.Context(), r.PathValue("profileId"), *body.Email)
		if err != nil {
			httpio.WriteError(w, r, err)
			return
		}
		httpio.WriteJSON(w, http.StatusOK, toNotificationsJSON(n))
	}
}

// R-137: every session ends, this one too; the web signs out.
func signOutEverywhere(profiles *profile.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if err := profiles.SignOutEverywhere(r.Context(), mid.SignedInUser(r)); err != nil {
			httpio.WriteError(w, r, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}
