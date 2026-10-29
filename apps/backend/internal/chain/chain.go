// Package chain owns backend EVM endpoint configuration, clients and failover.
package chain

import (
	"context"
	"fmt"
	"math"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"

	"github.com/ethereum/go-ethereum/rpc"
	"github.com/forwend/forwend/apps/backend/internal/outbound"
	"github.com/gorilla/websocket"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type RPCs struct {
	Client *rpc.Client
	pool   *pool
}

func (r RPCs) Close() {
	r.Client.Close()
	r.pool.http.CloseIdleConnections()
	for _, e := range r.pool.endpoints {
		if e.sock != nil {
			e.sock.close()
		}
	}
}

func NewRPCs(spec Spec, rate float64, budgets ...*Budget) (RPCs, error) {
	if err := validate(spec); err != nil {
		return RPCs{}, err
	}
	if !(rate > 0) || math.IsInf(rate, 0) {
		return RPCs{}, fmt.Errorf("invalid RPC rate")
	}
	p := &pool{chainID: spec.ChainID, perCall: time.Duration(float64(time.Second) / rate), timeout: AttemptTimeout,
		http: outbound.Client(spec.AllowLoopback), maxHeadAge: spec.MaxHeadAge}
	if len(budgets) > 0 {
		p.budget = budgets[0]
	}
	// A wss endpoint dials through the same destination checks, never a proxy, and never follows a redirect.
	dialer := &websocket.Dialer{NetDialContext: outbound.Dialer(spec.AllowLoopback).DialContext, HandshakeTimeout: AttemptTimeout}
	for _, e := range ordered(spec.Endpoints) {
		ep := &endpoint{url: e.URL, host: hostOf(e.URL), name: e.ID, tier: e.Tier, budgetGroup: e.BudgetGroup}
		if strings.HasPrefix(e.URL, "wss://") || strings.HasPrefix(e.URL, "ws://") {
			ep.sock = newSocket(e.URL, dialer)
		}
		p.endpoints = append(p.endpoints, ep)
	}
	r := RPCs{pool: p}
	var err error
	if r.Client, err = rpc.DialOptions(context.Background(), fmt.Sprintf("http://chain-%d", spec.ChainID),
		rpc.WithHTTPClient(&http.Client{Transport: transport{p}})); err != nil {
		return RPCs{}, err
	}
	return r, nil
}

var urlKey = regexp.MustCompile(`(?:https?|wss?)://[^\s"'<>]+`)

func Redact(err error) string { return urlKey.ReplaceAllString(err.Error(), "<rpc-url>") }

func hostOf(raw string) string {
	u, err := url.Parse(raw)
	if err != nil {
		return ""
	}
	return u.Host
}

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
