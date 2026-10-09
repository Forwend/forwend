// Package chain picks the RPCs for each chain from the shared chain list (packages/contracts/chains.json), the same
// way script/rpc.mjs does: every Infura key, then the public RPCs, keeping only URLs whose eth_chainId matches (D-15).
package chain

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
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
		out[s.ChainID] = s
	}
	return out, nil
}

// RPCs are the chain's clients on two different hosts: Primary for reading the chain and signing, Second for
// balance checks (D-15).
type RPCs struct {
	Primary, Second *rpc.Client
}

func (r RPCs) Close() {
	r.Primary.Close()
	r.Second.Close()
}

// Dial returns the first two working RPCs on different hosts. A chain with fewer is not served: balances must be
// confirmed by an independent provider before paid (D-15).
func Dial(ctx context.Context, spec Spec, infuraKeys []string) (RPCs, error) {
	var urls []string
	if spec.Infura != "" {
		for _, k := range infuraKeys {
			urls = append(urls, "https://"+spec.Infura+".infura.io/v3/"+k)
		}
	}
	urls = append(urls, spec.Public...)

	var picked RPCs
	var firstHost string
	for _, u := range urls {
		host := hostOf(u)
		if picked.Primary != nil && host == firstHost {
			continue
		}
		c, err := dial(ctx, u, spec.ChainID)
		if err != nil {
			continue // key without access, rate limited, or down; never log the URL: it may hold a key
		}
		if picked.Primary == nil {
			picked.Primary, firstHost = c, host
			continue
		}
		picked.Second = c
		return picked, nil
	}
	if picked.Primary == nil {
		return RPCs{}, fmt.Errorf("no working RPC for chain %d", spec.ChainID)
	}
	picked.Primary.Close()
	return RPCs{}, fmt.Errorf("chain %d has one working RPC host (%s); D-15 needs a second, independent one",
		spec.ChainID, firstHost)
}

var urlKey = regexp.MustCompile(`(/v3/)[A-Za-z0-9_-]+`)

// Redact returns err's text with API keys in RPC URLs replaced: go-ethereum puts the full URL, Infura key included,
// into network errors. Use it for every RPC error that is logged.
func Redact(err error) string {
	return urlKey.ReplaceAllString(err.Error(), "${1}<key>")
}

func dial(ctx context.Context, u string, chainID uint64) (*rpc.Client, error) {
	ctx, cancel := context.WithTimeout(ctx, 8*time.Second)
	defer cancel()
	c, err := rpc.DialContext(ctx, u)
	if err != nil {
		return nil, err
	}
	var id string
	if err := c.CallContext(ctx, &id, "eth_chainId"); err != nil {
		c.Close()
		return nil, err
	}
	var got uint64
	if _, err := fmt.Sscanf(id, "0x%x", &got); err != nil || got != chainID {
		c.Close()
		return nil, errors.New("wrong chain")
	}
	return c, nil
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
