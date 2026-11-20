// Package privy wraps the Privy SDK: one user-owned EVM wallet per profile, which the server never signs for.
package privy

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"slices"
	"strconv"
	"strings"
	"time"

	privyclient "github.com/privy-io/go-sdk"
	"github.com/privy-io/go-sdk/option"
)

var ErrNoWallet = errors.New("privy returned no wallet")

// Timeout bounds one call with retries: under the api's 30 s write timeout, not the SDK's 10 minutes.
var Timeout = 20 * time.Second

type Wallet struct {
	ID      string
	Address string // lowercase
}

type Client struct {
	sdk     *privyclient.PrivyClient
	raw     privyclient.Client // sends a body as given: the user's signature covers its exact JSON
	appID   string
	baseURL string
}

// NewClient uses Privy's production API unless apiURL is set.
func NewClient(appID, appSecret, apiURL string) *Client {
	base := apiURL
	if base == "" {
		base = "https://api.privy.io"
	}
	return &Client{
		sdk: privyclient.NewPrivyClient(privyclient.PrivyClientOptions{AppID: appID, AppSecret: appSecret, APIUrl: apiURL}),
		raw: privyclient.NewClient(option.WithAppID(appID), option.WithAppSecret(appSecret),
			option.WithHeader("privy-app-id", appID), option.WithBaseURL(base)),
		appID: appID, baseURL: strings.TrimSuffix(base, "/"),
	}
}

// Request is what the browser signs as Privy's authorization payload (v1, POST); Send sends exactly this.
type Request struct {
	URL     string            `json:"url"`
	Body    json.RawMessage   `json:"body"`
	Headers map[string]string `json:"headers"`
}

// RPC: the idempotency key makes a second send a no-op at Privy, and Privy refuses it after expires.
func (c *Client) RPC(walletID string, body json.RawMessage, idempotencyKey string, expires time.Time) Request {
	return Request{URL: c.baseURL + "/v1/wallets/" + url.PathEscape(walletID) + "/rpc", Body: body,
		Headers: map[string]string{"privy-app-id": c.appID, "privy-idempotency-key": idempotencyKey,
			"privy-request-expiry": strconv.FormatInt(expires.UnixMilli(), 10)}}
}

func (c *Client) Send(ctx context.Context, req Request, signature string) (string, error) {
	ctx, cancel := context.WithTimeout(ctx, Timeout)
	defer cancel()
	path, ok := strings.CutPrefix(req.URL, c.baseURL+"/")
	if !ok {
		return "", fmt.Errorf("send Privy request: %s is not a Privy URL", req.URL)
	}
	opts := []option.RequestOption{option.WithHeader("privy-authorization-signature", signature),
		option.WithRequestBody("application/json", []byte(req.Body))}
	for k, v := range req.Headers {
		opts = append(opts, option.WithHeader(k, v))
	}
	var out struct {
		Data struct {
			TransactionID string `json:"transaction_id"`
		} `json:"data"`
	}
	if err := c.raw.Post(ctx, path, nil, &out, opts...); err != nil {
		return "", fmt.Errorf("send Privy request: %w", err)
	}
	if out.Data.TransactionID == "" {
		return "", errors.New("send Privy request: no transaction id in the answer")
	}
	return out.Data.TransactionID, nil
}

type Transaction struct {
	Hash, Status, WalletID, Caip2, ReferenceID string // Hash is "" until known
}

func (c *Client) Transaction(ctx context.Context, id string) (Transaction, error) {
	ctx, cancel := context.WithTimeout(ctx, Timeout)
	defer cancel()
	t, err := c.raw.Transactions.Get(ctx, id)
	if err != nil {
		return Transaction{}, fmt.Errorf("read Privy transaction %s: %w", id, err)
	}
	return Transaction{Hash: strings.ToLower(t.TransactionHash), Status: string(t.Status), WalletID: t.WalletID,
		Caip2: t.Caip2, ReferenceID: t.ReferenceID}, nil
}

// ProfileWallet uses no idempotency key: Privy replays a cached error for a key for 24 hours.
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

// LoginEmail is "" for a passkey alone.
func (c *Client) LoginEmail(ctx context.Context, privyUserID string) (string, error) {
	ctx, cancel := context.WithTimeout(ctx, Timeout)
	defer cancel()
	u, err := c.user(ctx, privyUserID)
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

// Privy's edge caches a user read by URL for 10 s despite no-store; a random query keeps each read fresh.
func (c *Client) user(ctx context.Context, privyUserID string) (*privyclient.User, error) {
	return c.sdk.Users.Get(ctx, privyUserID, option.WithQuery("read", rand.Text()))
}

// NewAccountAge: a stolen session can link its own email or passkey at Privy, so a new one isn't a sign-in yet.
const NewAccountAge = 24 * time.Hour

// SignInTimes reads passkeys and the stored login email only (a stolen session can change Privy's); twoStep is sorted.
func (c *Client) SignInTimes(ctx context.Context, privyUserID, loginEmail string) (times []int64, twoStep []string,
	err error) {
	ctx, cancel := context.WithTimeout(ctx, Timeout)
	defer cancel()
	u, err := c.user(ctx, privyUserID)
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

// EndSessions freezes then unfreezes the user; the unfreeze runs even after a failed freeze, which may have landed.
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
