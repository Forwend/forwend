// Package privy wraps the official Privy Go SDK (D-12) for what the backend needs: one user-owned EVM wallet per
// profile (R-31, D-21). The server never signs for these wallets (D-46).
package privy

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"strings"
	"time"

	privyclient "github.com/privy-io/go-sdk"
)

// ErrNoWallet means the profile has no Privy wallet yet.
var ErrNoWallet = errors.New("privy returned no wallet")

// Timeout bounds one ProfileWallet call, retries included, so a hanging Privy fails the request before the api's
// 30 s write timeout instead of holding it for the SDK's 10 minutes.
var Timeout = 20 * time.Second

// Wallet is a profile's Privy wallet; Address is lowercase.
type Wallet struct {
	ID      string
	Address string
}

type Client struct {
	sdk *privyclient.PrivyClient
}

// NewClient uses Privy's production API unless apiURL is set (tests point it at a fake).
func NewClient(appID, appSecret, apiURL string) *Client {
	return &Client{sdk: privyclient.NewPrivyClient(privyclient.PrivyClientOptions{AppID: appID, AppSecret: appSecret, APIUrl: apiURL})}
}

// ProfileWallet finds the wallet by external_id = profile id and owner, else creates it. No idempotency key: Privy
// replays a cached error for a key for 24 hours, so one failed create would block the wallet.
func (c *Client) ProfileWallet(ctx context.Context, privyUserID, profileID string) (Wallet, error) {
	ctx, cancel := context.WithTimeout(ctx, Timeout)
	defer cancel()
	if w, err := c.find(ctx, privyUserID, profileID); err == nil || !errors.Is(err, ErrNoWallet) {
		return w, err
	}
	created, err := c.sdk.Wallets.New(ctx, privyclient.WalletNewParams{
		ChainType:  privyclient.WalletChainTypeEthereum,
		Owner:      privyclient.OwnerInputUnion{OfOwnerInputUser: &privyclient.OwnerInputUser{UserID: privyUserID}},
		ExternalID: privyclient.String(profileID),
	})
	if err != nil {
		// Another request may have created it first.
		if w, ferr := c.find(ctx, privyUserID, profileID); ferr == nil {
			return w, nil
		}
		return Wallet{}, fmt.Errorf("create Privy wallet for profile %s: %w", profileID, err)
	}
	return Wallet{ID: created.ID, Address: strings.ToLower(created.Address)}, nil
}

// LoginEmail is the user's verified login email; "" for a passkey alone.
func (c *Client) LoginEmail(ctx context.Context, privyUserID string) (string, error) {
	ctx, cancel := context.WithTimeout(ctx, Timeout)
	defer cancel()
	u, err := c.sdk.Users.Get(ctx, privyUserID)
	if err != nil {
		return "", fmt.Errorf("read Privy user: %w", err)
	}
	google := ""
	for _, a := range u.LinkedAccounts {
		switch a.Type {
		case "email":
			return strings.ToLower(a.Address), nil
		case "google_oauth":
			if google == "" {
				google = strings.ToLower(a.Email)
			}
		}
	}
	return google, nil
}

// NewAccountAge: an email or passkey linked this recently isn't a sign-in for D-49. A stolen session can link its own
// at Privy and sign in with it (Q-13). The one the user signed up with counts at once: a passkey alone has no email
// for a code.
const NewAccountAge = 24 * time.Hour

// SignInTimes are the latest_verified_at of the user's passkeys and of their email account at loginEmail, the one
// Forwend stored at sign-up, in Unix seconds (D-49), except those linked within NewAccountAge after sign-up. Another
// email doesn't count: a stolen session can change the email at Privy, which may keep the old account's times.
// twoStep names the user's MFA methods at Privy, sorted, each as type:verified_at: Privy asks for one before it signs
// or exports, and setting one up again changes its time (R-219).
func (c *Client) SignInTimes(ctx context.Context, privyUserID, loginEmail string) (times []int64, twoStep []string,
	err error) {
	ctx, cancel := context.WithTimeout(ctx, Timeout)
	defer cancel()
	u, err := c.sdk.Users.Get(ctx, privyUserID)
	if err != nil {
		return nil, nil, fmt.Errorf("read Privy user: %w", err)
	}
	created := time.Unix(int64(u.CreatedAt), 0)
	for _, a := range u.LinkedAccounts {
		linked := time.Unix(int64(a.FirstVerifiedAt), 0)
		atSignUp := linked.Sub(created).Abs() < time.Minute
		ours := a.Type == "passkey" || a.Type == "email" && loginEmail != "" && strings.EqualFold(a.Address, loginEmail)
		if ours && (atSignUp || time.Since(linked) >= NewAccountAge) {
			times = append(times, int64(a.LatestVerifiedAt))
		}
	}
	for _, m := range u.MfaMethods {
		twoStep = append(twoStep, fmt.Sprintf("%s:%d", m.Type, int64(m.VerifiedAt)))
	}
	slices.Sort(twoStep)
	return times, twoStep, nil
}

// EndSessions freezes the user, which ends every session and refresh token at Privy, then unfreezes them so they can
// sign in again (D-49). ended reports that the freeze succeeded. Neither call stops when the caller gives up, and the
// unfreeze is sent even after a failed freeze, which may still have landed: a frozen user can't sign in.
func (c *Client) EndSessions(ctx context.Context, privyUserID string) (ended bool, err error) {
	ctx = context.WithoutCancel(ctx)
	freezeCtx, cancelFreeze := context.WithTimeout(ctx, Timeout)
	defer cancelFreeze()
	_, freezeErr := c.sdk.Users.Freeze(freezeCtx, privyUserID)
	unfreezeCtx, cancelUnfreeze := context.WithTimeout(ctx, Timeout)
	defer cancelUnfreeze()
	_, unfreezeErr := c.sdk.Users.Unfreeze(unfreezeCtx, privyUserID)
	if freezeErr != nil {
		return false, fmt.Errorf("freeze Privy user: %w", errors.Join(freezeErr, unfreezeErr))
	}
	if unfreezeErr != nil {
		return true, fmt.Errorf("unfreeze Privy user, who can't sign in until it works: %w", unfreezeErr)
	}
	return true, nil
}

func (c *Client) find(ctx context.Context, privyUserID, profileID string) (Wallet, error) {
	page, err := c.sdk.Wallets.List(ctx, privyclient.WalletListParams{ExternalID: privyclient.String(profileID),
		UserID: privyclient.String(privyUserID)})
	if err != nil {
		return Wallet{}, fmt.Errorf("find Privy wallet for profile %s: %w", profileID, err)
	}
	if len(page.Data) == 0 {
		return Wallet{}, ErrNoWallet
	}
	return Wallet{ID: page.Data[0].ID, Address: strings.ToLower(page.Data[0].Address)}, nil
}
