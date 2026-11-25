# Forwend

Stablecoin payments: invoices, checkout, balances and send. Bank withdrawal comes later.

<!-- harness:start (installed by harness-bootstrap; keep project notes outside these markers) -->
## Start here

1. Run `python3 scripts/harness.py status` at the start of every session and after a restart.
2. Run `python3 scripts/harness.py show ID` for the task's acceptance lines, checks and notes.
3. Follow [the task workflow](docs/workflow.md). Change tasks only through harness commands.
4. Before you write, test, debug or review code, read the matching skill in `.agents/skills/`.
5. Do only what the task or the user asks.
<!-- harness:end -->

Read only the requirement rows the task cites and the `AGENTS.md` of each package you change.

| Work | Read |
|---|---|
| Tasks, checks, review, delivery | [docs/workflow.md](docs/workflow.md) |
| Requirements and decisions | [docs/PROJECT.md](docs/PROJECT.md) |
| System and money flow | [docs/architecture.md](docs/architecture.md) |
| Future scope | [PLAN.md](PLAN.md) |
| Web | [apps/web/AGENTS.md](apps/web/AGENTS.md) |
| Shared UI and tokens | [packages/ui-web/AGENTS.md](packages/ui-web/AGENTS.md), [packages/design-tokens/AGENTS.md](packages/design-tokens/AGENTS.md) |
| Backend | [apps/backend/AGENTS.md](apps/backend/AGENTS.md) |
| Contracts | [packages/contracts/AGENTS.md](packages/contracts/AGENTS.md) |
| Node package | [packages/node/AGENTS.md](packages/node/AGENTS.md) |
| Browser checkout packages | [packages/js/AGENTS.md](packages/js/AGENTS.md), [packages/react/AGENTS.md](packages/react/AGENTS.md) |
| Example merchant | [apps/example-merchant/AGENTS.md](apps/example-merchant/AGENTS.md) |

## Where code goes

- Application code goes in `apps/` or `packages/`, tooling in `scripts/` and `tests/`, local services in `infra/`.
- Docs go in `docs/`. Only the entry files (`AGENTS.md`, `CLAUDE.md`, `README.md`) and `PLAN.md` sit at the root.
- Before you add a file or folder, find the feature it belongs to.
  - Then follow the layout rules for [web and shared UI](docs/web/structure.md) or the [Go backend](docs/backend/rules.md).
- Keep code and its tests together. Put unrelated jobs in separate files with concrete names.
- Add a layer or folder only for code that exists.
- Reuse before you create. When a shared component or helper almost fits, extend it.
- TypeScript types and constants live with the feature, component or shared module that owns them (D-11).
  - Derive unions from domain constants, and write each domain string once.
  - Use type-only imports for types.

## Comments

- Comment only what the code can't say: a non-obvious reason, a money or safety rule, a workaround.
- Describe the code as it is. History, incidents, dates and review notes go in the commit message.
- A test's name says what it checks. Comment a test only for setup a reader can't follow.
- Don't restate what a function, prop or line does. Don't add a comment with every change.

## Money and secrets

- Money is an integer in base units plus its decimals: `bigint`, `*big.Int`, `NUMERIC(78,0)`.
- A token is identified by its chain and contract address.
- Secrets go only in the ignored `.env` of the package that reads them. There is no root `.env`.
  - Those packages are `apps/backend`, `apps/web`, `apps/example-merchant` and `packages/contracts`.
  - Each lists its variable names in `.env.example`.
- The one root secret is the npm publish token, in the ignored `.npmrc` made from `.npmrc.example`.
- Never print, log or commit keys, tokens or request bodies.

## Changes and delivery

- Every change goes through a task branch and a pull request.
  - Never commit or push to the base branch directly, and never skip hooks.
- Commit and publish only as far as the user allows.
- Spending money, deploying and creating provider accounts need the user's explicit yes.
- No AI attribution in commits, pull requests or comments.
- A fix covers every place that shows the same data or behavior.
  - Check every place that uses the component or function you change.
  - Check the other readers: lists, detail pages, activity, search, toasts, PDFs, API reads, owner and payer pages.
  - Check similar components and functions for the same bug.
  - Fix each one, or name it in your report.
- When you change the backend, keep every web and package reader of that change working.
- When you build or change a screen, look at how good products solve the same thing.
  - Cover different users, states and edge cases, and make the screen clearer where you can.

## Cleanup

- Before you finish, stop the Anvil processes you started.
- Remove their state files, your temporary files and the build and test caches you made.
- Use a temporary folder per task. Clean it up on success, failure and interruption.
- Check that the cleanup worked, and report anything left behind.
- Keep files that running processes use, shared caches, secrets and stored data.
- Never delete all of `~/.foundry`. Ask before removing files that existed before the task.

## Docs

- Keep each rule in the doc that owns it. Link to it instead of copying it.
- Update the owning doc when behavior changes.
- Write short sentences of at most 25 words, one fact per bullet. Split a longer bullet into sub-bullets (D-84).
- Written behavior is not final (R-182): docs, requirements, decisions and tests describe the app as it is today.
  - When you know a better rule or behavior, change it.
  - Change the rule, the code and the tests together, and say why in the commit.
