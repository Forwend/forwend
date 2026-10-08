export interface TokenAmountInput {
  /** Integer amount in the token's base units. */
  baseUnits: bigint;
  /** Token decimals, for example 6 for USDC. */
  decimals: number;
  /** Fraction digits to show; extra digits are cut, never rounded up. */
  fractionDigits?: number;
}
