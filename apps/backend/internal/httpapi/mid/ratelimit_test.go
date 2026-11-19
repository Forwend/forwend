package mid

import (
	"math"
	"strconv"
	"strings"
	"testing"
	"time"
)

// Converting +Inf, or a wait past the longest duration, differs by CPU: amd64 gives the most negative duration, which
// let an empty bucket's requests through on CI while arm64 waited.
func TestAnEmptyBucketThatDoesNotRefillWaitsOnEveryCPU(t *testing.T) {
	for _, rate := range []float64{0, 1e-12} {
		b := NewBuckets(rate, 1)
		if wait := b.Wait("k"); wait != 0 {
			t.Fatalf("rate %v, first request: wait %v", rate, wait)
		}
		if wait := b.Wait("k"); wait != time.Duration(math.MaxInt64) {
			t.Fatalf("rate %v, empty: wait %v, want the longest", rate, wait)
		}
	}
}

// A public route's key comes from its path: made-up keys, long or many, share one bucket instead of growing memory.
func TestMadeUpKeysShareOneBucket(t *testing.T) {
	b := NewBuckets(0.001, 1)
	for i := range MaxKeys {
		if wait := b.Wait(strconv.Itoa(i)); wait != 0 {
			t.Fatalf("key %d: wait %v", i, wait)
		}
	}
	if wait := b.Wait("past the cap"); wait != 0 {
		t.Fatalf("the first key past the cap: wait %v", wait)
	}
	if wait := b.Wait("past the cap too"); wait == 0 {
		t.Error("a second key past the cap got its own bucket")
	}
	if wait := b.Wait(strings.Repeat("x", MaxKeyLen+1)); wait == 0 {
		t.Error("a key over MaxKeyLen got its own bucket")
	}
	if len(b.m) > MaxKeys+1 {
		t.Errorf("%d buckets held, want at most %d", len(b.m), MaxKeys+1)
	}
}
