# Staging CI

- `main` is the development branch. Task branches still merge through PRs and must pass local `verify` and any
  required review. Automatic GitHub Actions runs are disabled for PRs into main and pushes to main.
- `staging` is the batch-validation branch. Its push event runs the required and CI-only checks (`harness.py check --ci`).
  There is no additional PR-triggered run. CI deploys nothing; the Dokploy environment below is configured separately.
- PostgreSQL uses the official `postgres:17` image directly from Docker Hub. GitHub-hosted runners are
  [exempt from its public-image pull rate limit](https://docs.github.com/en/enterprise-cloud%40latest/actions/reference/limits).
  Avoid the AWS public mirror here: its data limit can fail service startup before any repository check runs.
- `delivery.requireRemoteChecks: false` in [check registry](config.json) applies to normal task delivery into the
  configured base, `main`. The default is true when omitted. It permits absent remote checks, never missing local
  verification, failed/skipped checks, authentication errors or a stale verification record.
- Keep staging free of independent commits. From a clean checkout, fetch origin, switch to staging, fast-forward
  it to `origin/main` with `git merge --ff-only origin/main`, then push staging when a batch is ready. Each push
  consumes one full CI run; promote deliberately, not after every task. Do not squash or delete staging.
- A staging push happens before CI reports a result. Treat only a passing run for that exact commit as validated;
  do not deploy or release an unverified batch. Fix failures on a task branch, merge into main, then promote again.

# Dokploy staging

- Deployment source: [infra/docker-compose.yml](../infra/docker-compose.yml).
- Local PostgreSQL uses [infra/docker-compose.local.yml](../infra/docker-compose.local.yml), through the existing backend commands.
- The stack runs PostgreSQL, the API, worker, signer and web app.
- Only the web service receives a public domain. Browser API requests pass through its `/api/v1` rewrite.
- The API applies migrations before becoming healthy. The worker, signer and web app wait for that check.
- API startup enables USDC on Base Sepolia, Arbitrum Sepolia and Arc Testnet before checking their factories.
- This applies to fresh and existing databases. Each API restart enables those three pairs again, without duplicating rows.
- Other token pairs keep their existing settings. Tempo's OUSD stays disabled on a fresh database.
- Set `ENABLE_TESTNET_USDC=0` to keep the database's current network settings unchanged at startup.
- PostgreSQL keeps its data in the `postgres-data` named volume. Keep the Dokploy service and Compose project name stable.
- Keep one worker and one signer. Their existing database locks prevent duplicate work during restarts.
- The executor must already be authorized by the deployed testnet factories and funded for gas on every enabled chain.
- The API never receives the executor key. The signer never receives Privy or email credentials.
- The independent canary runs on another host; see [money safety](backend/money-safety.md#canary).

## Dokploy settings

1. Create a Compose service with type **Docker Compose** and the Forwend Git repository.
2. Set the repository build path to `/` and Compose Path to `./infra/docker-compose.yml`.
3. Select `staging` after its exact commit passes CI. Keep automatic deployment disabled to avoid deploying before CI finishes.
4. Enable **Isolated Deployments** so every service shares a private network.
5. Paste the variables below into **Environment** and save.
6. Point the staging domain's DNS address record to the VPS.
7. Add the domain in **Domains**, selecting service `web`, container port `3000` and path `/`.
8. Enable HTTPS with Let's Encrypt. Use the same HTTPS origin in `PUBLIC_WEB_URL`.
9. Add that origin to the Privy app's allowed domains and its applicable redirect settings.
10. Deploy, inspect service logs, then run the checks below.

- Dokploy handles proxy labels through [Compose Domains](https://docs.dokploy.com/docs/core/docker-compose/domains).
- [Isolated Deployments](https://docs.dokploy.com/docs/core/docker-compose/utilities) keeps service names separate from other projects.
- Dokploy [environment variables](https://docs.dokploy.com/docs/core/docker-compose#environment) are passed explicitly to each service by this Compose file.
- The web image uses Next.js [standalone output](https://nextjs.org/docs/app/api-reference/config/next-config-js/output).
- Privy's app ID is embedded during the image build. Changing it requires rebuilding web.

## Environment

- These are all variables read by the staging Compose file.
- Copy provider values from the ignored package `.env` files or their provider dashboards.
- Store any local staging copy in `apps/backend/.env.dokploy`; keep secrets out of tracked files.
- Use a hexadecimal database password so it needs no escaping inside the generated database URL.

| Variable | Value |
|---|---|
| `POSTGRES_USER` | `forwend` |
| `POSTGRES_PASSWORD` | A new random hexadecimal password. |
| `POSTGRES_DB` | `forwend` |
| `ENABLE_TESTNET_USDC` | `1` by default; API startup enables the three supported USDC testnet pairs. `0` leaves network settings unchanged. |
| `PUBLIC_WEB_URL` | Your staging HTTPS origin, without a trailing slash. |
| `NEXT_PUBLIC_PRIVY_APP_ID` | The test Privy app ID; must match the secret below. |
| `PRIVY_APP_SECRET` | That test Privy app's secret from `apps/backend/.env`. |
| `EXECUTOR_PRIVATE_KEY` | The existing authorized testnet executor key from `apps/backend/.env`. |
| `INFURA_API_KEYS` | Existing comma-separated Infura keys; empty uses the configured public RPCs. |
| `RPC_RATE_PER_SECOND` | `10` by default, per backend process and RPC endpoint. |
| `POLL_INTERVAL` | `5s` by default, for the worker and signer. |
| `RESEND_API_KEY` | Existing send-only Resend key; empty leaves emails queued without sending them. |
| `EMAIL_FROM` | `Forwend <notifications@mail.forwend.com>` by default; use a sender verified by Resend. |
| `EMAIL_POSTAL_ADDRESS` | Optional sender address for email footers; empty omits it. |

- Compose sets `DATABASE_URL`, `API_ADDR`, `CHAINS_FILE`, `PRIVY_APP_ID` and `PRIVY_JWKS_URL` internally.
- The web build fixes `API_URL=http://api:8080`. Its runtime sets `NODE_ENV`, `HOSTNAME` and `PORT`.
- `POSTGRES_PORT` is local only. The staging database has no host port.
- `PRIVY_TEST_EMAIL` and `PRIVY_TEST_OTP` are browser test credentials, excluded from deployment.
- `DEPLOYER_PRIVATE_KEY` and `REFUND_AUTHORITY_PRIVATE_KEY` are contract tooling credentials, excluded from deployment.
- `CANARY_*` belongs to the separate canary host. Test overrides `RESEND_API_URL` and `ECB_RATES_URL` are excluded.

## Verification

- Before deploying, validate and build from the repository root:

```sh
docker compose --env-file apps/backend/.env.dokploy -f infra/docker-compose.yml config --quiet
docker compose --env-file apps/backend/.env.dokploy -f infra/docker-compose.yml build
```

- In Dokploy, PostgreSQL, API and web must be healthy. Check worker and signer logs for `worker ready` and `signer ready`.
- Redeploy all backend services after changing activation settings. The signer checks gas on every newly enabled chain before reporting ready.
- Sign in and confirm Balances, Receive and New invoice list USDC on Base Sepolia, Arbitrum Sepolia and Arc Testnet.
- Check the public homepage and API rewrite, replacing the example domain:

```sh
curl --fail --silent --show-error https://staging.example.com/ -o /dev/null
curl --silent --show-error -i https://staging.example.com/api/v1/invoices/not-a-token
```

- The second command must return HTTP 404 with the API's `invoice_not_found` error.
- Sign in with Privy, create an invoice, pay with testnet tokens and wait for settlement.
- Confirm both the owner and pay pages show paid, and the profile wallet receives the test tokens.
- Restart through Dokploy and confirm the invoice remains in the database.
- Changing `POSTGRES_PASSWORD` alone does not rotate an existing database password. Change the database role password before redeploying matching credentials.

