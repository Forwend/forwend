package settlement

import (
	"context"
	"crypto/ecdsa"
	"log/slog"

	"github.com/ensp1re/forwend/apps/backend/internal/chain"
	"github.com/ethereum/go-ethereum/ethclient"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Rounds keeps the signer's RPC clients in step with the enabled chains and runs the signer once per round.
type Rounds struct {
	pool    *pgxpool.Pool
	specs   map[uint64]chain.Spec
	keys    []string
	rate    float64
	rpcs    map[uint64]chain.RPCs
	clients map[uint64]*ethclient.Client
	signer  *Signer
}

// NewRounds signs with key on the chains in specs, through their Infura keys (where a chain lists Infura) and public
// RPCs, sending each at most rate calls per second.
func NewRounds(pool *pgxpool.Pool, key *ecdsa.PrivateKey, specs map[uint64]chain.Spec, keys []string, rate float64) *Rounds {
	clients := map[uint64]*ethclient.Client{}
	return &Rounds{pool: pool, specs: specs, keys: keys, rate: rate, rpcs: map[uint64]chain.RPCs{}, clients: clients,
		signer: NewSigner(pool, key, clients)}
}

// Round serves the enabled chains, then settles what is due. A failing or rate-limited RPC is rested and its calls
// move to the chain's next one (chain.NewRPCs).
func (r *Rounds) Round(ctx context.Context) {
	ids, err := chain.Enabled(ctx, r.pool)
	if err != nil {
		// Without the enabled list a disabled chain can't be told apart: send nothing this round.
		slog.Error("signer round skipped", "err", chain.Redact(err))
		return
	}
	enabled := map[uint64]bool{}
	for _, id := range ids {
		enabled[id] = true
	}
	for id := range r.rpcs { // a chain disabled in the database is no longer served
		if !enabled[id] {
			r.close(id)
		}
	}
	for _, id := range ids {
		if _, ok := r.rpcs[id]; ok {
			continue
		}
		spec, known := r.specs[id]
		if !known {
			slog.Error("enabled chain is not in the chain list", "chain", id)
			continue
		}
		rpcs, err := chain.NewRPCs(spec, r.keys, r.rate)
		if err != nil {
			slog.Error("pick RPCs", "chain", id, "err", chain.Redact(err))
			continue
		}
		r.rpcs[id], r.clients[id] = rpcs, ethclient.NewClient(rpcs.Primary)
	}
	if err := r.signer.Run(ctx); err != nil {
		slog.Error("signer round", "err", chain.Redact(err))
	}
}

func (r *Rounds) close(id uint64) {
	r.rpcs[id].Close()
	delete(r.rpcs, id)
	delete(r.clients, id)
}

// Close closes every chain's RPC clients.
func (r *Rounds) Close() {
	for id := range r.rpcs {
		r.close(id)
	}
}
