// Package privy wraps the official Privy Go SDK (D-12) for what the backend needs: one user-owned EVM wallet per
// profile (R-31, D-21). The server never signs for these wallets (D-46).
package privy

import (
	"context"
	"errors"
	"fmt"
	"strings"

	privyclient "github.com/privy-io/go-sdk"
)

// ErrNoWallet means Privy returned no wallet where one must exist.
var ErrNoWallet = errors.New("privy returned no wallet")

// Wallet is a profile's Privy wallet; Address is lowercase.
type Wallet struct {
	ID      string
	Address string
}

// Client talks to Privy with the app secret.
type Client struct {
	sdk *privyclient.PrivyClient
}

// NewClient uses Privy's production API unless apiURL is set (tests point it at a fake).
func NewClient(appID, appSecret, apiURL string) *Client {
	return &Client{sdk: privyclient.NewPrivyClient(privyclient.PrivyClientOptions{AppID: appID, AppSecret: appSecret, APIUrl: apiURL})}
}

// ProfileWallet returns the profile's wallet, creating it once: owned by the Privy user, external_id = profile id.
// A repeated or concurrent call finds the existing wallet by external_id instead of creating a second one.
func (c *Client) ProfileWallet(ctx context.Context, privyUserID, profileID string) (Wallet, error) {
	if w, err := c.find(ctx, profileID); err == nil || !errors.Is(err, ErrNoWallet) {
		return w, err
	}
	created, err := c.sdk.Wallets.New(ctx, privyclient.WalletNewParams{
		ChainType:           privyclient.WalletChainTypeEthereum,
		Owner:               privyclient.OwnerInputUnion{OfOwnerInputUser: &privyclient.OwnerInputUser{UserID: privyUserID}},
		ExternalID:          privyclient.String(profileID),
		PrivyIdempotencyKey: privyclient.String("profile-wallet-" + profileID),
	})
	if err != nil {
		// Another request may have created it first (external_id is unique per app).
		if w, ferr := c.find(ctx, profileID); ferr == nil {
			return w, nil
		}
		return Wallet{}, fmt.Errorf("create Privy wallet for profile %s: %w", profileID, err)
	}
	return Wallet{ID: created.ID, Address: strings.ToLower(created.Address)}, nil
}

func (c *Client) find(ctx context.Context, profileID string) (Wallet, error) {
	page, err := c.sdk.Wallets.List(ctx, privyclient.WalletListParams{ExternalID: privyclient.String(profileID)})
	if err != nil {
		return Wallet{}, fmt.Errorf("find Privy wallet for profile %s: %w", profileID, err)
	}
	if len(page.Data) == 0 {
		return Wallet{}, ErrNoWallet
	}
	return Wallet{ID: page.Data[0].ID, Address: strings.ToLower(page.Data[0].Address)}, nil
}
