package chain

import (
	"context"
	"fmt"
	"regexp"
	"slices"
	"strings"
	"time"

	"github.com/forwend/forwend/apps/backend/internal/outbound"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Role string
type Tier string

const (
	Primary      Role = "primary"
	Confirmation Role = "confirmation"
	Private      Tier = "private"
	Public       Tier = "public"
)

type Endpoint struct {
	ID          string
	Provider    string
	Role        Role
	Tier        Tier
	Priority    int
	URL         string `json:"-"`
	BudgetGroup string
}

// String prevents accidental formatting of a resolved private URL.
func (e Endpoint) String() string   { return e.ID }
func (e Endpoint) GoString() string { return e.ID }

type Spec struct {
	ChainID       uint64
	Name          string
	Endpoints     []Endpoint
	AllowLoopback bool
	MaxHeadAge    time.Duration
}

var identifier = regexp.MustCompile(`^[a-z][a-z0-9_-]{0,63}$`)

// Specs loads a single database snapshot. Secrets are resolved only here and never stored back in Postgres.
func Specs(ctx context.Context, db *pgxpool.Pool, secrets map[string]string, allowLoopback bool) (map[uint64]Spec, error) {
	rows, err := db.Query(ctx, `SELECT c.chain_id, c.name, c.chain_family, c.rpc_max_head_age_seconds,
 e.id, e.provider, e.role, e.tier, e.priority, e.public_url, e.secret_ref, e.budget_group
 FROM chains c LEFT JOIN rpc_endpoints e ON e.chain_id = c.chain_id AND e.enabled
 WHERE c.enabled ORDER BY c.chain_id, e.id`)
	if err != nil {
		return nil, fmt.Errorf("load RPC configuration: %w", err)
	}
	defer rows.Close()
	specs := map[uint64]Spec{}
	for rows.Next() {
		var id uint64
		var name, family string
		var age int
		var endpointID, provider, role, tier, publicURL, secretRef, budget *string
		var priority *int
		if err := rows.Scan(&id, &name, &family, &age, &endpointID, &provider, &role, &tier, &priority, &publicURL, &secretRef, &budget); err != nil {
			return nil, fmt.Errorf("read RPC configuration: %w", err)
		}
		if family != "evm" {
			return nil, fmt.Errorf("chain %d: unsupported RPC family", id)
		}
		spec := specs[id]
		spec.ChainID, spec.Name, spec.AllowLoopback, spec.MaxHeadAge = id, name, allowLoopback, time.Duration(age)*time.Second
		if endpointID != nil {
			e := Endpoint{ID: *endpointID, Provider: *provider, Role: Role(*role), Tier: Tier(*tier), Priority: *priority, BudgetGroup: *budget}
			if secretRef != nil {
				e.URL = secrets[*secretRef]
				if e.URL == "" {
					return nil, fmt.Errorf("chain %d endpoint %s: missing RPC secret reference", id, e.ID)
				}
			} else {
				e.URL = *publicURL
			}
			spec.Endpoints = append(spec.Endpoints, e)
		}
		specs[id] = spec
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("read RPC configuration: %w", err)
	}
	for id, spec := range specs {
		if err := validate(spec); err != nil {
			return nil, err
		}
		specs[id] = spec
	}
	return specs, nil
}

func validate(spec Spec) error {
	if spec.ChainID == 0 {
		return fmt.Errorf("RPC chain ID must be positive")
	}
	ids, urls := map[string]bool{}, map[string]bool{}
	for _, e := range spec.Endpoints {
		if !identifier.MatchString(e.ID) || !identifier.MatchString(e.Provider) || !identifier.MatchString(e.BudgetGroup) {
			return fmt.Errorf("chain %d: invalid RPC metadata identifier", spec.ChainID)
		}
		invalid := func(reason string) error { return fmt.Errorf("chain %d endpoint %s: %s", spec.ChainID, e.ID, reason) }
		if e.Role != Primary && e.Role != Confirmation || e.Tier != Private && e.Tier != Public || e.Priority < 0 {
			return invalid("invalid role, tier or priority")
		}
		if ids[e.ID] || urls[e.URL] {
			return invalid("duplicate endpoint")
		}
		ids[e.ID], urls[e.URL] = true, true
		if !outbound.ValidURL(e.URL, spec.AllowLoopback) {
			return invalid("invalid or disallowed RPC URL")
		}
	}
	if len(spec.Endpoints) == 0 {
		return fmt.Errorf("chain %d: at least one RPC endpoint required", spec.ChainID)
	}
	return nil
}

func ordered(endpoints []Endpoint) []Endpoint {
	result := slices.Clone(endpoints)
	slices.SortFunc(result, func(a, b Endpoint) int {
		if a.Tier != b.Tier {
			if a.Tier == Private {
				return -1
			}
			return 1
		}
		if a.Priority != b.Priority {
			if a.Priority < b.Priority {
				return -1
			}
			return 1
		}
		return strings.Compare(a.ID, b.ID)
	})
	return result
}
