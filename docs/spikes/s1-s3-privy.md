# S-1 to S-3: Privy from Go

Checked 2026-10-09 against the Privy test app `forwend` with the official Go SDK `github.com/privy-io/go-sdk` v0.15.0
(D-12) and, for a test token only, the Node SDK `@privy-io/node` 0.35.0. Throwaway programs (not kept in the repo)
created a user, wallets and transactions; afterwards the user was deleted, the wallets archived and the test funds
sent back to the deployer.

App settings (`Apps.Get`): embedded wallets `user-controlled-server-wallets-only`, not created on login; smart wallets
off. The owner then enabled a test account and gas sponsorship ("App pays") on Base Sepolia, Arbitrum Sepolia and Tempo
Moderato.

## Result

| Question | What was run | Result |
|---|---|---|
| Verify a real Privy access token (S-1) | Test account → `apps().getTestAccessToken` (Node); our `internal/auth` verifier against the live JWKS | Works: ES256, `kid` = the first JWKS key, `iss` privy.io, `aud` = app ID; a tampered copy is rejected |
| Server creates a user without a browser | `Users.New` with a `custom_auth` linked account | Works |
| One wallet per profile, several per user (S-2) | `Wallets.New` ×3, `owner: {user_id}`, `external_id = profile-<kind>-<run>`, `display_name = <kind>` | Works: 3 user-owned EVM wallets for one user |
| Look up a profile's wallet | `Wallets.List` by `user_id` → 3; by `external_id` → 1, the right one | Works |
| Server signs with a **user-owned** wallet, no user approval | `personal_sign` | **Refused, 401**: "No valid authorization keys or user signing keys available" |
| Server signs a user-owned wallet with the user's **Privy access token** | `AuthorizationContext{UserJwts}` → `POST /v1/wallets/authenticate` | **Refused, 400** "Invalid JWT token provided": this path takes a JWT from the app's own auth ("JWT-based authentication" with our JWKS), not a Privy-issued token |
| Server signs with a wallet **owned by our P-256 authorization key** | request signed with our key | Works; without the signature, 401 |
| **Ownerless** wallet, app secret only | `personal_sign` | Works |
| Sponsored USDC send on Base Sepolia (S-3) | `Wallets.Rpc` `eth_sendTransaction`, `caip2 eip155:84532`, `sponsor: true`, USDC `transfer` 0.5 USDC from a wallet holding **0 ETH** | **Works.** Confirmed in ~5 s; the wallet still holds 0 ETH |
| How sponsorship works | the receipts | First send: type-4 (EIP-7702) transaction from Privy's bundler to EntryPoint v0.7 `0x0000000071727De22E5E9d8BAf0edAc6f37da032`; the wallet gets a 7702 delegation (code `0xef0100…`). Later sends: ordinary bundler transactions (116,633 gas for a USDC transfer) |
| Sponsored send on Tempo Moderato | same, `eip155:42431`, 0.05 AlphaUSD | Works, same EIP-7702 + EntryPoint path |
| Cost | `GET /v1/apps/gas_spend` for the wallet, last day | `0.000000 usd` on testnets |
| Archive a wallet | `Wallets.Archive` | SDK bug: sends no body, Privy answers 415. Works with an explicit `{}` JSON body; a user-owned wallet was archived with the app secret alone |

Transactions: Base Sepolia `0x2ab4435c…a3ff` (0 USDC, first, sets the delegation), `0x818803a1…816c` (0.5 USDC);
Tempo `0x07abc07e…c1fc` (0.05 AlphaUSD).

## Decisions

- **Token checks:** confirmed with a real Privy token; keep verifying locally against the JWKS (F046, F060).
- **Wallet per profile (D-21):** each profile gets one user-owned EVM wallet created by the server with
  `owner: {user_id}` and `external_id` = our profile id (`[A-Za-z0-9_-]`, ≤ 64, unique per app, write-once).
  `profile_wallets.provider_wallet_id` stores Privy's wallet id. Several wallets per user work.
- **Who approves a send:** the user, in the web app. With Privy login (D-21) the server cannot sign for a user-owned
  wallet: neither alone (401) nor with the user's Privy access token (400). A send from a profile wallet is started and
  approved by the user through Privy's client SDK, with `sponsor: true`. Two alternatives need an owner decision:
  (a) the user grants our server a session signer limited by a policy (only USDC `transfer`, amount caps), set from the
  client with `addSigners`; (b) our backend becomes the login provider for Privy ("JWT-based authentication"), which
  changes D-21. Ownerless and key-owned wallets are for the platform's own keys only, never for user money.
- **Gas (D-43):** Privy sponsors gas on Base Sepolia and Tempo (and is enabled on Arbitrum Sepolia), free on testnets;
  no paymaster needed. Mainnet cost (gas plus Privy's fee) must be checked before mainnet trials. A sponsored profile
  wallet becomes an EIP-7702 account; it still receives settlements like any address.
- **`internal/privy`:** wrap the SDK (D-12) and fix its gaps: `Wallets.Archive` needs a `{}` body,
  `Wallets.Ethereum.SendTransaction` cannot set `sponsor` (use `Wallets.Rpc` with `Sponsor`), and the SDK has no
  transaction lookup (`GET /v1/transactions/{id}` until `transaction_hash` is set). Reads right after a send can lag:
  one public RPC read 0 USDC for a few seconds after a mined transfer.

## Sources

- Measured against the `forwend` Privy app and Base Sepolia / Tempo Moderato.
- Wallets: https://docs.privy.io/api-reference/wallets/create, https://docs.privy.io/api-reference/wallets/get-all
- Owners and signatures: https://docs.privy.io/controls/authorization-keys/owners/overview,
  https://docs.privy.io/api-reference/authorization-signatures
- Server-side user wallets (JWT-based auth required): https://docs.privy.io/recipes/wallets/server-side-user-wallets
- Gas sponsorship: https://docs.privy.io/wallets/gas-and-asset-management/gas/overview,
  https://docs.privy.io/api-reference/wallets/ethereum/eth-send-transaction
- Test accounts: https://docs.privy.io/recipes/using-test-accounts
