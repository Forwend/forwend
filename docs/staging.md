# Staging CI

- `main` is the development branch. Task branches still merge through PRs and must pass local `verify` and any
  required review. Automatic GitHub Actions runs are disabled for PRs into main and pushes to main.
- `staging` is the batch-validation branch. Its push event runs the full CI registry, including CI-only checks.
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
- Bootstrap: merge the trigger and harness-policy changes into main before first publishing staging at that
  updated main commit. Creating staging from the old workflow alone does not enable staging CI. The transition
  PR may still receive a final run under the old trigger; no workflow-wide disable or skipped-check override is needed.

GitHub's [branch filters](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax)
control which events start a workflow. This repo is private, so hosted runs consume the owner's included allowance
under [GitHub Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions).

