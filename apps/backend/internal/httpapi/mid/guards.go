package mid

import (
	"net/http"

	"github.com/ensp1re/forwend/apps/backend/internal/auth"
	"github.com/ensp1re/forwend/apps/backend/internal/privy"
)

// Modules take Guards from the router, so every module shares one rate limit per user.
type Guards struct {
	SignedIn func(http.Handler) http.Handler
	// Can guards a {profileId} route: the owner, or a member whose role has the permission (R-138).
	Can func(auth.Permission) func(http.Handler) http.Handler
	// FreshSignIn is Can for money actions and the other changes D-63 names (R-137).
	FreshSignIn func(auth.Permission) func(http.Handler) http.Handler
}

func NewGuards(verifier *auth.Verifier, owners *auth.Service, users *privy.Client, userBurst int) Guards {
	if userBurst == 0 {
		userBurst = UserBurst
	}
	buckets := NewBuckets(UserRate, float64(userBurst))
	signedIn := func(h http.Handler) http.Handler {
		return RequireUser(verifier, owners, Limit(buckets, SignedInUser, h))
	}
	can := func(p auth.Permission) func(http.Handler) http.Handler {
		return func(h http.Handler) http.Handler { return signedIn(RequireAccess(owners, p, h)) }
	}
	return Guards{
		SignedIn: signedIn,
		Can:      can,
		FreshSignIn: func(p auth.Permission) func(http.Handler) http.Handler {
			return func(h http.Handler) http.Handler { return can(p)(RequireFreshSignIn(users, h)) }
		},
	}
}
