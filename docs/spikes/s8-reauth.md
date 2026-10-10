# S-8: Proving a recent sign-in before money actions

Checked 2026-10-10 against the Privy test app `forwend` with `@privy-io/react-auth` 3.45.0 (the web app's version),
the web dev server on `localhost:3000`, Playwright 1.64 and the Privy REST API (app secret). Throwaway programs (not
kept in the repo) signed the test account in with its email code 5 times, decoded the tokens in memory and printed
claim names, timestamps and hashes only. The test account was frozen and unfrozen 3 times; it ends unfrozen (`frozen_at` null).

App settings (`GET /v1/apps/{id}`): email and passkey login on, `google_oauth` **off**, no MFA methods, identity
tokens **off** (no `identity_token` in any response), access token 1 h.

## Result

| Question | What was run | Result |
|---|---|---|
| What is in an access token | Sign-in through `/sign-in`; decode `privy:token` from localStorage; verify against the JWKS | Claims `sid`, `iss`, `iat`, `aud`, `sub`, `exp` only. No `auth_time`, no login method. ES256, `kid` in the JWKS, `exp` = `iat` + 1 h |
| Does a silent refresh change `iat` | `POST auth.privy.io/api/v1/sessions` with the refresh token, as the SDK does | Until ~5 min before `exp` Privy answers `session_update_action: ignore` with the **same** token (every 5 min from 12:30 to 13:15). At 13:20:36 (`exp` 13:25:28) it answered `set`: a new token, **same `sid`**, `iat` 12:25:28 → 13:20:36. So `iat` is the refresh time, not the sign-in time, and a fresh `iat` does not mean a fresh sign-in |
| Is there a sign-in time on the server | `GET api.privy.io/v1/users/{did}` with the app secret after each step | Each linked account has `first_verified_at` and `latest_verified_at` (Unix seconds). After every email-code sign-in, the email account's `latest_verified_at` = that sign-in's access-token `iat`, to the second (5 of 5). A real refresh leaves it unchanged (12:25:28 before and after the 13:20:36 refresh) |
| Prove again while signed in, email code | The SDK's `useLoginWithEmail` calls (`passwordless/init`, `passwordless/authenticate`) replayed in the signed-in page with its Bearer token | Works, 200: a **new session** (new `sid`, new refresh token, `session_update_action: set`), a new access token whose `iat` = the new `latest_verified_at` (12:23:09 both). The hook allows this and reports `wasAlreadyAuthenticated`; only the modal `login()` throws for a signed-in user |
| Prove again with Google | SDK code (`useLoginWithOAuth`) | Not possible: when the user already has Google linked, the SDK returns the current user without a new Google sign-in. Google login is also off in the app |
| Prove again with a passkey | SDK code (`useLoginWithPasskey`) | Allowed while signed in (`wasAlreadyAuthenticated`), like email. Not run: the test account has no passkey |
| Privy MFA (`useMfa`, SMS / TOTP / passkey) | Docs; app settings | Guards only embedded-wallet key use (signing, export, recovery), checked by Privy, cached 15 min on the device. Nothing reaches our server to verify. No MFA method is enabled |
| Identity token (`privy-id-token`) | Every sign-in and refresh response | Not issued: "Return user data in an identity token" is off in the dashboard. Docs: ES256 JWT with `linked_accounts` as a string; verified with the same app key (`users().get({id_token})` in the Node SDK) |
| List a user's sessions or devices | Docs; probes `GET /v1/users/{id}/sessions`, `GET /v1/apps/{id}/sessions` | No API: both 404, none documented. The token's `sid` is the only session id we see |
| Revoke sessions | `POST /v1/users/{id}/freeze`, then `DELETE` (unfreeze) | Freeze ends **all** sessions of the user: Privy's own `GET /api/v1/users/me` with the old access token goes 200 → 401, and the refresh with that token goes 401 "Invalid auth token". The old access token **still verifies locally** against the JWKS until its `exp` (up to 1 h). After unfreeze the old session stays dead (refresh 401): the user signs in again |
| Sign out one device | Docs, SDK | `logout()` from `usePrivy` calls `POST /api/v1/sessions/logout` for that device's session only |
| Session lengths | Docs | Access token 1 h, refresh token 30 days, single-use and rotated; both set in the dashboard (User management → Authentication → Advanced) |

## Decisions

- **Rule before money actions (D-49).** Send, transfer, withdraw and changes to where money goes (payees, payout
  details) require a token from a fresh sign-in. The API verifies the access token as today (R-18), then calls
  `GET /v1/users/{did}` and accepts only if:
  - the token's `iat` is at most **5 minutes** old, and
  - the token's `iat` equals the `latest_verified_at` of the user's `email` or `passkey` account (same second).
  A refreshed token fails the second check (measured: the 13:20:36 token was brand new, but `latest_verified_at`
  stayed 12:25:28), and a fresh sign-in on another
  device does not unlock this device's older token. Otherwise the API answers **401 `reauth_required`**.
- **Web flow.** On `reauth_required` the web opens a dialog that sends the email code again (`useLoginWithEmail`
  `sendCode` + `loginWithCode`; later a passkey with `useLoginWithPasskey`), then retries the request with the new
  token from `getAccessToken()`. The `/sign-in` page cannot be reused: it sends signed-in users to `/app`.
- **Google-only users** cannot prove themselves again (the SDK skips a second Google sign-in). They must link an email
  or passkey before their first money action. Google is off in the app today.
- **Not used:** Privy MFA (guards wallet keys at Privy, gives our server nothing; it can still be turned on later as
  extra protection for wallet signing, D-46) and the identity token (needs a dashboard switch and adds nothing the
  user lookup does not give; turn it on only if the lookup's rate limits matter).
- **Sessions.** Privy cannot list sessions, so the app has no device list for now. "Sign out everywhere" =
  freeze then unfreeze the Privy user, **plus** store `sessions_revoked_at` on our user and reject tokens with
  `iat` before it, because Privy's freeze does not stop tokens we verify locally. Sign out on one device stays
  `logout()`. A device list would need our own record of `sid` values seen; build it only if users ask.

## Open questions

- Owner: is 5 minutes right, and which actions count (also creating an invoice or a store key)?
- The `iat` = `latest_verified_at` match is measured, not documented by Privy. If it ever breaks, fall back to a
  short-lived reauth record keyed by `sid`, written by the API when it sees a matching pair.
- Passkey re-proof is not run live; check `latest_verified_at` of the passkey account when the first passkey is linked.
- Rate limits of `GET /v1/users/{id}` are not documented; one call per money action is expected to be fine.

## Sources

- Measured against the `forwend` Privy app with the test account.
- Access tokens and claims: https://docs.privy.io/authentication/user-authentication/access-tokens
- Token lifetimes and refresh: https://docs.privy.io/authentication/user-authentication/tokens
- Identity tokens: https://docs.privy.io/user-management/users/identity-tokens
- User object (`latest_verified_at`): https://docs.privy.io/api-reference/users/get
- MFA: https://docs.privy.io/authentication/user-authentication/mfa/verify/overview,
  https://docs.privy.io/authentication/user-authentication/mfa/advanced
- Freezing users: https://docs.privy.io/user-management/users/managing-users/freezing-users
- Logout: https://docs.privy.io/authentication/user-authentication/logout
