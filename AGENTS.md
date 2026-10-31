# Forwend

Stablecoin invoices, checkout, balances, send and bank withdrawal.

## Start here

Run `python3 scripts/harness.py status` at session start and after a restart. Use `show ID` for the active task.
Read only the task's requirement rows and the relevant package instructions.


| Work                           | Read                                                                                                                         |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| Task, checks, review, delivery | [docs/workflow.md](docs/workflow.md)                                                                                         |
| Requirements and decisions     | [docs/PROJECT.md](docs/PROJECT.md)                                                                                           |
| System and money flow          | [docs/architecture.md](docs/architecture.md)                                                                                 |
| Future scope                   | [PLAN.md](PLAN.md)                                                                                                           |
| Web                            | [apps/web/AGENTS.md](apps/web/AGENTS.md)                                                                                     |
| Shared UI / tokens             | [packages/ui-web/AGENTS.md](packages/ui-web/AGENTS.md), [packages/design-tokens/AGENTS.md](packages/design-tokens/AGENTS.md) |
| Backend                        | [apps/backend/AGENTS.md](apps/backend/AGENTS.md)                                                                             |
| Contracts                      | [packages/contracts/AGENTS.md](packages/contracts/AGENTS.md)                                                                 |
| Node package                   | [packages/node/AGENTS.md](packages/node/AGENTS.md)                                                                           |
| Browser checkout packages      | [packages/js/AGENTS.md](packages/js/AGENTS.md), [packages/react/AGENTS.md](packages/react/AGENTS.md)                         |
| Example merchant               | [apps/example-merchant/AGENTS.md](apps/example-merchant/AGENTS.md)                                                           |


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
  - The npm publish token is the one root secret: the ignored `.npmrc`, made from `.npmrc.example`.
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
- **Reuse before creating.** Use existing shared components and utilities. If something similar exists, improve or extend it. Create something new only when there is no suitable option.
- **Check for the same bug elsewhere.** When you find a bug, check every place that uses the affected component or method. Review similar components and methods for the same issue.
- **Design for the best user experience.** When creating or updating a component, research similar examples for inspiration. Consider different user needs, situations, and edge cases. Look for ways to make the component clearer and easier to use.
- **Written behavior is not final.** Docs, requirements, decisions and tests describe the app as it is today, not the best it can be (R-182).
  - When a written rule or behavior is weak and you know a better one, improve it. Extend, add, change or remove behavior when that serves the app.
  - Change the rule, the code and the tests together, and say why in the commit.
  - When you change the backend, find every frontend and package reader of what changed, and keep each one working.