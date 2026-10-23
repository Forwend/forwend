// Package privy wraps the official Privy Go SDK (D-12) for what the backend needs: one user-owned EVM wallet per
// profile (R-31, D-21). The server never signs for these wallets (D-46).
package privy

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	privyclient "github.com/privy-io/go-sdk"
)

// ErrNoWallet means Privy returned no wallet where one must exist.
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
