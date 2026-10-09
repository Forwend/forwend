# Forwend

Stablecoin invoices, checkout, balances, send and bank withdrawal.

## Start here

Run `python3 scripts/harness.py status` at session start and after a restart. Use `show ID` for the active task.
Read only the task's requirement rows and the relevant package instructions.

| Work | Read |
|---|---|
| Task, checks, review, delivery | [docs/workflow.md](docs/workflow.md) |
| Requirements and decisions | [docs/PROJECT.md](docs/PROJECT.md) |
| System and money flow | [docs/architecture.md](docs/architecture.md) |
| Future scope | [PLAN.md](PLAN.md) |
| Web | [apps/web/AGENTS.md](apps/web/AGENTS.md) |
| Shared UI / tokens | [packages/ui-web/AGENTS.md](packages/ui-web/AGENTS.md), [packages/design-tokens/AGENTS.md](packages/design-tokens/AGENTS.md) |
| Backend | [apps/backend/AGENTS.md](apps/backend/AGENTS.md) |
| Contracts | [packages/contracts/AGENTS.md](packages/contracts/AGENTS.md) |

## Shared rules

- Application code belongs in `apps/` or `packages/`; tooling in `scripts/` and `tests/`; local services in `infra/`.
  Docs belong in `docs/`, except this entry point and the roadmap. Create planned folders only when needed.
- Group by feature. Give files concrete names; keep related source and tests together. Split unrelated responsibilities.
- TypeScript: named types in `src/types/<domain>/`; finite domain values in `src/constants/`; derive unions from constants.
  Use type-only imports. Do not repeat domain string values. Document framework-required exceptions in the PR.
- Money is integer base units plus decimals (`bigint`, `*big.Int`, `NUMERIC(78,0)`). Identify tokens by chain + contract.
- Secrets only in the ignored `.env` of the package that reads them (`apps/backend`, `packages/contracts`); no root `.env`.
  Each package lists its names in `.env.example`. Never print, log or commit keys, tokens or request bodies.
- Every change uses a task branch and PR. No direct base-branch commits or pushes; no skipped hooks.
- Follow the user's authorization for commits and publishing. Spending, deployments and provider accounts require explicit approval.
- Keep rules in their owning doc; link instead of copying. Update that doc when behavior changes.
- No AI attribution in commits, PRs or comments.
