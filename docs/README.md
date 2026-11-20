# Documentation map

Start with the root [AGENTS.md](../AGENTS.md). Read only the row relevant to your task.

| Topic | Owner |
|---|---|
| Task workflow and checks | [workflow.md](workflow.md); [config.json](config.json) defines commands |
| Staging CI and the Dokploy staging deploy | [staging.md](staging.md) |
| Requirements, decisions and open questions | [PROJECT.md](PROJECT.md) |
| Future phases and release gates | [PLAN.md](../PLAN.md) |
| System boundaries and money flow | [architecture.md](architecture.md) |
| Merchant payment model: stores, links, checkout, payments | [merchant-payments.md](merchant-payments.md) |
| Backend | [architecture](backend/architecture.md), [code rules](backend/rules.md), [API](backend/api.md), [money safety](backend/money-safety.md), [RPC operations](backend/rpc.md) |
| Contracts | [architecture](contracts/architecture.md), [code rules](contracts/rules.md), [operations](contracts/operations.md) |
| Web and shared UI | [architecture](web/architecture.md), [code rules](web/rules.md), [design](web/DESIGN.md), [product copy](web/PRODUCT.md) |
| Image sources | [web/images.md](web/images.md) |
| Measured integration results | `spikes/` (optional local notes) |
| Product research behind a phase plan | `research/` (optional local notes); owner interview questions in [owner-research.md](owner-research.md) |
| System diagrams | [diagrams/](diagrams/) |

`tasks.json` owns progress; use harness `status`/`show` instead of reading it.
`runs/` contains ignored logs; `install.json` records harness-owned file hashes.
Add a doc only when an existing owner cannot hold the topic. Link to rules rather than copying them.
