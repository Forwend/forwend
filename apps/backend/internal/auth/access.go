package auth

import (
	"context"
	"errors"
	"fmt"
	"slices"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

// The owner is not a member and has every permission.
type Role string

const (
	Owner     Role = "owner"
	Admin     Role = "admin"
	Developer Role = "developer"
	Finance   Role = "finance"
)

// Permission is what a {profileId} route asks for, never a role.
type Permission string

const (
	InvoicesRead  Permission = "invoices.read"
	InvoicesWrite Permission = "invoices.write"
	StoresRead    Permission = "stores.read"
	StoresWrite   Permission = "stores.write"
	ClientsRead   Permission = "clients.read"
	ClientsWrite  Permission = "clients.write"
	MoneyRead     Permission = "money.read"
	MoneyWrite    Permission = "money.write" // labels and the records currency
	MoneyMove     Permission = "money.move"  // no role has it: only the owner moves money
	BillingRead   Permission = "billing.read"
	BillingWrite  Permission = "billing.write"
	TokensRead    Permission = "tokens.read"
	TokensWrite   Permission = "tokens.write"
	Jobs          Permission = "jobs"
	Notifications Permission = "notifications"
	Team          Permission = "team"
	Leave         Permission = "team.leave"
	Keys          Permission = "keys"
	Webhooks      Permission = "webhooks"
)

var permissions = []Permission{InvoicesRead, InvoicesWrite, StoresRead, StoresWrite, ClientsRead, ClientsWrite, MoneyRead,
	MoneyWrite, MoneyMove, BillingRead, BillingWrite, TokensRead, TokensWrite, Jobs, Notifications, Team, Leave, Keys, Webhooks}

// The one map of who may do what; the owner has every permission.
var rolePermissions = map[Role][]Permission{
	Admin: {InvoicesRead, InvoicesWrite, StoresRead, StoresWrite, ClientsRead, ClientsWrite, MoneyRead, MoneyWrite,
		BillingRead, BillingWrite, TokensRead, TokensWrite, Jobs, Team, Leave, Keys, Webhooks},
	Developer: {InvoicesRead, InvoicesWrite, StoresRead, StoresWrite, TokensRead, Leave},
	Finance: {InvoicesRead, InvoicesWrite, StoresRead, ClientsRead, ClientsWrite, MoneyRead, MoneyWrite, BillingRead,
		TokensRead, Leave},
}

// Access is what the signed-in user, or a secret API key, may do on one profile.
type Access struct {
	Role     Role
	Stores   []string     // nil when every store is in reach
	Scopes   []Permission // a key's; nil for a person, whose role decides
	Livemode *bool
}

func (a Access) Can(p Permission) bool {
	if a.Scopes != nil {
		return slices.Contains(a.Scopes, p)
	}
	return a.Role == Owner || slices.Contains(rolePermissions[a.Role], p)
}

func (a Access) Permissions() []Permission {
	return slices.DeleteFunc(slices.Clone(permissions), func(p Permission) bool { return !a.Can(p) })
}

func StoreScoped(p Permission) bool {
	return p == InvoicesRead || p == InvoicesWrite || p == StoresRead || p == StoresWrite
}

func (a Access) InStores(storeID string) bool {
	return a.Stores == nil || slices.Contains(a.Stores, storeID)
}

// onProfileSQL finds profile $1 for Privy user $2 only when they own it or are a member.
const (
	roleSQL      = "CASE WHEN p.user_id = u.id THEN 'owner' ELSE m.role END"
	onProfileSQL = `FROM profiles p JOIN users u ON u.privy_user_id = $2
		LEFT JOIN profile_members m ON m.profile_id = p.id AND m.user_id = u.id
		WHERE p.id = $1 AND (p.user_id = u.id OR m.user_id IS NOT NULL)`
)

// CheckAccess: anyone else, or a malformed or unknown profile ID, is ErrForbidden, so nobody can probe ids.
func (s *Service) CheckAccess(ctx context.Context, privyUserID, profileID string) (Access, error) {
	var id pgtype.UUID
	if err := id.Scan(profileID); err != nil {
		return Access{}, ErrForbidden
	}
	var a Access
	var live bool
	err := s.pool.QueryRow(ctx, `SELECT p.livemode, `+roleSQL+`,
		       CASE WHEN m.role IN ('developer', 'finance') THEN coalesce((
		           SELECT array_agg(ms.store_id::text ORDER BY s.created_at, s.id)
		           FROM member_stores ms JOIN stores s ON s.id = ms.store_id
		           WHERE ms.profile_id = p.id AND ms.user_id = u.id), '{}') END
		`+onProfileSQL, id, privyUserID).Scan(&live, &a.Role, &a.Stores)
	if errors.Is(err, pgx.ErrNoRows) {
		return Access{}, ErrForbidden
	}
	if err != nil {
		return Access{}, fmt.Errorf("check profile access: %w", err)
	}
	a.Livemode = &live
	return a, nil
}

// StillCan rechecks p under the profile lock, in its own statement, so a removal it waited for counts.
func StillCan(ctx context.Context, tx pgx.Tx, profileID, privyUserID string, p Permission) error {
	if _, err := tx.Exec(ctx, "SELECT 1 FROM profiles WHERE id = $1 FOR KEY SHARE", profileID); err != nil {
		return fmt.Errorf("lock profile: %w", err)
	}
	var role Role
	err := tx.QueryRow(ctx, "SELECT "+roleSQL+" "+onProfileSQL, profileID, privyUserID).Scan(&role)
	if errors.Is(err, pgx.ErrNoRows) || err == nil && !(Access{Role: role}).Can(p) {
		return ErrForbidden
	}
	if err != nil {
		return fmt.Errorf("check profile access: %w", err)
	}
	return nil
}

func (s *Service) LinkStore(ctx context.Context, profileID, linkID string) (store string, live, found bool, err error) {
	var id pgtype.UUID
	if id.Scan(linkID) != nil {
		return "", false, false, nil
	}
	err = s.pool.QueryRow(ctx, `SELECT coalesce(store_id::text, ''), livemode FROM payment_links
		WHERE id = $1 AND profile_id = $2::uuid`, id, profileID).Scan(&store, &live)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", false, false, nil
	}
	if err != nil {
		return "", false, false, fmt.Errorf("read payment link store: %w", err)
	}
	return store, live, true, nil
}

func (s *Service) InvoiceStore(ctx context.Context, profileID, invoiceID string) (store string, live, found bool,
	err error) {
	err = s.pool.QueryRow(ctx, `SELECT coalesce(store_id::text, ''),
		    (SELECT livemode FROM chains c WHERE c.chain_id = invoices.chain_id)
		FROM invoices WHERE id = lower($1) AND profile_id = $2::uuid`, invoiceID, profileID).Scan(&store, &live)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", false, false, nil
	}
	if err != nil {
		return "", false, false, fmt.Errorf("read invoice store: %w", err)
	}
	return store, live, true, nil
}
