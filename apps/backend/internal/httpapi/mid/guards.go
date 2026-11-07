package mid

import (
	"net/http"
	"net/netip"
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
	// SigningCheck is FreshSignIn for what Privy signs, a send: a user with Privy's MFA set up passes without
	// Forwend's code, since Privy asks for MFA before it signs (D-49).
	SigningCheck func(auth.Permission) func(http.Handler) http.Handler
	// FreshSignedIn is SignedIn with a fresh sign-in, for a change to the account rather than a profile (R-217).
	FreshSignedIn func(http.Handler) http.Handler
	// Payer is a public caller's address for rate limits, from a trusted proxy's X-Forwarded-For; "" when the api
	// can't tell callers apart.
	Payer func(*http.Request) string
}

func NewGuards(verifier *auth.Verifier, owners *auth.Service, keys *apikey.Service, users *privy.Client,
	codes *reauth.Service, userBurst int, trustProxy bool) Guards {
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
			return func(h http.Handler) http.Handler { return can(p)(RequireFreshSignIn(users, codes, false, h)) }
		},
		SigningCheck: func(p auth.Permission) func(http.Handler) http.Handler {
			return func(h http.Handler) http.Handler { return can(p)(RequireFreshSignIn(users, codes, true, h)) }
		},
		FreshSignedIn: func(h http.Handler) http.Handler { return signedIn(RequireFreshSignIn(users, codes, false, h)) },
		Payer: func(r *http.Request) string {
			if !trustProxy {
				return ""
			}
			return ForwardedFor(r)
		},
	}
}

// ForwardedFor is the last address in X-Forwarded-For: the one the proxy in front of the api saw. Earlier ones are
// whatever the client sent. An IPv6 address is its /64, which one network gets whole. "" when it isn't an IP address.
func ForwardedFor(r *http.Request) string {
	values := r.Header.Values("X-Forwarded-For")
	if len(values) == 0 {
		return ""
	}
	parts := strings.Split(values[len(values)-1], ",")
	ip, err := netip.ParseAddr(strings.TrimSpace(parts[len(parts)-1]))
	if err != nil {
		return ""
	}
	if ip = ip.Unmap(); ip.Is6() {
		return netip.PrefixFrom(ip, 64).Masked().String()
	}
	return ip.String()
}
