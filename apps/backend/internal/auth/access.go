package auth

import (
	"context"
	"errors"
	"fmt"
	"slices"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

// Role is what the signed-in user is on a profile (D-93). The owner is not a member and has every permission.
type Role string

const (
	Owner     Role = "owner"
	Admin     Role = "admin"
	Developer Role = "developer"
	Finance   Role = "finance"
)

// Permission is what a {profileId} route asks for (R-138), never a role. The invoice and store permissions reach only
// a Developer's or Finance member's assigned stores.
type Permission string

const (
	InvoicesRead  Permission = "invoices.read"
	InvoicesWrite Permission = "invoices.write"
	StoresRead    Permission = "stores.read"
	StoresWrite   Permission = "stores.write"
	ClientsRead   Permission = "clients.read"
	ClientsWrite  Permission = "clients.write"
	// Balances, activity, transactions and their exports.
	MoneyRead Permission = "money.read"
	// Transaction labels and the records currency.
	MoneyWrite   Permission = "money.write"
	BillingRead  Permission = "billing.read"
	BillingWrite Permission = "billing.write"
	TokensRead   Permission = "tokens.read"
	TokensWrite  Permission = "tokens.write"
	// Jobs have no store, so only Admins reach them (D-93).
	Jobs Permission = "jobs"
	// The profile's email setting, which emails the owner alone (D-93).
	Notifications Permission = "notifications"
	// The team's members, roles and stores, and its invites (R-139).
	Team Permission = "team"
	// Leaving the team. The owner has it as every permission, but can't leave (D-93).
	Leave Permission = "team.leave"
	// The profile's secret API keys (R-144).
	Keys Permission = "keys"
)

var permissions = []Permission{InvoicesRead, InvoicesWrite, StoresRead, StoresWrite, ClientsRead, ClientsWrite, MoneyRead,
	MoneyWrite, BillingRead, BillingWrite, TokensRead, TokensWrite, Jobs, Notifications, Team, Leave, Keys}

// The one map of who may do what (D-93). The owner has every permission, these and the ones no role has.
var rolePermissions = map[Role][]Permission{
	Admin: {InvoicesRead, InvoicesWrite, StoresRead, StoresWrite, ClientsRead, ClientsWrite, MoneyRead, MoneyWrite,
		BillingRead, BillingWrite, TokensRead, TokensWrite, Jobs, Team, Leave, Keys},
	Developer: {InvoicesRead, InvoicesWrite, StoresRead, StoresWrite, TokensRead, Leave},
	Finance: {InvoicesRead, InvoicesWrite, StoresRead, ClientsRead, ClientsWrite, MoneyRead, MoneyWrite, BillingRead,
		TokensRead, Leave},
}

// Access is what the signed-in user, or a secret API key, may do on one profile.
type Access struct {
	Role Role
	// Stores is nil when every store is in reach; otherwise a Developer's or Finance member's assigned stores, or a
	// merchant key's store.
	Stores []string
	// Scopes are a key's permissions (R-144); nil for a person, whose role decides.
	Scopes []Permission
}

func (a Access) Can(p Permission) bool {
	if a.Scopes != nil {
		return slices.Contains(a.Scopes, p)
	}
	return a.Role == Owner || slices.Contains(rolePermissions[a.Role], p)
}

// Permissions are all a has, so the app shows only the pages it can use.
func (a Access) Permissions() []Permission {
	return slices.DeleteFunc(slices.Clone(permissions), func(p Permission) bool { return !a.Can(p) })
}

// StoreScoped reports whether p reaches only a member's assigned stores.
func StoreScoped(p Permission) bool {
	return p == InvoicesRead || p == InvoicesWrite || p == StoresRead || p == StoresWrite
}

// InStores reports whether a store id (or "" for none) is in reach.
func (a Access) InStores(storeID string) bool {
	return a.Stores == nil || slices.Contains(a.Stores, storeID)
}

// CheckAccess is the user's access to the profile: owner or member. Anyone else, and a malformed or unknown profile
// ID, is ErrForbidden, so callers can't probe which profiles exist.
func (s *Service) CheckAccess(ctx context.Context, privyUserID, profileID string) (Access, error) {
	var id pgtype.UUID
	if err := id.Scan(profileID); err != nil {
		return Access{}, ErrForbidden
	}
	var a Access
	err := s.pool.QueryRow(ctx, `
		SELECT CASE WHEN p.user_id = u.id THEN 'owner' ELSE m.role END,
		       CASE WHEN m.role IN ('developer', 'finance') THEN coalesce((
		           SELECT array_agg(ms.store_id::text ORDER BY s.created_at, s.id)
		           FROM member_stores ms JOIN stores s ON s.id = ms.store_id
		           WHERE ms.profile_id = p.id AND ms.user_id = u.id), '{}') END
		FROM profiles p JOIN users u ON u.privy_user_id = $2
		LEFT JOIN profile_members m ON m.profile_id = p.id AND m.user_id = u.id
		WHERE p.id = $1 AND (p.user_id = u.id OR m.user_id IS NOT NULL)`, id, privyUserID).Scan(&a.Role, &a.Stores)
	if errors.Is(err, pgx.ErrNoRows) {
		return Access{}, ErrForbidden
	}
	if err != nil {
		return Access{}, fmt.Errorf("check profile access: %w", err)
	}
	return a, nil
}

// LinkStore is the store of the profile's payment link; found is false for an unknown or malformed link id.
func (s *Service) LinkStore(ctx context.Context, profileID, linkID string) (store string, found bool, err error) {
	var id pgtype.UUID
	if id.Scan(linkID) != nil {
		return "", false, nil
	}
	err = s.pool.QueryRow(ctx, `SELECT coalesce(store_id::text, '') FROM payment_links
		WHERE id = $1 AND profile_id = $2::uuid`, id, profileID).Scan(&store)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", false, nil
	}
	if err != nil {
		return "", false, fmt.Errorf("read payment link store: %w", err)
	}
	return store, true, nil
}

// InvoiceStore is the store of the profile's invoice with this id, "" when it has none; found is false for an id
// the profile doesn't have.
func (s *Service) InvoiceStore(ctx context.Context, profileID, invoiceID string) (store string, found bool, err error) {
	err = s.pool.QueryRow(ctx, `SELECT coalesce(store_id::text, '') FROM invoices
		WHERE id = lower($1) AND profile_id = $2::uuid`, invoiceID, profileID).Scan(&store)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", false, nil
	}
	if err != nil {
		return "", false, fmt.Errorf("read invoice store: %w", err)
	}
	return store, true, nil
}
