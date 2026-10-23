/** Network and family are plain strings, so a non-EVM family fits later (D-44). */
export interface ReceiveOption {
  symbol: string;
  network: string;
  family: string;
}
