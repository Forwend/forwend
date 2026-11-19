package config

import (
	"crypto/ecdsa"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"math/big"
	"net/netip"
	"net/url"
	"os"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/ethereum/go-ethereum/crypto"
	"github.com/forwend/forwend/apps/backend/internal/outbound"
)

// reader collects every missing or invalid variable, so one run names them all.
type reader struct{ missing, invalid []string }

func (r *reader) get(name string) string {
	v := os.Getenv(name)
	if v == "" {
		r.missing = append(r.missing, name)
	}
	return v
}

func (r *reader) err() error {
	var errs []error
	if len(r.missing) > 0 {
		errs = append(errs, fmt.Errorf("missing environment variables %s: copy apps/backend/.env.example to apps/backend/.env",
			strings.Join(r.missing, ", ")))
	}
	if len(r.invalid) > 0 {
		errs = append(errs, fmt.Errorf("invalid environment variables %s", strings.Join(r.invalid, ", ")))
	}
	return errors.Join(errs...)
}

func (r *reader) oneClick() OneClick {
	c := OneClick{URL: os.Getenv("ONECLICK_API_URL"), Key: os.Getenv("ONECLICK_API_KEY"), Signer: os.Getenv("ONECLICK_SIGNER_KEY")}
	if c.URL == "" {
		c.URL = DefaultOneClickURL
	}
	r.oneClickFake("ONECLICK_API_URL", c.URL, "ONECLICK_SIGNER_KEY", c.Signer)
	return c
}

// oneClickFake checks a 1Click root, and that a key replacing the one 1Click signs with comes only with a test's fake
// on loopback (D-124).
func (r *reader) oneClickFake(urlName, raw, keyName, key string) {
	if u := webURL(raw); u == nil {
		r.invalid = append(r.invalid, urlName+" (an http or https URL)")
	} else if key != "" && !loopback(u.Hostname()) {
		r.invalid = append(r.invalid, keyName+" (only with a test's fake 1Click on a loopback "+urlName+")")
	}
}

// email is the optional Resend settings the api and the worker share; an empty key sends nothing.
func email() Email {
	e := Email{ResendKey: os.Getenv("RESEND_API_KEY"), ResendURL: os.Getenv("RESEND_API_URL"),
		PostalAddress: os.Getenv("EMAIL_POSTAL_ADDRESS"), Support: os.Getenv("SUPPORT_EMAIL"), From: os.Getenv("EMAIL_FROM")}
	if e.From == "" {
		e.From = defaultEmailFrom
	}
	return e
}

func (r *reader) hex(name string, bytes int) string {
	raw := r.get(name)
	if raw == "" {
		return ""
	}
	if !regexp.MustCompile(fmt.Sprintf("^0x[0-9a-fA-F]{%d}$", 2*bytes)).MatchString(raw) {
		r.invalid = append(r.invalid, fmt.Sprintf("%s (0x and %d hex digits)", name, 2*bytes))
	}
	return strings.ToLower(raw)
}

// rpcPairs never puts the URLs into an error: they may hold keys.
func (r *reader) rpcPairs(name string, allowLoopback bool) map[uint64][2]string {
	raw := r.get(name)
	if raw == "" {
		return nil
	}
	var in map[uint64][]string
	ok := json.Unmarshal([]byte(raw), &in) == nil && len(in) > 0
	out := map[uint64][2]string{}
	for chainID, urls := range in {
		if len(urls) != 2 {
			ok = false
			break
		}
		a, b := webURL(urls[0]), webURL(urls[1])
		if a == nil || b == nil || !outbound.ValidURL(urls[0], allowLoopback) || !outbound.ValidURL(urls[1], allowLoopback) ||
			strings.EqualFold(strings.TrimSuffix(a.Hostname(), "."), strings.TrimSuffix(b.Hostname(), ".")) {
			ok = false
			break
		}
		out[chainID] = [2]string(urls)
	}
	if !ok {
		r.invalid = append(r.invalid, name+` (JSON such as {"84532": ["https://rpc-a", "https://rpc-b"]}: two URLs on `+
			"different hosts per chain ID)")
	}
	return out
}

func webURL(raw string) *url.URL {
	u, err := url.Parse(raw)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		return nil
	}
	return u
}

func loopback(host string) bool {
	ip, err := netip.ParseAddr(host)
	return host == "localhost" || err == nil && ip.IsLoopback()
}

func (r *reader) chains() Chains {
	c := Chains{RPCSecrets: r.rpcSecrets(), AllowLoopback: r.flag("RPC_ALLOW_LOOPBACK"), RPCRate: r.rate()}
	if raw := r.get("POLL_INTERVAL"); raw != "" {
		d, err := time.ParseDuration(raw)
		if err != nil || d <= 0 {
			r.invalid = append(r.invalid, "POLL_INTERVAL (a duration such as 5s)")
		}
		c.PollInterval = d
	}
	return c
}

// key never puts the value into an error.
func (r *reader) key(name string) *ecdsa.PrivateKey {
	raw := r.get(name)
	if raw == "" {
		return nil
	}
	k, err := crypto.HexToECDSA(strings.TrimPrefix(raw, "0x"))
	if err != nil {
		r.invalid = append(r.invalid, name+" (a hex secp256k1 private key)")
	}
	return k
}

