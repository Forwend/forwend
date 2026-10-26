package team

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"net/mail"
	"regexp"
	"strings"
	"unicode/utf8"

	"github.com/forwend/forwend/apps/backend/internal/auth"
	"github.com/forwend/forwend/apps/backend/internal/invoice"
	"github.com/forwend/forwend/apps/backend/internal/outbox"
	"github.com/forwend/forwend/apps/backend/internal/profile"
	"github.com/jackc/pgx/v5"
)

var inviteToken = regexp.MustCompile(`^[0-9a-f]{64}$`)

// tokenHash is what profile_invites keeps of a link token.
func tokenHash(token string) []byte {
	sum := sha256.Sum256([]byte(token))
	return sum[:]
}

const openInvite = "accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now()"

// Invite queues an email inviting the address to the team with g (D-63: the caller asked for a fresh sign-in). An open
// invite to the same address is revoked. Invites count toward the client email cap (R-116).
func (s *Service) Invite(ctx context.Context, profileID, privyUserID, email string, g Grant) (Invite, error) {
	email = strings.ToLower(strings.TrimSpace(email))
	// As a client email is checked: plain text, and exactly one address with nothing around it.
	if a, err := mail.ParseAddress(email); err != nil || a.Address != email || len(email) > profile.MaxClientEmail ||
		!utf8.ValidString(email) || !profile.PlainText(email, false) {
		return Invite{}, fmt.Errorf("%w: email: enter an address like name@example.com", ErrInvalid)
	}
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return Invite{}, fmt.Errorf("make invite token: %w", err)
	}
	token := hex.EncodeToString(raw)
	v := Invite{Email: email}
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		if err := lockMerchant(ctx, tx, profileID); err != nil {
			return err
		}
		// Checked again under the lock: a member removed or changed since the request's access check sends nothing.
		var role string
		err := tx.QueryRow(ctx, `SELECT CASE WHEN p.user_id = u.id THEN 'owner' ELSE m.role END
			FROM profiles p JOIN users u ON u.privy_user_id = $2
			LEFT JOIN profile_members m ON m.profile_id = p.id AND m.user_id = u.id
			WHERE p.id = $1 AND (p.user_id = u.id OR m.user_id IS NOT NULL)`, profileID, privyUserID).Scan(&role)
		if errors.Is(err, pgx.ErrNoRows) {
			return auth.ErrForbidden
		} else if err != nil {
			return fmt.Errorf("read inviter: %w", err)
		}
		if !(auth.Access{Role: auth.Role(role)}).Can(auth.Team) {
			return auth.ErrForbidden
		}
		if err := g.check(ctx, tx, profileID); err != nil {
			return err
		}
		var onTeam bool
		if err := tx.QueryRow(ctx, `SELECT EXISTS (
			SELECT 1 FROM profiles p JOIN users u ON u.id = p.user_id WHERE p.id = $1 AND u.login_email = $2
			UNION ALL
			SELECT 1 FROM profile_members m JOIN users u ON u.id = m.user_id WHERE m.profile_id = $1 AND u.login_email = $2)`,
			profileID, email).Scan(&onTeam); err != nil {
			return fmt.Errorf("read team emails: %w", err)
		}
		if onTeam {
			return ErrOnTeam
		}
		left, wait, err := outbox.ClientEmailsLeft(ctx, tx, profileID)
		if err != nil {
			return err
		} else if left == 0 {
			return &invoice.TooSoonError{Wait: wait}
		}
		if _, err := tx.Exec(ctx, `UPDATE profile_invites SET revoked_at = now()
			WHERE profile_id = $1 AND email = $2 AND accepted_at IS NULL AND revoked_at IS NULL`, profileID, email); err != nil {
			return fmt.Errorf("revoke the last invite: %w", err)
		}
		if err := tx.QueryRow(ctx, `INSERT INTO profile_invites (profile_id, email, role, stores, token_hash, invited_by)
			SELECT $1, $2, $3, $4::uuid[], $5, id FROM users WHERE privy_user_id = $6
			RETURNING id::text, role, stores::text[], created_at, expires_at`,
			profileID, email, g.Role, g.Stores, tokenHash(token), privyUserID).
			Scan(&v.ID, &v.Role, &v.Stores, &v.CreatedAt, &v.ExpiresAt); err != nil {
			return fmt.Errorf("save invite: %w", err)
		}
		return outbox.QueueInvite(ctx, tx, v.ID, token)
	})
	return v, err
}

