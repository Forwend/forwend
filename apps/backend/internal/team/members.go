package team

import (
	"context"
	"errors"
	"fmt"

	"github.com/forwend/forwend/apps/backend/internal/auth"
	"github.com/jackc/pgx/v5"
)

// The caller has checked the user's access to the profile.

const memberStoresSQL = `coalesce((SELECT array_agg(ms.store_id::text ORDER BY s.created_at, s.id)
	FROM member_stores ms JOIN stores s ON s.id = ms.store_id
	WHERE ms.profile_id = m.profile_id AND ms.user_id = m.user_id), '{}')`

// List is the profile's team: the owner, the members and the open invites.
func (s *Service) List(ctx context.Context, profileID string) (Team, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT u.id::text, coalesce(u.login_email, ''), 'owner', '{}'::text[], p.created_at, 0 AS rank
		FROM profiles p JOIN users u ON u.id = p.user_id WHERE p.id = $1
		UNION ALL
		SELECT u.id::text, coalesce(u.login_email, ''), m.role, `+memberStoresSQL+`, m.created_at, 1
		FROM profile_members m JOIN users u ON u.id = m.user_id WHERE m.profile_id = $1
		ORDER BY rank, created_at, 1`, profileID)
	if err != nil {
		return Team{}, fmt.Errorf("read team: %w", err)
	}
	members, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (Member, error) {
		var m Member
		err := row.Scan(&m.UserID, &m.Email, &m.Role, &m.Stores, &m.CreatedAt, new(int))
		return m, err
	})
	if err != nil {
		return Team{}, fmt.Errorf("read team: %w", err)
	}
	rows, err = s.pool.Query(ctx, `SELECT id::text, email, role, stores::text[], created_at, expires_at
		FROM profile_invites WHERE profile_id = $1 AND `+openInvite+` ORDER BY created_at DESC, id`, profileID)
	if err != nil {
		return Team{}, fmt.Errorf("read invites: %w", err)
	}
	invites, err := pgx.CollectRows(rows, pgx.RowToStructByPos[Invite])
	if err != nil {
		return Team{}, fmt.Errorf("read invites: %w", err)
	}
	return Team{Members: members, Invites: invites}, nil
}

// ToRoll is what a member who no longer may could still use: API keys they made that work, and, for a former Admin,
// every webhook endpoint, whose signing secret they could reveal. The owner rolls them (D-93).
type ToRoll struct {
	Keys      []RollKey
	Endpoints []RollEndpoint
}

type RollKey struct{ ID, Name, Last4 string }

type RollEndpoint struct{ ID, URL string }

func toRoll(ctx context.Context, tx pgx.Tx, profileID, userID string, wasAdmin bool) (ToRoll, error) {
	var out ToRoll
	rows, err := tx.Query(ctx, `SELECT id::text, name, last4 FROM api_keys WHERE profile_id = $1 AND created_by = $2
		AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now()) ORDER BY created_at`, profileID, userID)
	if err != nil {
		return ToRoll{}, fmt.Errorf("read the member's keys: %w", err)
	}
	if out.Keys, err = pgx.CollectRows(rows, pgx.RowToStructByPos[RollKey]); err != nil {
		return ToRoll{}, fmt.Errorf("read the member's keys: %w", err)
	}
	if !wasAdmin {
		return out, nil
	}
	rows, err = tx.Query(ctx, "SELECT id::text, url FROM webhook_endpoints WHERE profile_id = $1 ORDER BY created_at",
		profileID)
	if err != nil {
		return ToRoll{}, fmt.Errorf("read webhook endpoints: %w", err)
	}
	if out.Endpoints, err = pgx.CollectRows(rows, pgx.RowToStructByPos[RollEndpoint]); err != nil {
		return ToRoll{}, fmt.Errorf("read webhook endpoints: %w", err)
	}
	return out, nil
}

// SetMember gives a member another role and stores (D-63: the caller asked for a fresh sign-in). An Admin given
// another role leaves what they could still use (ToRoll).
func (s *Service) SetMember(ctx context.Context, profileID, userID, privyUserID string, g Grant) (Member, ToRoll, error) {
	if !lowercaseUUID.MatchString(userID) {
		return Member{}, ToRoll{}, ErrMemberNotFound
	}
	var m Member
	var roll ToRoll
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		if err := lockMerchant(ctx, tx, profileID); err != nil {
			return err
		}
		if err := requireTeam(ctx, tx, profileID, privyUserID); err != nil {
			return err
		}
		if owner, err := isOwner(ctx, tx, profileID, userID); err != nil {
			return err
		} else if owner {
			return fmt.Errorf("%w: the owner is an Admin for good", ErrInvalid)
		}
		if err := g.check(ctx, tx, profileID); err != nil {
			return err
		}
		var old string
		err := tx.QueryRow(ctx, `UPDATE profile_members m SET role = $3 FROM profile_members was
			WHERE m.profile_id = $1 AND m.user_id = $2 AND was.profile_id = m.profile_id AND was.user_id = m.user_id
			RETURNING was.role`, profileID, userID, g.Role).Scan(&old)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrMemberNotFound
		} else if err != nil {
			return fmt.Errorf("save member role: %w", err)
		}
		if old == string(auth.Admin) && g.Role != string(auth.Admin) {
			if roll, err = toRoll(ctx, tx, profileID, userID, true); err != nil {
				return err
			}
		}
		if !(auth.Access{Role: auth.Role(g.Role)}).Can(auth.Team) {
			if err := revokeInvitesBy(ctx, tx, profileID, userID); err != nil {
				return err
			}
		}
		if _, err := tx.Exec(ctx, "DELETE FROM member_stores WHERE profile_id = $1 AND user_id = $2", profileID,
			userID); err != nil {
			return fmt.Errorf("save member stores: %w", err)
		}
		if _, err := tx.Exec(ctx, `INSERT INTO member_stores (profile_id, user_id, store_id)
			SELECT $1, $2, unnest($3::uuid[])`, profileID, userID, g.Stores); err != nil {
			return fmt.Errorf("save member stores: %w", err)
		}
		return tx.QueryRow(ctx, `SELECT u.id::text, coalesce(u.login_email, ''), m.role, `+memberStoresSQL+`, m.created_at
			FROM profile_members m JOIN users u ON u.id = m.user_id WHERE m.profile_id = $1 AND m.user_id = $2`,
			profileID, userID).Scan(&m.UserID, &m.Email, &m.Role, &m.Stores, &m.CreatedAt)
	})
	return m, roll, err
}

// RemoveMember takes a member off the team. Their next request no longer reaches the profile; what they could still
// use comes back for the owner to roll (ToRoll).
func (s *Service) RemoveMember(ctx context.Context, profileID, userID string) (ToRoll, error) {
	if !lowercaseUUID.MatchString(userID) {
		return ToRoll{}, ErrMemberNotFound
	}
	var roll ToRoll
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		// The profile lock orders this after or before an invite the member is sending, so revoking catches it.
		if err := lockMerchant(ctx, tx, profileID); err != nil {
			return err
		}
		if owner, err := isOwner(ctx, tx, profileID, userID); err != nil {
			return err
		} else if owner {
			return fmt.Errorf("%w: the owner stays on the team", ErrInvalid)
		}
		var role string
		err := tx.QueryRow(ctx, "DELETE FROM profile_members WHERE profile_id = $1 AND user_id = $2 RETURNING role",
			profileID, userID).Scan(&role)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrMemberNotFound
		} else if err != nil {
			return fmt.Errorf("remove member: %w", err)
		}
		if roll, err = toRoll(ctx, tx, profileID, userID, role == string(auth.Admin)); err != nil {
			return err
		}
		return revokeInvitesBy(ctx, tx, profileID, userID)
	})
	return roll, err
}

// Leave takes the signed-in member off the team. The owner can't leave, so a team always keeps an Admin (D-93).
func (s *Service) Leave(ctx context.Context, profileID, privyUserID string) error {
	var userID string
	if err := s.pool.QueryRow(ctx, "SELECT id::text FROM users WHERE privy_user_id = $1", privyUserID).
		Scan(&userID); err != nil {
		return fmt.Errorf("read user: %w", err)
	}
	_, err := s.RemoveMember(ctx, profileID, userID)
	return err
}
