# S-5 and S-6 on testnets

Checked 2026-10-09 with `cast` against each chain, from the deployer `0xe15800B2007EaC6Fe3f3eac3BE38207ce32d2755`.
Mainnet values are not checked yet; repeat this before any mainnet deploy.

## Result

| Chain | Chain ID | Working RPCs | CreateX `0xba5E…ba5Ed` | CREATE2 deployer `0x4e59…956C` | Safe proxy factory 1.4.1 `0x4e1D…ec67` |
|---|---|---|---|---|---|
| Base Sepolia | 84532 | Infura (4 of 6 keys), `sepolia.base.org` | yes | yes | yes |
| Arbitrum Sepolia | 421614 | Infura (5 of 6 keys), `sepolia-rollup.arbitrum.io/rpc` | yes | yes | yes |
| Arc testnet | 5042002 | Infura (3 of 6 keys), dRPC, Blockdaemon. Circle's own RPC and QuickNode answer HTTP 403 (Cloudflare 1009, region block) from our network | yes | yes | yes |
| Tempo Moderato | 42431 | `rpc.moderato.tempo.xyz`. Infura does not serve Tempo | yes | yes | yes |

Decision (S-5): deploy the factory through the CREATE2 deployer, so its address commits to the code and is the same on
all four testnets. No nonce-based fallback is needed on any of them.

## Test tokens (S-6)

| Chain | Token | Contract | Decimals | Note |
|---|---|---|---|---|
| Base Sepolia | USDC | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` | 6 | Circle faucet |
| Arbitrum Sepolia | USDC | `0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d` | 6 | Circle faucet; bridged USDC.e is a different token |
| Arc testnet | USDC | `0x3600000000000000000000000000000000000000` | 6 | Native gas coin and ERC-20 share one balance (gas uses 18 decimals). The receiver must never let a native-coin `recover` lower the invoice USDC balance |
| Tempo Moderato | PathUSD, AlphaUSD, BetaUSD, ThetaUSD | `0x20c0…0000`, `…0001`, `…0002`, `…0003` | 6 | TIP-20 test stablecoins; no USDC found yet. Fees are paid in these tokens; the native balance shown by RPC is a placeholder |

No official testnet USDT was found on these chains; USDT behaviour is tested with a mock token (PLAN S-6).

## Deployment (F037, 2026-10-09)

The v1 factory `0xCB9cc4b71331E7C09f4605CFD767F5C5143F6864` and the probe receiver
`0x17D3b2324ECf3B7b921E1Cf05D8C810040abd3a5` have the same addresses on all four testnets
(`packages/contracts/deployments.json`). A real invoice was paid, settled and refunded on Arc (USDC) and Tempo (AlphaUSD).
Base and Arbitrum Sepolia ran without a payment because the deployer has no test USDC there (Circle faucet).

Findings:
- Arc USDC and Tempo TIP-20 tokens are built into the chain. Foundry cannot run them locally (`StackUnderflow`,
  `OpcodeNotFound`), so scripts that touch them fail in simulation and fork tests cannot cover them. The payment flow runs
  with `cast` against the chain instead.
- Tempo prices contract and storage creation higher than Ethereum: the factory deploy ran out of gas with Foundry's local
  estimate (2.62M of 2.66M). Deploys use `--skip-simulation`, so the chain estimates gas itself. The backend signer must
  also use the chain's `eth_estimateGas`, never a hard-coded limit.
- Tempo charges fees in a TIP-20 stablecoin (PathUSD here), so the executor and refund authority need a stablecoin balance
  there, like USDC on Arc.

## Sources

- Arc RPCs and contract addresses: https://docs.arc.io/arc/references/rpc-endpoints, https://docs.arc.io/arc/references/contract-addresses
- Tempo chain id and RPC: https://docs.chainstack.com/reference/tempo-getting-started.md, `cast` on `rpc.moderato.tempo.xyz`
- Infura endpoint format: https://docs.infura.io/get-started/endpoints/
- Base and Arbitrum Sepolia USDC: Circle testnet addresses, confirmed with `decimals()` on chain
