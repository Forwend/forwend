package team

import (
	"context"
	"fmt"
	"regexp"
	"slices"
	"strings"

	"github.com/ensp1re/forwend/apps/backend/internal/auth"
	"github.com/ensp1re/forwend/apps/backend/internal/privy"
	"github.com/ensp1re/forwend/apps/backend/internal/profile"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Service struct {
	pool  *pgxpool.Pool
	users *privy.Client
}

func NewService(pool *pgxpool.Pool, users *privy.Client) *Service {
	return &Service{pool: pool, users: users}
}

var lowercaseUUID = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)

// lockMerchant locks the profile row, so team changes count one after another, and refuses a profile that isn't a
// merchant's.
func lockMerchant(ctx context.Context, tx pgx.Tx, profileID string) error {
	var kind string
	if err := tx.QueryRow(ctx, "SELECT kind FROM profiles WHERE id = $1 FOR UPDATE", profileID).Scan(&kind); err != nil {
		return fmt.Errorf("lock profile: %w", err)
	}
	if kind != profile.Merchant {
		return ErrNotMerchant
	}
	return nil
}

// check normalizes g: an Admin reaches every store, a Developer or Finance member one or more of the profile's.
func (g *Grant) check(ctx context.Context, tx pgx.Tx, profileID string) error {
	switch auth.Role(g.Role) {
	case auth.Admin:
		if len(g.Stores) > 0 {
			return fmt.Errorf("%w: stores: an Admin reaches every store, so leave them out", ErrInvalid)
		}
		g.Stores = []string{}
		return nil
	case auth.Developer, auth.Finance:
	default:
		return fmt.Errorf("%w: role must be admin, developer or finance", ErrInvalid)
	}
	stores := []string{}
	for _, s := range g.Stores {
		s = strings.ToLower(s)
		if !lowercaseUUID.MatchString(s) {
			return fmt.Errorf("%w: stores must list the profile's store ids", ErrInvalid)
		}
		if !slices.Contains(stores, s) {
			stores = append(stores, s)
		}
	}
	if len(stores) == 0 {
		return fmt.Errorf("%w: stores: a Developer or Finance member works with one store or more", ErrInvalid)
	}
	var found int
	if err := tx.QueryRow(ctx, "SELECT count(*) FROM stores WHERE profile_id = $1 AND id = ANY($2::uuid[])", profileID,
		stores).Scan(&found); err != nil {
		return fmt.Errorf("read stores: %w", err)
	}
	if found != len(stores) {
		return fmt.Errorf("%w: stores must list the profile's store ids", ErrInvalid)
	}
	g.Stores = stores
	return nil
}

// revokeInvitesBy closes the open invites userID sent: a member who loses the team permission can't return through
// one (R-139).
func revokeInvitesBy(ctx context.Context, tx pgx.Tx, profileID, userID string) error {
	if _, err := tx.Exec(ctx, `UPDATE profile_invites SET revoked_at = now()
		WHERE profile_id = $1 AND invited_by = $2 AND `+openInvite, profileID, userID); err != nil {
		return fmt.Errorf("revoke member's invites: %w", err)
	}
	return nil
}

// isOwner reports whether userID is the profile's owner, whom no team change reaches (D-93).
func isOwner(ctx context.Context, tx pgx.Tx, profileID, userID string) (bool, error) {
	var owner bool
	if err := tx.QueryRow(ctx, "SELECT EXISTS (SELECT 1 FROM profiles WHERE id = $1 AND user_id = $2)", profileID,
		userID).Scan(&owner); err != nil {
		return false, fmt.Errorf("read profile owner: %w", err)
	}
	return owner, nil
}
