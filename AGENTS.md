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
  Docs belong in `docs/`, except this entry point and the roadmap.
- Before adding a file or folder, identify its feature or responsibility and follow the owning layout rules:
  [web and shared UI](docs/web/structure.md), [Go backend](docs/backend/rules.md). Keep related source and tests together;
  split unrelated responsibilities and use concrete names. Create layers and folders only for existing code.
- TypeScript: keep types and constants with their owning feature, component or shared capability (D-11).
  Derive unions from finite domain constants; use type-only imports and do not repeat domain string values.
- Comments only where the code cannot say it: a non-obvious reason, a money or safety rule, a workaround.
  - Describe the code as it is. History, incidents, dates and review notes go in the commit message.
  - A test's name says what it checks. Comment a test only for setup a reader can't follow.
  - Don't restate what a function, prop or line does, and don't add a comment with every change.
- Money is integer base units plus decimals (`bigint`, `*big.Int`, `NUMERIC(78,0)`). Identify tokens by chain + contract.
- Secrets only in the ignored `.env` of the package that reads them (`apps/backend`, `apps/web`, `packages/contracts`); no root `.env`.
  Each package lists its names in `.env.example`. Never print, log or commit keys, tokens or request bodies.
- Every change uses a task branch and PR. No direct base-branch commits or pushes; no skipped hooks.
- Follow the user's authorization for commits and publishing. Spending, deployments and provider accounts require explicit approval.
- Before finishing a task, stop its temporary Anvil processes and remove the Anvil state files, temporary files and
  disposable build/test caches it created. Use task-specific temporary directories and arrange cleanup on success,
  failure and interruption. Verify cleanup and report anything left behind. Preserve files used by running processes,
  shared caches, secrets and persistent data; never blanket-delete `~/.foundry`. Ask before removing pre-existing files.
- Keep rules in their owning doc; link instead of copying. Update that doc when behavior changes.
- Write docs in short sentences (at most 25 words), one fact per bullet; split a longer bullet into sub-bullets (D-84).
- A fix covers every place the same data or behavior shows. Before calling it done, search for the other readers
  (lists, detail pages, activity, search, toasts, PDFs, API reads, owner and payer pages) and fix them or name them.
- No AI attribution in commits, PRs or comments.
