# Contracts architecture

How invoice receivers work. Binding rules: [rules.md](rules.md). Safe and deploys: [operations.md](operations.md).
Testnet addresses: `packages/contracts/deployments.json`.

Diagrams (open with `npx mapgrain@0.2.5 studio <file>.json`): [workflow](../diagrams/contracts-workflow.json),
[invoice states](../diagrams/invoice-lifecycle.json), [who can move money](../diagrams/security-keys.json).

## Parts

- **Factory**: one per release (`v1`, `v2`…), same address on every chain. `predict(terms)` gives an invoice's
  receive address; `deploy(terms)` creates the receiver there.
- **Receiver**: an OpenZeppelin clone whose immutable args are the invoice terms. It can pay `amount` to `recipient`
  once, or return money through the refund authority. Nothing else.
- **Executor**: our signer's key. Deploys receivers and settles paid invoices. Cannot send money anywhere else.
- **Refund authority**: the Safe multisig behind a delay. Refunds, recoveries, late settles, pause, executor change.

## Why this design

- The address commits to the terms, so nobody can take it over, and an unpaid invoice costs no gas (lazy deploy).
- Payers send a plain token transfer, so exchange withdrawals work.
- The same factory address on every chain lets the Safe recover money sent on the wrong chain.
- No upgrades or admin sweep: a bug is fixed by a new factory, and pause stops settlement meanwhile.
- The recipient comes from the profile wallet in our backend; the contract cannot tell right from wrong, so that
  check lives in [money-safety.md](../backend/money-safety.md).
