# Docs

Map of the docs. Each app or package `AGENTS.md` points to its area here.

## Harness (fixed paths, read by `scripts/harness.py`)

- [PROJECT.md](PROJECT.md): users, scope, terms, requirements (R-), decisions (D-), assumptions (A-), questions (Q-).
- `tasks.json`: task queue; change it only through `python3 scripts/harness.py`.
- `config.json`: checks and delivery. `install.json`: what bootstrap installed. `runs/`: check logs, not committed.

## System

- [architecture.md](architecture.md): parts, who holds which key, money flow.
- [diagrams/](diagrams/): mapgrain diagrams (`npx mapgrain@0.2.5 studio <file>.json`).
- [spikes/](spikes/): results of technical spikes, one file each.

## Areas

| Area | Docs |
|---|---|
| Backend | [architecture](backend/architecture.md), [rules](backend/rules.md), [API](backend/api.md), [money safety](backend/money-safety.md) |
| Contracts | [architecture](contracts/architecture.md), [rules](contracts/rules.md), [operations](contracts/operations.md) |
| Web | [architecture](web/architecture.md), [rules](web/rules.md), [design](web/DESIGN.md), [product](web/PRODUCT.md), [images](web/images.md) |

## Adding docs

- A new area gets `docs/<area>/` (`architecture.md`, `rules.md`, more only when needed) and a short `AGENTS.md` in
  its package that points here.
- Keep files short: bullets, one topic per file, no history, no folder listings that go stale.
- Decisions go in PROJECT.md as D- rows. No plan, status or changelog files.
- A procedure agents repeat becomes a skill in `.claude/skills/<name>/SKILL.md`, linked from the area's docs.
