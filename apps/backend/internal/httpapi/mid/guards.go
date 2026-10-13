package mid

import (
	"net/http"

	"github.com/ensp1re/forwend/apps/backend/internal/auth"
)

// Guards wrap a route in the access it needs. SignedIn: a valid Privy access token, rate limited per user.
// ProfileScoped: also that the user owns the {profileId} in the path. Modules take them from the router, so every
// module shares one limit per user.
type Guards struct {
	SignedIn      func(http.Handler) http.Handler
	ProfileScoped func(http.Handler) http.Handler
}

// NewGuards builds the guards over one Privy verifier and the profile owners.
func NewGuards(verifier *auth.Verifier, owners *auth.Service) Guards {
	users := NewBuckets(UserRate, UserBurst)
	signedIn := func(h http.Handler) http.Handler { return RequireUser(verifier, Limit(users, SignedInUser, h)) }
	return Guards{
		SignedIn:      signedIn,
		ProfileScoped: func(h http.Handler) http.Handler { return signedIn(RequireProfileOwner(owners, h)) },
	}
}
