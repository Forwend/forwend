package mid

import (
	"math"
	"net/http"
	"sync"
	"time"

	"github.com/forwend/forwend/apps/backend/internal/httpapi/httpio"
	"github.com/forwend/forwend/apps/backend/internal/invoice"
)

// Well above what open tabs send. The edge limits public routes per IP: the api can't trust a payer's IP.
const UserRate, UserBurst = 2, 60

func Everyone(*http.Request) string { return "all" }

// Anyone can make up a public route's key: a longer key, or a new one past MaxKeys, shares the overflow bucket.
const MaxKeys, MaxKeyLen = 100_000, 128

const overflow = "\x00overflow"

// Buckets live in each api process, so each replica counts on its own.
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
	if len(key) > MaxKeyLen {
		key = overflow
	}
	k := b.m[key]
	if k == nil && len(b.m) >= MaxKeys {
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
	// On amd64, converting +Inf or an overflow to a Duration gives the most negative value: wait the longest instead.
	wait := (1 - k.tokens) / b.rate * float64(time.Second)
	if b.rate <= 0 || wait >= math.MaxInt64 {
		return time.Duration(math.MaxInt64)
	}
	return time.Duration(wait)
}

// Dropping a full bucket loses nothing: a returning key starts full. Call it with mu held.
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
			httpio.WriteError(w, r, &invoice.TooSoonError{Wait: wait})
			return
		}
		next.ServeHTTP(w, r)
	})
}
