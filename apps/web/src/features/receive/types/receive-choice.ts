/**
 * One token on one network a profile can receive. The network ID and the chain family are plain strings, so a
 * non-EVM family fits later without changing the choice (D-44).
 */
export interface ReceiveOption {
  symbol: string;
  network: string;
  family: string;
}