// Revoke closes an open invite, so its link no longer works.
func (s *Service) Revoke(ctx context.Context, profileID, inviteID string) error {
	if !lowercaseUUID.MatchString(inviteID) {
		return ErrInviteNotFound
	}
	tag, err := s.pool.Exec(ctx, `UPDATE profile_invites SET revoked_at = now() WHERE id = $1 AND profile_id = $2 AND `+
		openInvite, inviteID, profileID)
	if err != nil {
		return fmt.Errorf("revoke invite: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrInviteNotFound
	}
	return nil
}

// Invitation is the open invite a link token names, for any signed-in user who has the link.
func (s *Service) Invitation(ctx context.Context, token string) (Invitation, error) {
	if !inviteToken.MatchString(token) {
		return Invitation{}, ErrInviteNotFound
	}
	var v Invitation
	err := s.pool.QueryRow(ctx, `SELECT coalesce(p.name, ''), i.email, i.role, i.expires_at
		FROM profile_invites i JOIN profiles p ON p.id = i.profile_id WHERE i.token_hash = $1 AND `+openInvite,
		tokenHash(token)).Scan(&v.ProfileName, &v.Email, &v.Role, &v.ExpiresAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return Invitation{}, ErrInviteNotFound
	} else if err != nil {
		return Invitation{}, fmt.Errorf("read invite: %w", err)
	}
	return v, nil
}

// Accept puts the signed-in user on the team with the invite's role and stores, once, when their verified login email
// is the invited address. It returns the profile's id.
func (s *Service) Accept(ctx context.Context, token, privyUserID string) (string, error) {
	if !inviteToken.MatchString(token) {
		return "", ErrInviteNotFound
	}
	// Read before the transaction: a Privy call holds no row lock.
	email, err := s.users.LoginEmail(ctx, privyUserID)
	if err != nil {
		return "", err
	}
	var profileID string
	err = pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		// The profile row first, as Invite and the role changes lock it, then the invite: no two wait on each other.
		err := tx.QueryRow(ctx, "SELECT profile_id::text FROM profile_invites WHERE token_hash = $1",
			tokenHash(token)).Scan(&profileID)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrInviteNotFound
		} else if err != nil {
			return fmt.Errorf("read invite: %w", err)
		}
		if err := lockMerchant(ctx, tx, profileID); err != nil {
			return err
		}
		var id, invited, role, userID string
		var stores []string
		err = tx.QueryRow(ctx, `SELECT id::text, email, role, stores::text[] FROM profile_invites
			WHERE token_hash = $1 AND `+openInvite+` FOR UPDATE`, tokenHash(token)).Scan(&id, &invited, &role, &stores)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrInviteNotFound
		} else if err != nil {
			return fmt.Errorf("read invite: %w", err)
		}
		if email == "" || email != invited {
			return ErrOtherEmail
		}
		err = tx.QueryRow(ctx, "SELECT id::text FROM users WHERE privy_user_id = $1", privyUserID).Scan(&userID)
		if errors.Is(err, pgx.ErrNoRows) {
			return profile.ErrNotSignedUp
		} else if err != nil {
			return fmt.Errorf("read user: %w", err)
		}
		if owner, err := isOwner(ctx, tx, profileID, userID); err != nil {
			return err
		} else if owner {
			return ErrOnTeam
		}
		tag, err := tx.Exec(ctx, `INSERT INTO profile_members (profile_id, user_id, role) VALUES ($1, $2, $3)
			ON CONFLICT DO NOTHING`, profileID, userID, role)
		if err != nil {
			return fmt.Errorf("add member: %w", err)
		}
		if tag.RowsAffected() == 0 {
			return ErrOnTeam
		}
		if _, err := tx.Exec(ctx, `INSERT INTO member_stores (profile_id, user_id, store_id)
			SELECT $1, $2, id FROM stores WHERE profile_id = $1 AND id = ANY($3::uuid[])`, profileID, userID,
			stores); err != nil {
			return fmt.Errorf("add member stores: %w", err)
		}
		// The member came for the team, so the first run's profile choice is not asked (R-50).
		if _, err := tx.Exec(ctx, `UPDATE users SET onboarded_at = coalesce(onboarded_at, now()) WHERE id = $1`,
			userID); err != nil {
			return fmt.Errorf("mark user onboarded: %w", err)
		}
		if _, err := tx.Exec(ctx, "UPDATE profile_invites SET accepted_at = now() WHERE id = $1", id); err != nil {
			return fmt.Errorf("mark invite accepted: %w", err)
		}
		return nil
	})
	return profileID, err
}
