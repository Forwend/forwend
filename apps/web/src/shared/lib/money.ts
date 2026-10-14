/** Fraction digits that show the amount exactly: at least 2, more only when the amount has them. */
export function exactDigits(baseUnits: bigint, decimals: number): number {
  const fraction = (baseUnits % 10n ** BigInt(decimals)).toString().padStart(decimals, "0");
  return Math.min(decimals, Math.max(2, fraction.replace(/0+$/, "").length));
}
