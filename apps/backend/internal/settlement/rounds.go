package settlement

import (
	"context"
	"crypto/ecdsa"
	"log/slog"

	"github.com/ethereum/go-ethereum/ethclient"
	"github.com/forwend/forwend/apps/backend/internal/chain"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Rounds struct {
	pool    *pgxpool.Pool
	specs   map[uint64]chain.Spec
	rate    float64
	rpcs    map[uint64]chain.RPCs
	signers map[uint64]*Signer
	key     *ecdsa.PrivateKey
	held    func(context.Context) error
	users   *userTurns
	jobs    chain.Jobs
	budgets []*chain.Budget
}

// rate is the most calls per second sent to each RPC.
func NewRounds(pool *pgxpool.Pool, key *ecdsa.PrivateKey, specs map[uint64]chain.Spec, rate float64,
	held func(context.Context) error, budgets ...*chain.Budget) *Rounds {
	return &Rounds{budgets: budgets, pool: pool, specs: specs, rate: rate, rpcs: map[uint64]chain.RPCs{},
		signers: map[uint64]*Signer{}, key: key, held: held, users: &userTurns{}}
}

// A failing or rate-limited RPC is rested and its calls move to the chain's next one (chain.NewRPCs).
func (r *Rounds) Round(ctx context.Context) {
	r.Tick(ctx)
	r.jobs.Wait()
}

func (r *Rounds) Tick(ctx context.Context) {
	ids, err := chain.Enabled(ctx, r.pool)
	if err != nil {
		// Without the enabled list a disabled chain can't be told apart: send nothing this round.
		slog.Error("signer round skipped", "err", chain.Redact(err))
		for id := range r.rpcs {
			r.jobs.Cancel(id)
		}
		return
	}
	enabled := map[uint64]bool{}
	for _, id := range ids {
		enabled[id] = true
	}
	for id := range r.rpcs { // a chain disabled in the database is no longer served
		if !enabled[id] {
			r.jobs.Cancel(id)
			if r.jobs.Idle(id) {
				r.close(id)
			}
		}
	}
	for _, id := range ids {
		if !r.jobs.Idle(id) {
			continue
		}
		if s := r.signers[id]; s != nil {
			r.start(ctx, id, s)
			continue
		}
		spec, known := r.specs[id]
		if !known {
			slog.Error("enabled chain is not in the chain list", "chain", id)
			continue
		}
		rpcs, err := chain.NewRPCs(spec, r.rate, r.budgets...)
		if err != nil {
			slog.Error("pick RPCs", "chain", id, "err", chain.Redact(err))
			continue
		}
		s := NewSigner(r.pool, r.key, map[uint64]*ethclient.Client{id: ethclient.NewClient(rpcs.Client)})
		s.held, s.users = r.held, r.users
		r.rpcs[id], r.signers[id] = rpcs, s
		r.start(ctx, id, s)
	}
}

func (r *Rounds) start(ctx context.Context, id uint64, s *Signer) {
	r.jobs.Start(ctx, id, func(ctx context.Context) {
		if err := s.Run(ctx); err != nil {
			slog.Error("signer round", "chain", id, "err", chain.Redact(err))
		}
	})
}

func (r *Rounds) close(id uint64) {
	r.rpcs[id].Close()
	delete(r.rpcs, id)
	delete(r.signers, id)
}

func (r *Rounds) Close() {
	r.jobs.Close()
	for id := range r.rpcs {
		r.close(id)
	}
}
