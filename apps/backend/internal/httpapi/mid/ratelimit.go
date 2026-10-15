package mid

import (
	"math"
	"net/http"
	"strconv"
	"sync"
	"time"

	"github.com/ensp1re/forwend/apps/backend/internal/httpapi/httpio"
)

// A signed-in tab polls about six routes every 15 s and a page load sends about ten at once, so a user with several
// tabs stays well under these, and a script that loops on the API does not. Public routes are limited per IP at the
// edge (docs/backend/api.md#rate-limits): Next's /api rewrite adds no X-Forwarded-For of its own and passes a client's
// header through unchanged (measured 2026-10-15), so the api can neither see nor trust a payer's address.
const UserRate, UserBurst = 2, 60

// Everyone is the one key of a limit shared by all callers.
func Everyone(*http.Request) string { return "all" }

// Buckets live in each api process, so each replica counts on its own (docs/backend/architecture.md#scaling).
type Buckets struct {
	rate, burst float64

	mu    sync.Mutex
	m     map[string]*bucket
	swept time.Time
}

type bucket struct {
	tokens float64
	at     time.Time
}

func NewBuckets(rate, burst float64) *Buckets {
	return &Buckets{rate: rate, burst: burst, m: map[string]*bucket{}}
}

func (b *Buckets) Wait(key string) time.Duration {
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

// sweep forgets full Buckets once a minute; a key that comes back starts full, as its bucket would be. Call it with mu
// held.
func (b *Buckets) sweep(now time.Time) {
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

func Limit(b *Buckets, key func(*http.Request) string, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if wait := b.Wait(key(r)); wait > 0 {
			w.Header().Set("Retry-After", strconv.Itoa(int(math.Ceil(wait.Seconds()))))
			httpio.WriteError(w, r, httpio.ErrRateLimited)
			return
		}
		next.ServeHTTP(w, r)
	})
}
