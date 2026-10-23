package mid

import (
	"context"
	"net/http"
	"strings"

	"github.com/ensp1re/forwend/apps/backend/internal/auth"
	"github.com/ensp1re/forwend/apps/backend/internal/httpapi/httpio"
)

type userKey struct{}

func RequireUser(v *auth.Verifier, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		token, ok := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
		if !ok || token == "" {
			httpio.WriteError(w, r, auth.ErrUnauthorized)
			return
		}
		user, err := v.Verify(r.Context(), token)
		if err != nil {
			httpio.WriteError(w, r, err)
			return
		}
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), userKey{}, user)))
	})
}

func RequireProfileOwner(s *auth.Service, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		user, _ := r.Context().Value(userKey{}).(string)
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

func SignedInUser(r *http.Request) string {
	user, _ := r.Context().Value(userKey{}).(string)
	return user
}
