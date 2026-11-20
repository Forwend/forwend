import { USD_PATTERN } from "@/shared/constants/money";

export function typeKey(amount: string, key: string): string {
  const next = key === "." ? `${amount || "0"}.` : amount === "0" ? key : amount + key;
  // "12." is on its way to "12.50": it fits when "12.0" does.
  return USD_PATTERN.test(next.replace(/\.$/, ".0")) ? next : amount;
}
