package mid

import (
	"strings"
	"testing"
)

// A public route's key comes from its path: made-up keys, long or many, share one bucket instead of growing memory.
func TestMadeUpKeysShareOneBucket(t *testing.T) {
	b := NewBuckets(0.001, 1)
	b.maxKeys = 3
	for _, key := range []string{"a", "b", "c"} {
		if wait := b.Wait(key); wait != 0 {
			t.Fatalf("%s: wait %v", key, wait)
		}
	}
	if wait := b.Wait("d"); wait != 0 {
		t.Fatalf("the first key past the cap: wait %v", wait)
	}
	if wait := b.Wait("e"); wait == 0 {
		t.Error("a second key past the cap got its own bucket")
	}
	if wait := b.Wait(strings.Repeat("x", MaxKeyLen+1)); wait == 0 {
		t.Error("a key over MaxKeyLen got its own bucket")
	}
	if len(b.m) > b.maxKeys+1 {
		t.Errorf("%d buckets held, want at most %d", len(b.m), b.maxKeys+1)
	}
}
