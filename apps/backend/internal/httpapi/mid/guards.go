package mid

import (
	"net/http"
	"strings"

	"github.com/forwend/forwend/apps/backend/internal/apikey"
	"github.com/forwend/forwend/apps/backend/internal/auth"
	"github.com/forwend/forwend/apps/backend/internal/privy"
	"github.com/forwend/forwend/apps/backend/internal/reauth"
)

// Modules take Guards from the router, so every module shares one rate limit per user.
type Guards struct {
	SignedIn func(http.Handler) http.Handler
	// Can guards a {profileId} route: the owner, a member whose role has the permission (R-138), or the profile's
	// secret API key with it in its scopes (R-144).
	Can func(auth.Permission) func(http.Handler) http.Handler
	// FreshSignIn is Can for money actions and the other changes D-63 names (R-137); a key never passes it.
	FreshSignIn func(auth.Permission) func(http.Handler) http.Handler
}

func NewGuards(verifier *auth.Verifier, owners *auth.Service, keys *apikey.Service, users *privy.Client,
	codes *reauth.Service, userBurst int) Guards {
	if userBurst == 0 {
		userBurst = UserBurst
	}
	buckets := NewBuckets(UserRate, float64(userBurst))
	signedIn := func(h http.Handler) http.Handler {
		return RequireUser(verifier, owners, Limit(buckets, SignedInUser, h))
	}
	// A key has its own bucket, as a user does.
	byKey := func(h http.Handler) http.Handler {
		return RequireKey(keys, Limit(buckets, func(r *http.Request) string { return "key:" + RequestKey(r) }, h))
	}
	can := func(p auth.Permission) func(http.Handler) http.Handler {
		return func(h http.Handler) http.Handler {
			access := RequireAccess(owners, p, h)
			key, user := byKey(access), signedIn(access)
			return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if bearer, ok := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer "); ok && apikey.IsKey(bearer) {
					key.ServeHTTP(w, r)
					return
				}
				user.ServeHTTP(w, r)
			})
		}
	}
	return Guards{
		SignedIn: signedIn,
		Can:      can,
		FreshSignIn: func(p auth.Permission) func(http.Handler) http.Handler {
			return func(h http.Handler) http.Handler { return can(p)(RequireFreshSignIn(users, codes, h)) }
		},
	}
}
