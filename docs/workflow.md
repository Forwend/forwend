# Development workflow

Entry point: `python3 scripts/harness.py`. Add `-h` after any command for options.
Check definitions live only in [config.json](config.json); CI runs the same registry.
Task state lives in `tasks.json` (edit through the runner); logs in ignored `runs/`.
Runner regression tests live in `tests/test_harness.py`. No installed skill is needed to use this workflow.

## One task at a time

1. `status`, then `show ID`: read acceptance, refs, checks and must-not-change paths.
2. For new work, add a requirement in [PROJECT.md](PROJECT.md), then `add "behavior" --type fix --accept "..." --check CHECK --ref R-N --keep "path/*"`.
   Define unclear scope before coding. Split independent changes into tasks. Do not start unrelated queued product work.
3. `start ID` creates the task branch from the latest base. Finish a pending PR before another task.
4. Before creating or moving files, read the owning structure rules: [web/UI](web/structure.md), [backend](backend/rules.md).
   Identify the owner, filename and allowed dependencies; search for existing code before adding another shared helper.
   Reproduce bugs first. Make the smallest fix and run its direct checks. Add tests for behavior, not formatting or copied prose.
5. `verify ID --proof "1=CHECK: evidence" ...` runs task and required checks. Each acceptance line needs a named check.
6. If review is required, a fresh reviewer reads `show ID` and the diff, then runs `review ID --pass|--fail --summary "findings"`.
7. With commit/push/merge authorization, commit the verified files and run `done ID`. It pushes, opens the PR, checks CI and merges.
   Pending CI: repeat `done ID`. Failed CI: fix, verify, review and commit again. Approval or closed PR: ask the owner.
8. Before stopping: `wrapup --note "result; next step"`. Resolve failures or report the exact remaining blocker.

## Structure review

Before verification, inspect added and moved paths and their imports against the owning structure rules.
A reviewer checks feature ownership, concrete names, grouped UI families, dependency direction, and whether a
growing file mixes independent responsibilities. No empty scaffolding, catch-all modules, duplicate request
layers or arbitrary file-size limits. Explain any necessary exception in the task proof or review.

For a refactor, acceptance must require unchanged behavior and public contracts, updated imports/exports and
test discovery, and the relevant existing checks. Record unrelated cleanup separately rather than expanding
the task. The structure rules do not authorize adding dependencies or moving code outside the task scope.

`docs-check` validates documentation links and decision IDs, not source architecture. Structure review is
manual until a task explicitly adds import-boundary checks; do not claim that passing lint proves ownership.

## Evidence and scope

- `check` runs required checks without changing task state; `check CHECK` runs one; `check --ci` adds CI-only checks.
- `verify` rejects changed inputs during a run. Later source, config or task-constraint edits require another verify.
- Proof names must refer to checks that passed. The description explains relevance; independent review checks that claim.
- `--keep` path globs are enforced. Behavioral constraints need tests and review; prose alone is not a machine check.
- Completed v2 records remain historical evidence. New verification uses v3 evidence; old unmerged verification must rerun.
- Missing scripts, commands, remote or CI results never imply success. `passing` with pending delivery is not merged.
- Fix failed checks; never weaken them. After three failures without a new approach, `note` attempts and `block ID --reason "..."`.
- `edit` changes task scope; `reopen` resumes completed work; `drop` removes obsolete work with a reason.
  Update affected PROJECT rows and task refs together. `note` records only useful handoff facts.
- Research only when needed, using primary sources. Record decisions in PROJECT; cite external facts where they are used.
