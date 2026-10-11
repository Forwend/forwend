// Package chain reaches each chain through the RPCs of the shared chain list (packages/contracts/chains.json), in the
// order script/rpc.mjs uses: every Infura key, then the public RPCs, using only URLs whose eth_chainId matches (D-15).
package chain

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"time"

	"github.com/ethereum/go-ethereum/rpc"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Spec is one chain in the chain list.
type Spec struct {
	ChainID uint64   `json:"chainId"`
	Infura  string   `json:"infura"` // Infura network name; empty when Infura doesn't serve the chain
	Public  []string `json:"public"`
}

// Specs reads the chain list and indexes it by chain ID.
func Specs(path string) (map[uint64]Spec, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read chain list: %w", err)
	}
	var byName map[string]Spec
	if err := json.Unmarshal(raw, &byName); err != nil {
		return nil, fmt.Errorf("read chain list %s: %w", path, err)
	}
	out := map[uint64]Spec{}
	for name, s := range byName {
		if _, dup := out[s.ChainID]; dup {
			return nil, fmt.Errorf("read chain list %s: chain id %d listed twice (%s)", path, s.ChainID, name)
		}
		for _, raw := range s.Public {
			if !secureRPC(raw) {
				return nil, fmt.Errorf("read chain list %s: %s lists an RPC that is not https", path, name)
			}
		}
		out[s.ChainID] = s
	}
	return out, nil
}

// secureRPC: a network attacker on a plain-http RPC could forge both the deposit and its balance check.
func secureRPC(raw string) bool {
	u, err := url.Parse(raw)
	if err != nil {
		return false
	}
	host := u.Hostname()
	return u.Scheme == "https" || u.Scheme == "http" && (host == "localhost" || net.ParseIP(host).IsLoopback())
}

// RPCs are a chain's two clients over one pool of every Infura key and public RPC in the chain list: Primary reads
// the chain and signs, Second checks balances (D-15). Each call goes to a working endpoint of its role and moves to the
// next one when an endpoint fails (pool.go).
type RPCs struct {
	Primary, Second *rpc.Client
	pool            *pool
}

func (r RPCs) Close() {
	r.Primary.Close()
	r.Second.Close()
}

// NewRPCs makes a chain's clients over every Infura key (when the chain lists Infura), then the public RPCs. Each
// endpoint is sent at most rate calls per second. A chain listing fewer than two hosts is refused: balances must be
// confirmed by an independent provider before paid (D-15).
func NewRPCs(spec Spec, infuraKeys []string, rate float64) (RPCs, error) {
	var urls []string
	if spec.Infura != "" {
		for _, k := range infuraKeys {
			urls = append(urls, "https://"+spec.Infura+".infura.io/v3/"+k)
		}
	}
	// net/http keeps 2 idle connections per host by default: with more calls at once, each further call opened a
	// connection (and TLS session) of its own, and a busy api ran out of local ports (architecture.md#load-test).
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.MaxIdleConnsPerHost = 100
	p := &pool{chainID: spec.ChainID, perCall: time.Duration(float64(time.Second) / rate), timeout: AttemptTimeout,
		http: &http.Client{Transport: transport}}
	// Hosts alternate between the roles in list order and never fail over to the other role's: one provider must never
	// answer both a deposit and the balance that confirms it, even after an outage moved the primary.
	hosts := map[string]bool{}
	for i, u := range append(urls, spec.Public...) {
		host := hostOf(u)
		if _, seen := hosts[host]; !seen {
			hosts[host] = len(hosts)%2 == 1
		}
		p.endpoints = append(p.endpoints, &endpoint{url: u, host: host, name: fmt.Sprintf("%s#%d", host, i+1),
			second: hosts[host]})
	}
	if len(hosts) < 2 {
		return RPCs{}, fmt.Errorf("chain %d lists %d RPC host(s); D-15 needs a second, independent one",
			spec.ChainID, len(hosts))
	}
	r := RPCs{pool: p}
	var err error
	// The URLs only name the role in errors: the transport sends each request to an endpoint.
	if r.Primary, err = rpc.DialOptions(context.Background(), fmt.Sprintf("http://chain-%d-primary", spec.ChainID),
		rpc.WithHTTPClient(&http.Client{Transport: role{p, false}})); err != nil {
		return RPCs{}, err
	}
	if r.Second, err = rpc.DialOptions(context.Background(), fmt.Sprintf("http://chain-%d-second", spec.ChainID),
		rpc.WithHTTPClient(&http.Client{Transport: role{p, true}})); err != nil {
		r.Primary.Close()
		return RPCs{}, err
	}
	return r, nil
}

var urlKey = regexp.MustCompile(`(/v3/)[A-Za-z0-9_-]+`)

// Redact returns err's text with API keys in RPC URLs replaced: go-ethereum puts the full URL, Infura key included,
// into network errors. Use it for every RPC error that is logged.
func Redact(err error) string {
	return urlKey.ReplaceAllString(err.Error(), "${1}<key>")
}

func hostOf(raw string) string {
	u, err := url.Parse(raw)
	if err != nil {
		return raw
	}
	return u.Host
}

// Enabled lists the chains the worker and signer serve.
func Enabled(ctx context.Context, pool *pgxpool.Pool) ([]uint64, error) {
	rows, err := pool.Query(ctx, "SELECT chain_id FROM chains WHERE enabled ORDER BY chain_id")
	if err != nil {
		return nil, fmt.Errorf("list enabled chains: %w", err)
	}
	ids, err := pgx.CollectRows(rows, pgx.RowTo[uint64])
	if err != nil {
		return nil, fmt.Errorf("list enabled chains: %w", err)
	}
	return ids, nil
}
