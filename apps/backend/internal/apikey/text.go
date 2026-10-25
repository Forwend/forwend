package apikey

import (
	"crypto/rand"
	"crypto/sha256"
	"hash/crc32"
	"regexp"
	"strings"
)

const base62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"

// A key's text is fw_test_ or fw_live_, 30 random base62 characters (178 bits) and a 6-character CRC32 of the rest, as
// GitHub's token format has it: a typo or a made-up key is refused without a lookup, and secret scanners can tell it.
var textPattern = regexp.MustCompile(`^fw_(test|live)_[0-9A-Za-z]{36}$`)

func prefix(livemode bool) string {
	if livemode {
		return "fw_live_"
	}
	return "fw_test_"
}

// newText is a new key's text and the SHA-256 kept for it.
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

// hashOf is the SHA-256 kept for a key's text, and false for text that isn't a key's.
func hashOf(text string) ([]byte, bool) {
	if !textPattern.MatchString(text) || checksum(text[:len(text)-6]) != text[len(text)-6:] {
		return nil, false
	}
	sum := sha256.Sum256([]byte(text))
	return sum[:], true
}

// IsKey reports whether a bearer token looks like a key's text, so it is checked as one and never as a sign-in.
func IsKey(bearer string) bool {
	return strings.HasPrefix(bearer, "fw_")
}
