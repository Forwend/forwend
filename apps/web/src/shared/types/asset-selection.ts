/** One accepted-asset choice: an exact token contract on one network, with the allowlist's symbol. */
export interface AssetOption {
  chainId: number;
  token: string;
  symbol: string;
}

export interface AssetGroup {
  symbol: string;
  options: AssetOption[];
}
