package apikey

import (
	"crypto/rand"
	"crypto/sha256"
	"hash/crc32"
	"regexp"
	"strings"
)

const base62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"

// Prefix, 30 random base62 characters (178 bits) and a CRC32 of the rest, so typos fail without a lookup.
var textPattern = regexp.MustCompile(`^fw_(test|live)_[0-9A-Za-z]{36}$`)

func prefix(livemode bool) string {
	if livemode {
		return "fw_live_"
	}
	return "fw_test_"
}

func newText(livemode bool) (string, []byte) {
	var b strings.Builder
	b.WriteString(prefix(livemode))
	// 62 * 4 = 248: a byte at or above it would make some characters likelier than others.
	for buf := make([]byte, 1); b.Len() < len("fw_test_")+30; {
		_, _ = rand.Read(buf)
		if buf[0] < 248 {
			b.WriteByte(base62[buf[0]%62])
		}
	}
	text := b.String() + checksum(b.String())
	sum := sha256.Sum256([]byte(text))
	return text, sum[:]
}

func checksum(s string) string {
	n := crc32.ChecksumIEEE([]byte(s))
	out := make([]byte, 6) // 62^6 > 2^32
	for i := 5; i >= 0; i-- {
		out[i] = base62[n%62]
		n /= 62
	}
	return string(out)
}

func hashOf(text string) ([]byte, bool) {
	if !textPattern.MatchString(text) || checksum(text[:len(text)-6]) != text[len(text)-6:] {
		return nil, false
	}
	sum := sha256.Sum256([]byte(text))
	return sum[:], true
}

// IsKey: a bearer token that looks like a key is checked as one, never as a sign-in.
func IsKey(bearer string) bool {
	return strings.HasPrefix(bearer, "fw_")
}
