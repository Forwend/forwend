# Staging CI

- `main` is the development branch. Task branches still merge through PRs and must pass local `verify` and any
  required review. Automatic GitHub Actions runs are disabled for PRs into main and pushes to main.
- `staging` is the batch-validation branch. Its push event runs the required and CI-only checks (`harness.py check --ci`).
  There is no additional PR-triggered run. Staging is not a deployment environment and this workflow deploys nothing.
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

