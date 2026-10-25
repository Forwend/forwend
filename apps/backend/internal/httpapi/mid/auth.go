package mid

import (
	"context"
	"net/http"
	"strings"
	"time"

	"github.com/ensp1re/forwend/apps/backend/internal/auth"
	"github.com/ensp1re/forwend/apps/backend/internal/httpapi/httpio"
	"github.com/ensp1re/forwend/apps/backend/internal/invoice"
	"github.com/ensp1re/forwend/apps/backend/internal/link"
	"github.com/ensp1re/forwend/apps/backend/internal/privy"
	"github.com/ensp1re/forwend/apps/backend/internal/profile"
)

type tokenKey struct{}

// RequireUser also refuses a token issued before the user signed out everywhere (R-137).
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

// RequireAccess lets through the profile's owner and members whose role has p (R-138). For an invoice or store
// permission, a Developer's or Finance member's request about another store's invoice, payment link or store is not
// found.
func RequireAccess(s *auth.Service, p auth.Permission, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		user := SignedInUser(r)
		if user == "" { // not wrapped in RequireUser: deny
			httpio.WriteError(w, r, auth.ErrUnauthorized)
			return
		}
		access, err := s.CheckAccess(r.Context(), user, r.PathValue("profileId"))
		if err == nil && !access.Can(p) {
			err = auth.ErrForbidden
		}
		if err == nil && access.Stores != nil && auth.StoreScoped(p) {
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
	if id := r.PathValue("invoiceId"); id != "" {
		store, found, err := s.InvoiceStore(r.Context(), r.PathValue("profileId"), id)
		if err != nil {
			return err
		}
		if found && !access.InStores(store) {
			return invoice.ErrNotFound
		}
	}
	if id := r.PathValue("linkId"); id != "" {
		store, found, err := s.LinkStore(r.Context(), r.PathValue("profileId"), id)
		if err != nil {
			return err
		}
		if found && !access.InStores(store) {
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

// RequireFreshSignIn lets through only a token from a sign-in within auth.FreshWindow (D-49, D-63). It asks Privy
// each time; when Privy can't answer, nothing is let through.
func RequireFreshSignIn(users *privy.Client, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		token, ok := r.Context().Value(tokenKey{}).(auth.Token)
		if !ok { // not wrapped in RequireUser: deny
			httpio.WriteError(w, r, auth.ErrUnauthorized)
			return
		}
		signIns, err := users.SignInTimes(r.Context(), token.User)
		if err != nil {
			httpio.WriteError(w, r, err)
			return
		}
		if !auth.IsFresh(token, time.Now(), signIns) {
			httpio.WriteError(w, r, auth.ErrReauthRequired)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func SignedInUser(r *http.Request) string {
	token, _ := r.Context().Value(tokenKey{}).(auth.Token)
	return token.User
}
