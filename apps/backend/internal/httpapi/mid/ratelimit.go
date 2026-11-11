package mid

import (
	"math"
	"net/http"
	"strconv"
	"sync"
	"time"

	"github.com/forwend/forwend/apps/backend/internal/httpapi/httpio"
)

// Tabs poll about six routes every 15 s and a page load sends about ten, well under this; a looping script is not.
// Public routes are limited per IP at the edge (docs/backend/api.md#rate-limits): the api can't trust a payer's IP.
const UserRate, UserBurst = 2, 60

func Everyone(*http.Request) string { return "all" }

// MaxKeys and MaxKeyLen bound one set of buckets: a public route's key comes from its path, which anyone can make up.
// A longer key, or a new one once MaxKeys are held, shares the overflow bucket. Real keys are far shorter.
const MaxKeys, MaxKeyLen = 100_000, 128

const overflow = "\x00overflow"

// Buckets live in each api process, so each replica counts on its own (docs/backend/architecture.md#scaling).
type Buckets struct {
	rate, burst float64
	maxKeys     int

	mu    sync.Mutex
	m     map[string]*bucket
	swept time.Time
}

type bucket struct {
	tokens float64
	at     time.Time
}

func NewBuckets(rate, burst float64) *Buckets {
	return &Buckets{rate: rate, burst: burst, maxKeys: MaxKeys, m: map[string]*bucket{}}
}

func (b *Buckets) Wait(key string) time.Duration {
	now := time.Now()
	b.mu.Lock()
	defer b.mu.Unlock()
	b.sweep(now)
	if len(key) > MaxKeyLen {
		key = overflow
	}
	k := b.m[key]
	if k == nil && len(b.m) >= b.maxKeys {
		key, k = overflow, b.m[overflow]
	}
	if k == nil {
		k = &bucket{tokens: b.burst, at: now}
		b.m[key] = k
	}
	k.tokens, k.at = min(b.burst, k.tokens+now.Sub(k.at).Seconds()*b.rate), now
	if k.tokens >= 1 {
		k.tokens--
		return 0
	}
	// A bucket that never refills, or refills too slowly to count in nanoseconds, waits the longest: converting +Inf or
	// an overflow to a duration gives the most negative value on amd64, which would let every request through.
	wait := (1 - k.tokens) / b.rate * float64(time.Second)
	if b.rate <= 0 || wait >= math.MaxInt64 {
		return time.Duration(math.MaxInt64)
	}
	return time.Duration(wait)
}

// Dropping a full bucket loses nothing: a key that comes back starts full. Call it with mu held.
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
