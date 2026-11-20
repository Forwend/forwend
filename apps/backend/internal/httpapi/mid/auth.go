package mid

import (
	"context"
	"net/http"
	"slices"
	"strings"
	"time"

	"github.com/forwend/forwend/apps/backend/internal/apikey"
	"github.com/forwend/forwend/apps/backend/internal/auth"
	"github.com/forwend/forwend/apps/backend/internal/httpapi/httpio"
	"github.com/forwend/forwend/apps/backend/internal/invoice"
	"github.com/forwend/forwend/apps/backend/internal/link"
	"github.com/forwend/forwend/apps/backend/internal/privy"
	"github.com/forwend/forwend/apps/backend/internal/profile"
	"github.com/forwend/forwend/apps/backend/internal/reauth"
)

type tokenKey struct{}

// RequireUser also refuses a token issued before the user signed out everywhere.
func RequireUser(v *auth.Verifier, sessions *auth.Service, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		bearer, ok := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
		if !ok || bearer == "" {
			httpio.WriteError(w, r, auth.ErrUnauthorized)
			return
		}
		token, err := v.Verify(r.Context(), bearer)
		if err != nil {
			httpio.WriteError(w, r, err)
			return
		}
		if err := sessions.CheckSession(r.Context(), token); err != nil {
			httpio.WriteError(w, r, err)
			return
		}
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), tokenKey{}, token)))
	})
}

type accessKey struct{}

type keyKey struct{}

// RequireKey lets through a working secret API key; RequireAccess checks what it may do.
func RequireKey(keys *apikey.Service, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		bearer, _ := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
		caller, err := keys.Authenticate(r.Context(), bearer)
		if err != nil {
			httpio.WriteError(w, r, err)
			return
		}
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), keyKey{}, caller)))
	})
}

// RequestKey is the id of the key a request came with, "" for a person's.
func RequestKey(r *http.Request) string {
	caller, _ := r.Context().Value(keyKey{}).(apikey.Caller)
	return caller.KeyID
}

// RequireAccess answers not found for records outside a store-scoped caller's stores or a key's mode.
func RequireAccess(s *auth.Service, p auth.Permission, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var access auth.Access
		var err error
		if caller, ok := r.Context().Value(keyKey{}).(apikey.Caller); ok {
			access = caller.Access
			if !strings.EqualFold(caller.ProfileID, r.PathValue("profileId")) {
				err = auth.ErrForbidden
			}
		} else if user := SignedInUser(r); user == "" { // not wrapped in RequireUser or RequireKey: deny
			httpio.WriteError(w, r, auth.ErrUnauthorized)
			return
		} else {
			access, err = s.CheckAccess(r.Context(), user, r.PathValue("profileId"))
		}
		if err == nil && !access.Can(p) {
			err = auth.ErrForbidden
		}
		if err == nil && (access.Stores != nil || access.Livemode != nil) && auth.StoreScoped(p) {
			err = inStores(r, s, access)
		}
		if err != nil {
			httpio.WriteError(w, r, err)
			return
		}
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), accessKey{}, access)))
	})
}

func inStores(r *http.Request, s *auth.Service, access auth.Access) error {
	if store := r.PathValue("storeId"); store != "" && !access.InStores(store) {
		return profile.ErrStoreNotFound
	}
	id, notFound := r.PathValue("invoiceId"), invoice.ErrNotFound
	if r.PathValue("paymentId") != "" {
		id, notFound = r.PathValue("paymentId"), invoice.ErrPaymentNotFound
	}
	if r.PathValue("sessionId") != "" {
		id, notFound = r.PathValue("sessionId"), invoice.ErrCheckoutNotFound
	}
	if id != "" {
		store, live, found, err := s.InvoiceStore(r.Context(), r.PathValue("profileId"), id)
		if err != nil {
			return err
		}
		if found && (!access.InStores(store) || access.Livemode != nil && *access.Livemode != live) {
			return notFound
		}
	}
	if id := r.PathValue("linkId"); id != "" {
		store, live, found, err := s.LinkStore(r.Context(), r.PathValue("profileId"), id)
		if err != nil {
			return err
		}
		if found && (!access.InStores(store) || access.Livemode != nil && *access.Livemode != live) {
			return link.ErrNotFound
		}
	}
	return nil
}

// ProfileAccess is the access RequireAccess found; handlers narrow lists to its stores.
func ProfileAccess(r *http.Request) auth.Access {
	access, _ := r.Context().Value(accessKey{}).(auth.Access)
	return access
}

// RequireFreshSignIn passes a recent code confirm or full sign-in; with mfaEnough, recorded Privy MFA too.
func RequireFreshSignIn(users *privy.Client, codes *reauth.Service, mfaEnough bool, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if RequestKey(r) != "" { // only a person signs in
			httpio.WriteError(w, r, auth.ErrForbidden)
			return
		}
		token, ok := r.Context().Value(tokenKey{}).(auth.Token)
		if !ok { // not wrapped in RequireUser: deny
			httpio.WriteError(w, r, auth.ErrUnauthorized)
			return
		}
		// A Privy sign-in made while signed in keeps the session and moves no sign-in time: it alone proves nothing.
		fresh, stored, err := codes.Fresh(r.Context(), token)
		if err != nil {
			httpio.WriteError(w, r, err)
			return
		}
		if !fresh {
			signIns, twoStep, err := users.SignInTimes(r.Context(), token.User, stored.LoginEmail)
			if err != nil {
				httpio.WriteError(w, r, err)
				return
			}
			// Only recorded methods: a stolen session can add MFA at Privy but can't record it here.
			trusted := len(twoStep) > 0 && !slices.ContainsFunc(twoStep, func(m string) bool {
				return !slices.Contains(stored.TwoStep, m)
			})
			fresh = mfaEnough && trusted || auth.IsFresh(token, time.Now(), signIns)
		}
		if !fresh {
			httpio.WriteError(w, r, auth.ErrReauthRequired)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func SignedInToken(r *http.Request) auth.Token {
	token, _ := r.Context().Value(tokenKey{}).(auth.Token)
	return token
}

func SignedInUser(r *http.Request) string {
	token, _ := r.Context().Value(tokenKey{}).(auth.Token)
	return token.User
}
