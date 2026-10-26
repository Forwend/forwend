# Development workflow

Entry point: `python3 scripts/harness.py`. Add `-h` after any command for options.
Check definitions live only in [config.json](config.json); staging CI runs the required and CI-only checks. Checks that are neither (images-check, lighthouse,
diagrams) run only when a task names them.
Open task state lives in `tasks.json` (edit through the runner); completed records live in local-only `archive/`;
logs of checks that did not pass live in ignored `runs/`; a passed check leaves none.
Runner regression tests live in `tests/test_harness.py`. No installed skill is needed to use this workflow.

- `archive/`, `research/` and `spikes/` are optional local files, excluded from Git.
- Keep requirements and decisions in tracked docs so a fresh checkout does not depend on those local files.

## One task at a time

1. `status` gives current state and the next action. `show ID` gives acceptance, refs with the text of each
   referenced PROJECT row, checks and must-not-change paths. Read only those rows and the owning package instructions. If refs are missing, add the relevant
   requirement or decision with `edit ID --ref R-N` before implementation. Use `show ID --history` only to investigate
   earlier notes or check results; dated notes are history, so confirm they still apply. Do not load all of tasks.json,
   PROJECT.md or the runner source for ordinary task work.
2. For new work, add a requirement in [PROJECT.md](PROJECT.md), then `add "behavior" --type fix --accept "..." --check CHECK --ref R-N --keep "path/*"`.
   Define unclear scope before coding. Split independent changes into tasks. Do not start unrelated queued product work.
3. `start ID` creates the task branch from the latest base. Finish a pending PR before another task.
   On the task branch, run `archive` to move merged and dropped tasks out of the queue; `archive ID ...` selects
   specific tasks. Commit `tasks.json`; keep `archive/` local and ignored. Unfinished and unmerged tasks stay in the queue.
   `show ID` reads archived records, `list --all` lists them, and `reopen ID --reason "..."` restores work to the queue.
4. Before creating or moving files, read the owning structure rules: [web/UI](web/structure.md), [backend](backend/rules.md).
   Identify the owner, filename and allowed dependencies; search for existing code before adding another shared helper.
   Reproduce bugs first. Make the smallest fix and run its direct checks. Keep a test only when the rule in
   [Which tests to keep](#which-tests-to-keep) says so; prove a visual change with screenshots in `docs/runs/`.
5. `verify ID --proof "1=CHECK: evidence" ...` runs task and required checks. Each acceptance line needs a named check.
6. Review is required for every task that changes more than docs (`done` refuses it otherwise; outside a git
   repository the harness can't tell, so only `--review` tasks need it) and for tasks added with `--review`. A fresh reviewer reads `show ID` and the diff, then runs `review ID --pass|--fail --summary "findings"`.
7. With commit/push/merge authorization, commit the verified files and run `done ID`. It pushes, opens the PR,
   checks the delivery policy ([staging.md](staging.md)) and merges.
   Pending CI: repeat `done ID`. Failed CI: fix, verify, review and commit again. Approval or closed PR: ask the owner.
8. Before stopping: `wrapup --note "result; next step"`. Resolve failures or report the exact remaining blocker.

## Structure review

Before verification, inspect added and moved paths and their imports against the owning structure rules.
A reviewer checks feature ownership, concrete names, grouped UI families, dependency direction, and whether a
growing file mixes independent responsibilities. No empty scaffolding, catch-all modules, duplicate request
layers or arbitrary file-size limits. Explain any necessary exception in the task proof or review.

In the touched code the reviewer also checks growing folders (flat files that now form a real group), repeated
definitions of one domain concept where the owning type should be reused, and where unit and browser tests sit.
For web changes, a new screen or control must start from the closest existing one, or come with the research and the
DESIGN.md entry that [web/rules.md](web/rules.md) asks for.
The rules for each are in [web/structure.md](web/structure.md) and [backend/rules.md](backend/rules.md).

For a refactor, acceptance must require unchanged behavior and public contracts, updated imports/exports and
test discovery, and the relevant existing checks. Record unrelated cleanup separately rather than expanding
the task. The structure rules do not authorize adding dependencies or moving code outside the task scope.

`docs-check` validates documentation links, that cited R-/D-/Q-/A- IDs and PROJECT check names exist, and that each
decision is defined once; not source architecture. Structure review is
manual until a task explicitly adds import-boundary checks; do not claim that passing lint proves ownership.

## Evidence and scope

- `check` runs required checks without changing task state; `check CHECK` runs one; `check --ci` adds CI-only checks.
- When every file a task changed is Markdown or under `docs/archive/`, `verify` and the pre-commit hook skip the required
  checks not marked `"docs": true` in config.json; the task's own checks still run.
- `verify` rejects changed inputs during a run. Later source, config or task-constraint edits require another verify.
- Proof names must refer to checks that passed. The description explains relevance; independent review checks that claim.
- `--keep` path globs are enforced. Behavioral constraints need tests and review; prose alone is not a machine check.
- Missing scripts, commands, remotes or required CI results never imply success. Explicitly disabled remote checks
  are reported as not required, not passed. `passing` with pending delivery is not merged.
- Fix failed checks; never weaken them. After three failures without a new approach, `note` attempts and `block ID --reason "..."`.
- `edit` changes task scope; `reopen` resumes completed work; `drop` removes obsolete work with a reason.
  Update affected PROJECT rows and task refs together. `note` records only useful handoff facts.
- Research only when needed, using primary sources. Record decisions in PROJECT; cite external facts where they are used.

## Which tests to keep

Write whatever tests help while building. Commit and keep a test only when it guards one of these:

- Money: amounts, base units, rounding, the ledger, settlement, held money, what counts as paid.
- Auth and security: who may read or change what, redirects, escaping, anything a payer, a link or the chain controls.
- Data integrity: migrations, constraints, idempotency, events sent exactly once.
- API contracts and parsing at trust boundaries: request and response schemas, addresses, CSV export.
- A bug a user hit: one regression test, named after what broke.

Don't keep tests that only restate copy text, constants, layout or simple rendering, or that confirm a one-off fix
an e2e test or a screenshot already covers. When a kept test breaks because wording or layout changed, fix the test
to check the behavior, not the words.

Checks: `unit` runs every package's tests (backend and contracts included), so a task doesn't also select `backend`
or `contracts`; that would run them twice. Select `backend-e2e` or a named e2e check only when the change needs
them beyond `unit`.
