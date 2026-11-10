/** Fraction digits that show the amount exactly: at least 2, more only when the amount has them. */
export function exactDigits(baseUnits: bigint, decimals: number): number {
  const fraction = (baseUnits % 10n ** BigInt(decimals)).toString().padStart(decimals, "0");
  return Math.min(decimals, Math.max(2, fraction.replace(/0+$/, "").length));
}

/** USD cents of a decimal like "25" or "25.50", whose form the caller has checked. */
export function usdCents(amount: string): bigint {
  const [whole = "0", fraction = ""] = amount.split(".");
  return BigInt(whole) * 100n + BigInt(`${fraction}00`.slice(0, 2));
}

/** "25.50" for 2550 cents. */
export function usdFromCents(cents: bigint): string {
  return `${cents / 100n}.${(cents % 100n).toString().padStart(2, "0")}`;
}
