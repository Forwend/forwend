package mid

import (
	"net/http"

	"github.com/ensp1re/forwend/apps/backend/internal/auth"
	"github.com/ensp1re/forwend/apps/backend/internal/privy"
)

// Modules take Guards from the router, so every module shares one rate limit per user.
type Guards struct {
	SignedIn      func(http.Handler) http.Handler
	ProfileScoped func(http.Handler) http.Handler
	// FreshSignIn is ProfileScoped for money actions and the other changes D-63 names (R-137).
	FreshSignIn func(http.Handler) http.Handler
}

func NewGuards(verifier *auth.Verifier, owners *auth.Service, users *privy.Client, userBurst int) Guards {
	if userBurst == 0 {
		userBurst = UserBurst
	}
	buckets := NewBuckets(UserRate, float64(userBurst))
	signedIn := func(h http.Handler) http.Handler {
		return RequireUser(verifier, owners, Limit(buckets, SignedInUser, h))
	}
	profileScoped := func(h http.Handler) http.Handler { return signedIn(RequireProfileOwner(owners, h)) }
	return Guards{
		SignedIn:      signedIn,
		ProfileScoped: profileScoped,
		FreshSignIn:   func(h http.Handler) http.Handler { return profileScoped(RequireFreshSignIn(users, h)) },
	}
}
