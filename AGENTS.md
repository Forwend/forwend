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
- Before adding a file or folder, identify its feature or responsibility and follow the owning layout rules:
  [web and shared UI](docs/web/structure.md), [Go backend](docs/backend/rules.md). Keep related source and tests together;
  split unrelated responsibilities and use concrete names. Create layers and folders only for existing code.
- TypeScript: keep types and constants with their owning feature, component or shared capability (D-11).
  Derive unions from finite domain constants; use type-only imports and do not repeat domain string values.
- Money is integer base units plus decimals (`bigint`, `*big.Int`, `NUMERIC(78,0)`). Identify tokens by chain + contract.
- Secrets only in the ignored `.env` of the package that reads them (`apps/backend`, `apps/web`, `packages/contracts`); no root `.env`.
  Each package lists its names in `.env.example`. Never print, log or commit keys, tokens or request bodies.
- Every change uses a task branch and PR. No direct base-branch commits or pushes; no skipped hooks.
- Follow the user's authorization for commits and publishing. Spending, deployments and provider accounts require explicit approval.
- Keep rules in their owning doc; link instead of copying. Update that doc when behavior changes.
- No AI attribution in commits, PRs or comments.
