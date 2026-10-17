# Contracts

Solidity invoice receivers v1: a factory and one receiver clone per invoice (Foundry, OpenZeppelin in `lib/`).

## Commands

- `forge build`, `forge test` here, or `pnpm --filter @forwend/contracts test` from the root.
- Libraries are git submodules in `lib/` (`git submodule update --init --recursive`).
- `pnpm vectors` rewrites `vectors/receive-address.json` (receive addresses the Go backend must match).
- `node script/rpc.mjs <chain>` prints a working RPC (Infura keys, then public RPCs).
- Keys only in `packages/contracts/.env` (names in `.env.example`); scripts load it. Never print or commit one.

## What to read

Always: [docs/contracts/rules.md](../../docs/contracts/rules.md): every binding rule, each with a test.

Then only the rows that match the task:

| The task touches | Read |
|---|---|
| How the parts fit, or why they are built this way | [docs/contracts/architecture.md](../../docs/contracts/architecture.md): parts and why |
| The Safe, deploys, keys, chains | [docs/contracts/operations.md](../../docs/contracts/operations.md): Safe setup and deploys |
