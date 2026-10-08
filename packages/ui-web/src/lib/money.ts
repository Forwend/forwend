import type { TokenAmountInput } from "../types/money/amount";

const GROUPING = new Intl.NumberFormat("en-US", { useGrouping: true });

// Formats base units exactly with bigint math; never passes through floating point.
export function formatTokenAmount({
  baseUnits,
  decimals,
  fractionDigits = 2,
}: TokenAmountInput): string {
  const negative = baseUnits < 0n;
  const absolute = negative ? -baseUnits : baseUnits;
  const scale = 10n ** BigInt(decimals);
  const whole = absolute / scale;
  const fraction = (absolute % scale).toString().padStart(decimals, "0");
  const shown = fraction.slice(0, fractionDigits).padEnd(fractionDigits, "0");
  const text = fractionDigits > 0 ? `${GROUPING.format(whole)}.${shown}` : GROUPING.format(whole);
  // A negative amount too small to show prints as zero, not "-0.00".
  return negative && /[1-9]/.test(text) ? `-${text}` : text;
}
