/** One enabled token's money for a profile (GET /v1/profiles/{id}/balances, TokenBalance). Amounts are base units. */
export interface TokenBalance {
  chainId: number;
  token: string;
  symbol: string;
  decimals: number;
  /** null when the wallet balance could not be read. */
  wallet: string | null;
  finalizedBlock: number | null;
  pending: string;
  held: string;
}

export interface Balances {
  tokens: TokenBalance[];
  /** Wallet balances at 1 USD per stablecoin, "12.50"; null when any balance is missing. */
  estimatedUsdTotal: string | null;
}
