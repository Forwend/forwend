import { formatTokenAmount } from "@forwend/ui-web";
import { AMOUNT_ERRORS, USD_DECIMALS } from "@/shared/constants/money";
import { MONEY_COPY } from "@/shared/constants/money-copy";
import type { AmountError } from "@/shared/types/money";

/** Fraction digits that show the amount exactly: at least 2, more only when the amount has them. */
export function exactDigits(baseUnits: bigint, decimals: number): number {
  const fraction = (baseUnits % 10n ** BigInt(decimals)).toString().padStart(decimals, "0");
  return Math.min(decimals, Math.max(2, fraction.replace(/0+$/, "").length));
}

/** Every digit the amount has, at least two: "1,250.50", "0.000001". */
export function exactAmount(baseUnits: bigint, decimals: number): string {
  return formatTokenAmount({
    baseUnits,
    decimals,
    fractionDigits: exactDigits(baseUnits, decimals),
  });
}

export function amountText(units: bigint, of: { decimals: number; symbol: string }): string {
  return `${exactAmount(units, of.decimals)} ${of.symbol}`;
}

export function formatUsd(cents: bigint): string {
  return formatTokenAmount({ baseUnits: cents, decimals: USD_DECIMALS });
}

export function usdText(cents: bigint): string {
  return `${formatUsd(cents)} ${MONEY_COPY.usd}`;
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

/** Exact, never through a float. A comma is refused: "12,50" could mean 12.50 or 1250. */
export function parseTokenAmount(text: string, decimals: number): bigint | AmountError {
  const match = /^(\d*)\.?(\d*)$/.exec(text.trim());
  if (!match || (!match[1] && !match[2])) return AMOUNT_ERRORS.format;
  const [, whole = "", fraction = ""] = match;
  if (fraction.length > decimals) return AMOUNT_ERRORS.decimals;
  const units = BigInt(whole + fraction.padEnd(decimals, "0"));
  return units === 0n ? AMOUNT_ERRORS.zero : units;
}
