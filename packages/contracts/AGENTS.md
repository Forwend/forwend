# Contracts

Solidity invoice receivers v1: a factory and one receiver clone per invoice (Foundry, OpenZeppelin in `lib/`).

## Commands

- `forge build`, `forge test` here, or `pnpm --filter @forwend/contracts test` from the root.
- Libraries are git submodules in `lib/` (`git submodule update --init --recursive`).
- `node script/rpc.mjs <chain>` prints a working RPC (Infura keys, then public RPCs).
- Keys only in the root `.env`. Never print or commit one.

## Read before writing code

- [docs/contracts/rules.md](../../docs/contracts/rules.md): every binding rule, each with a test.
- [docs/contracts/architecture.md](../../docs/contracts/architecture.md): parts and why.
- [docs/contracts/operations.md](../../docs/contracts/operations.md): Safe setup and deploys.