func (r *reader) origin(name string) string {
	raw := r.get(name)
	if raw == "" {
		return ""
	}
	u := webURL(raw)
	if u == nil {
		r.invalid = append(r.invalid, name+" (an origin such as https://forwend.app)")
		return ""
	}
	return u.Scheme + "://" + u.Host
}

// keysURL must be https: anyone on the path of a plain-http key list could sign tokens for any user. Loopback http is
// for tests.
func (r *reader) keysURL(name string) string {
	raw := r.get(name)
	if raw == "" {
		return ""
	}
	if u := webURL(raw); u == nil || u.Scheme != "https" && !loopback(u.Hostname()) {
		r.invalid = append(r.invalid, name+" (an https URL)")
		return ""
	}
	return raw
}

func (r *reader) rate() float64 {
	raw := r.get("RPC_RATE_PER_SECOND")
	if raw == "" {
		return 0
	}
	v, err := strconv.ParseFloat(raw, 64)
	if err != nil || !(v > 0) || math.IsInf(v, 1) {
		r.invalid = append(r.invalid, "RPC_RATE_PER_SECOND (calls per second, such as 10)")
	}
	return v
}

func (r *reader) flag(name string) bool {
	raw := os.Getenv(name)
	if raw != "" && raw != "0" && raw != "1" {
		r.invalid = append(r.invalid, name+" (0 or 1)")
	}
	return raw == "1"
}

// base64Key is 32 bytes in standard base64, or nil when unset.
func (r *reader) base64Key(name string) []byte {
	raw := os.Getenv(name)
	if raw == "" {
		return nil
	}
	key, err := base64.StdEncoding.DecodeString(raw)
	if err != nil || len(key) != 32 {
		r.invalid = append(r.invalid, name+" (32 bytes in base64)")
	}
	return key
}

// chainIDs is a comma-separated list of chain IDs, or nil when unset.
func (r *reader) chainIDs(name string) []uint64 {
	raw := os.Getenv(name)
	if raw == "" {
		return nil
	}
	var ids []uint64
	for part := range strings.SplitSeq(raw, ",") {
		id, err := strconv.ParseUint(strings.TrimSpace(part), 10, 64)
		if err != nil || id == 0 {
			r.invalid = append(r.invalid, name+" (chain IDs separated by commas, such as 8453,42161)")
			return nil
		}
		ids = append(ids, id)
	}
	return ids
}

// fees reads the platform fee plan. The contract takes at most a tenth of the amount in fees, network fee included, so
// a rate is at most 500 basis points.
func (r *reader) fees() Fees {
	var f Fees
	if raw := os.Getenv("PLATFORM_FEE_BPS"); raw != "" {
		v, err := strconv.ParseInt(raw, 10, 64)
		if err != nil || v < 0 || v > 500 {
			r.invalid = append(r.invalid, "PLATFORM_FEE_BPS (basis points from 0 to 500, such as 50 for 0.5%)")
		}
		f.RateBps = v
	}
	usd := func(name string) *big.Rat {
		raw := os.Getenv(name)
		if raw == "" {
			return nil
		}
		v, ok := new(big.Rat).SetString(raw)
		if !ok || v.Sign() < 0 || !regexp.MustCompile(`^\d+(\.\d{1,2})?$`).MatchString(raw) {
			r.invalid = append(r.invalid, name+" (USD with at most 2 decimals, such as 0.50)")
			return nil
		}
		return v
	}
	f.MinUSD, f.CapUSD = usd("PLATFORM_FEE_MIN_USD"), usd("PLATFORM_FEE_CAP_USD")
	if f.MinUSD != nil && f.CapUSD != nil && f.MinUSD.Cmp(f.CapUSD) > 0 {
		r.invalid = append(r.invalid, "PLATFORM_FEE_MIN_USD (at most PLATFORM_FEE_CAP_USD)")
	}
	return f
}

func (r *reader) count(name string) int {
	raw := os.Getenv(name)
	if raw == "" {
		return 0
	}
	v, err := strconv.Atoi(raw)
	if err != nil || v < 1 {
		r.invalid = append(r.invalid, name+" (a whole number above 0)")
	}
	return v
}

func (r *reader) rpcSecrets() Secrets {
	raw := os.Getenv("RPC_ENDPOINT_SECRETS")
	if raw == "" {
		return nil
	}
	var secrets Secrets
	if json.Unmarshal([]byte(raw), &secrets) != nil || secrets == nil {
		r.invalid = append(r.invalid, "RPC_ENDPOINT_SECRETS (JSON object of secret references to URLs)")
		return nil
	}
	for name, value := range secrets {
		if !regexp.MustCompile(`^[A-Z][A-Z0-9_]{0,63}$`).MatchString(name) || value == "" {
			r.invalid = append(r.invalid, "RPC_ENDPOINT_SECRETS (invalid reference or empty URL)")
			return nil
		}
	}
	return secrets
}
