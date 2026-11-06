# Contracts operations

The refund-authority Safe and deploys. Design: [architecture.md](architecture.md). Code rules: [rules.md](rules.md).

## Safe setup (mainnet; testnets use an EOA)

- Safe 1.4.1+, at least 3 of 5 owners on hardware keys.
- Same address everywhere. Deploy it on day one on every planned chain and on every EVM chain where a wrong-chain
  deposit could arrive, before any owner change (former owners could otherwise claim the address there).
- Owner changes are applied on every chain. Keep the original owner keys recoverable.
- Old factories keep their Safe forever.

## Delay module (24–48 h)

- Every queued transaction alerts all owners, so an honest one can cancel it.
- Goes through the delay: receiver `refund`, `recover` and late `settle`; factory and implementation `recover`; Safe
  admin changes (owners, threshold, guard, modules, fallback handler); the Delay module's own settings.
- Set `txExpiration`. Cancel every unwanted queued transaction: after the cooldown anyone can execute it.
- The delay stops tricked or blind signing. It cannot stop owners who hold the threshold themselves.

## Guard

- Direct (undelayed) transactions only for: `factory.setPaused`, `factory.setExecutor`, queuing on the Delay module,
  cancelling there (`setTxNonce`).
- Direct transactions never use `delegatecall`.
- It also decodes calls that queue on the Delay module and allows an inner `delegatecall` only to
  `MultiSendCallOnly` 1.4.1 (for batches like deploy-then-refund).

## Before signing

- Check the transaction hash with an independent tool.
- For a refund: the target is `factory.predict(terms)`. `receiverOf(invoiceId)` is only a lookup aid: the first deploy
  wins, so it can name other terms. The terms match the claim, and `refundable` covers the amount.
- Refunds require a verified payer destination (D-118). Never assume an exchange sender belongs to the payer;
  a different destination needs written evidence.
- For a factory or implementation `recover`: that contract holds the amount, and the destination is verified like a
  refund's.
- `cmd/ops return` prints the calls and has already checked the amount, the destination and a dry run
  ([returns through support](../backend/money-safety.md#returns-through-support)).
- A pause longer than a few hours alerts every owner: paid invoices pushed past their effective deadline can then
  be settled only by the Safe.

## Testnet deploys

- `packages/contracts/script/deploy.sh <chain> [<token> <amount>]`: deploys the factory (idempotent) and probe;
  with a token it also pays, settles, refunds the extra and checks `statusOf`.
- It reads the first executor from `FIRST_EXECUTOR`, never from the signing key: that address is part of the factory address.
- Record it in `packages/contracts/deployments.json`; a replaced factory moves to `superseded`.
- Every deploy needs Sasha's explicit yes. Results: local docs/spikes/s5-s6-testnets.md notes (`../spikes/s5-s6-testnets.md`).
