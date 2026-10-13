package httpapi

import (
	"errors"
	"math"
	"net/http"
	"strconv"
	"sync"
	"time"
)

// A signed-in tab polls about six routes every 15 s and a page load sends about ten at once, so a user with several
// tabs stays well under these, and a script that loops on the API does not. Public routes are limited per IP at the
// edge (docs/backend/api.md#rate-limits): Next's /api rewrite passes the client's own X-Forwarded-For through, so the
// api can't trust it to tell payers apart.
const userRate, userBurst = 2, 60 // requests per second, and at once, per Privy user

// Check status reads a chain RPC per call: this bounds those reads per api process, whoever asks (R-55). Each invoice
// is also limited to one check every invoice.RecheckEvery, across replicas.
const recheckRate, recheckBurst = 1, 10

// everyone is the one key of a limit shared by all callers.
func everyone(*http.Request) string { return "all" }

var errRateLimited = errors.New("rate limited")

// buckets live in each api process, so each replica counts on its own (docs/backend/architecture.md#scaling).
type buckets struct {
	rate, burst float64

	mu    sync.Mutex
	m     map[string]*bucket
	swept time.Time
}

type bucket struct {
	tokens float64
	at     time.Time
}

func newBuckets(rate, burst float64) *buckets {
	return &buckets{rate: rate, burst: burst, m: map[string]*bucket{}}
}

func (b *buckets) wait(key string) time.Duration {
	now := time.Now()
	b.mu.Lock()
	defer b.mu.Unlock()
	b.sweep(now)
	k := b.m[key]
	if k == nil {
		k = &bucket{tokens: b.burst, at: now}
		b.m[key] = k
	}
	k.tokens, k.at = min(b.burst, k.tokens+now.Sub(k.at).Seconds()*b.rate), now
	if k.tokens >= 1 {
		k.tokens--
		return 0
	}
	return time.Duration((1 - k.tokens) / b.rate * float64(time.Second))
}

// sweep forgets full buckets once a minute; a key that comes back starts full, as its bucket would be. Call it with mu
// held.
func (b *buckets) sweep(now time.Time) {
	if now.Sub(b.swept) < time.Minute {
		return
	}
	b.swept = now
	for key, k := range b.m {
		if k.tokens+now.Sub(k.at).Seconds()*b.rate >= b.burst {
			delete(b.m, key)
		}
	}
}

func limit(b *buckets, key func(*http.Request) string, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if wait := b.wait(key(r)); wait > 0 {
			w.Header().Set("Retry-After", strconv.Itoa(int(math.Ceil(wait.Seconds()))))
			writeError(w, r, errRateLimited)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func signedInUser(r *http.Request) string {
	user, _ := r.Context().Value(userKey{}).(string)
	return user
}
