package httpapi

import (
	"context"
	"net/http"
	"strings"

	"github.com/ensp1re/forwend/apps/backend/internal/auth"
)

type userKey struct{}

// requireUser answers 401 unless the request carries a valid Privy access token; the user's DID goes into the context.
func requireUser(v *auth.Verifier, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		token, ok := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
		if !ok || token == "" {
			writeError(w, r, auth.ErrUnauthorized)
			return
		}
		user, err := v.Verify(token)
		if err != nil {
			writeError(w, r, err)
			return
		}
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), userKey{}, user)))
	})
}

// requireProfileOwner answers 403 unless the signed-in user owns the {profileId} in the path. Wrap it in requireUser.
func requireProfileOwner(s *auth.Service, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		user, _ := r.Context().Value(userKey{}).(string)
		if user == "" { // not wrapped in requireUser: deny
			writeError(w, r, auth.ErrUnauthorized)
			return
		}
		if err := s.CheckProfileOwner(r.Context(), user, r.PathValue("profileId")); err != nil {
			writeError(w, r, err)
			return
		}
		next.ServeHTTP(w, r)
	})
}
