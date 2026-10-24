package mid

import (
	"context"
	"net/http"
	"strings"
	"time"

	"github.com/ensp1re/forwend/apps/backend/internal/auth"
	"github.com/ensp1re/forwend/apps/backend/internal/httpapi/httpio"
	"github.com/ensp1re/forwend/apps/backend/internal/privy"
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

func RequireProfileOwner(s *auth.Service, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		user := SignedInUser(r)
		if user == "" { // not wrapped in RequireUser: deny
			httpio.WriteError(w, r, auth.ErrUnauthorized)
			return
		}
		if err := s.CheckProfileOwner(r.Context(), user, r.PathValue("profileId")); err != nil {
			httpio.WriteError(w, r, err)
			return
		}
		next.ServeHTTP(w, r)
	})
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
