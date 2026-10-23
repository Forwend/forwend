package mid

import (
	"net/http"

	"github.com/ensp1re/forwend/apps/backend/internal/auth"
)

// Modules take Guards from the router, so every module shares one rate limit per user.
type Guards struct {
	SignedIn      func(http.Handler) http.Handler
	ProfileScoped func(http.Handler) http.Handler
}

func NewGuards(verifier *auth.Verifier, owners *auth.Service, userBurst int) Guards {
	if userBurst == 0 {
		userBurst = UserBurst
	}
	users := NewBuckets(UserRate, float64(userBurst))
	signedIn := func(h http.Handler) http.Handler { return RequireUser(verifier, Limit(users, SignedInUser, h)) }
	return Guards{
		SignedIn:      signedIn,
		ProfileScoped: func(h http.Handler) http.Handler { return signedIn(RequireProfileOwner(owners, h)) },
	}
}
