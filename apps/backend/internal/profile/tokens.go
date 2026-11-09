package profile

import (
	"cmp"
	"context"
	"fmt"
	"slices"
	"strings"

	"github.com/jackc/pgx/v5"
)

// TokenPair names a token by its chain and contract, in lowercase hex.
type TokenPair struct {
	ChainID uint64
	Token   string
}

// TokenSwitch is an enabled token and whether the profile has it on (R-136).
type TokenSwitch struct {
	TokenPair
	Symbol   string
	Decimals int
	Network  string // the chain's name
	On       bool
}

// Tokens lists every enabled token of the profile's mode (R-221) with its saved profile preference.
func (s *Service) Tokens(ctx context.Context, profileID string) ([]TokenSwitch, error) {
	rows, err := s.pool.Query(ctx, `SELECT t.chain_id, t.contract, t.symbol, t.decimals, c.name,
		    NOT EXISTS (SELECT 1 FROM profile_tokens_off o
		                WHERE o.profile_id = $1 AND o.chain_id = t.chain_id AND o.token_contract = t.contract)
		FROM tokens t JOIN chains c ON c.chain_id = t.chain_id
		WHERE t.enabled AND c.enabled AND c.livemode = (SELECT livemode FROM profiles WHERE id = $1)
		ORDER BY t.chain_id, t.symbol, t.contract`, profileID)
	if err != nil {
		return nil, fmt.Errorf("list tokens: %w", err)
	}
	list, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (TokenSwitch, error) {
		var t TokenSwitch
		err := row.Scan(&t.ChainID, &t.Token, &t.Symbol, &t.Decimals, &t.Network, &t.On)
		return t, err
	})
	if err != nil {
		return nil, fmt.Errorf("list tokens: %w", err)
	}
	return list, nil
}

// CrossChain reports whether the profile takes payments from other chains through NEAR Intents (R-240).
func (s *Service) CrossChain(ctx context.Context, profileID string) (bool, error) {
	var off bool
	if err := s.pool.QueryRow(ctx, "SELECT crosschain_off FROM profiles WHERE id = $1", profileID).Scan(&off); err != nil {
		return false, fmt.Errorf("read cross-chain switch: %w", err)
	}
	return !off, nil
}

// SetCrossChain turns payments from other chains on or off for new quotes; an open quote still finishes (R-240).
func (s *Service) SetCrossChain(ctx context.Context, profileID string, on bool) error {
	if _, err := s.pool.Exec(ctx, "UPDATE profiles SET crosschain_off = $2 WHERE id = $1", profileID, !on); err != nil {
		return fmt.Errorf("save cross-chain switch: %w", err)
	}
	return nil
}

// SetTokensOff replaces the available tokens of the profile's mode it has off, preserving the other mode's and
// unavailable tokens' preferences.
func (s *Service) SetTokensOff(ctx context.Context, profileID string, off []TokenPair) ([]TokenSwitch, error) {
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		// The profile row lock makes concurrent saves replace the list one after another.
		if _, err := tx.Exec(ctx, "SELECT 1 FROM profiles WHERE id = $1 FOR UPDATE", profileID); err != nil {
			return fmt.Errorf("lock profile: %w", err)
		}
		off, err := enabledOff(ctx, tx, "off", off)
		if err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `DELETE FROM profile_tokens_off o USING tokens t, chains c
			WHERE o.profile_id = $1 AND o.chain_id = t.chain_id AND o.token_contract = t.contract
			AND c.chain_id = t.chain_id AND t.enabled AND c.enabled
			AND c.livemode = (SELECT livemode FROM profiles WHERE id = $1)`, profileID); err != nil {
			return fmt.Errorf("save tokens off: %w", err)
		}
		for _, t := range off {
			if _, err := tx.Exec(ctx, `INSERT INTO profile_tokens_off (profile_id, chain_id, token_contract)
				VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, profileID, t.ChainID, t.Token); err != nil {
				return fmt.Errorf("save tokens off: %w", err)
			}
		}
		return checkTokensOn(ctx, tx, profileID, "")
	})
	if err != nil {
		return nil, err
	}
	return s.Tokens(ctx, profileID)
}

// enabledOff puts off in its stored form, without repeats. Each must be an enabled token.
func enabledOff(ctx context.Context, tx pgx.Tx, field string, off []TokenPair) ([]TokenPair, error) {
	rows, err := tx.Query(ctx, `SELECT t.chain_id, t.contract FROM tokens t JOIN chains c ON c.chain_id = t.chain_id
		WHERE t.enabled AND c.enabled`)
	if err != nil {
		return nil, fmt.Errorf("read enabled tokens: %w", err)
	}
	enabled, err := pgx.CollectRows(rows, pgx.RowToStructByPos[TokenPair])
	if err != nil {
		return nil, fmt.Errorf("read enabled tokens: %w", err)
	}
	var out []TokenPair
	for _, t := range off {
		t.Token = strings.ToLower(t.Token)
		if !slices.Contains(enabled, t) {
			return nil, fmt.Errorf("%w: %s must list enabled tokens by chainId and token", ErrInvalid, field)
		}
		if !slices.Contains(out, t) {
			out = append(out, t)
		}
	}
	slices.SortFunc(out, func(a, b TokenPair) int {
		return cmp.Or(cmp.Compare(a.ChainID, b.ChainID), strings.Compare(a.Token, b.Token))
	})
	return out, nil
}

// The caller holds the profile lock. A profile save checks every store; a store save checks that store.
func checkTokensOn(ctx context.Context, tx pgx.Tx, profileID, storeID string) error {
	var empty bool
	err := tx.QueryRow(ctx, `WITH scopes AS (
		SELECT nullif($2, '')::uuid AS id
		UNION ALL SELECT id FROM stores WHERE profile_id = $1 AND $2 = '')
		SELECT EXISTS (SELECT s.id, c.livemode FROM scopes s CROSS JOIN tokens t
		JOIN chains c ON c.chain_id = t.chain_id WHERE t.enabled AND c.enabled
		GROUP BY s.id, c.livemode HAVING count(*) FILTER (WHERE
		    NOT EXISTS (SELECT 1 FROM profile_tokens_off o WHERE o.profile_id = $1
		                AND o.chain_id = t.chain_id AND o.token_contract = t.contract)
		    AND NOT EXISTS (SELECT 1 FROM store_tokens_off o WHERE o.store_id = s.id
		                    AND o.chain_id = t.chain_id AND o.token_contract = t.contract)) = 0)`,
		profileID, storeID).Scan(&empty)
	if err != nil {
		return fmt.Errorf("check tokens on: %w", err)
	}
	if empty {
		field := "off"
		if storeID != "" {
			field = "tokensOff"
		}
		return fmt.Errorf("%w: %s: at least one token must stay on in each mode for the profile and every store", ErrInvalid, field)
	}
	return nil
}

// TokensOff are the tokens a new invoice of the profile, and of its store when storeID is set, can't take.
func TokensOff(ctx context.Context, tx pgx.Tx, profileID, storeID string) ([]TokenPair, error) {
	rows, err := tx.Query(ctx, `SELECT chain_id, token_contract FROM profile_tokens_off WHERE profile_id = $1
		UNION SELECT chain_id, token_contract FROM store_tokens_off WHERE store_id = nullif($2, '')::uuid`,
		profileID, storeID)
	if err != nil {
		return nil, fmt.Errorf("read tokens off: %w", err)
	}
	off, err := pgx.CollectRows(rows, pgx.RowToStructByPos[TokenPair])
	if err != nil {
		return nil, fmt.Errorf("read tokens off: %w", err)
	}
	return off, nil
}
