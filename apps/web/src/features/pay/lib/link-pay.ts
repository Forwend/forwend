/** USD cents of a decimal like "25" or "25.50", which USD_PATTERN has checked. */
export function usdCents(amount: string): bigint {
  const [whole = "0", fraction = ""] = amount.split(".");
  return BigInt(whole) * 100n + BigInt(`${fraction}00`.slice(0, 2));
}

const storageKey = (slug: string) => `forwend:link:${slug}`;

/**
 * R-142: the invoice this browser made from the link for these cents, so Pay again reuses it. The browser may refuse
 * storage (a private window): then each Pay makes a new invoice.
 */
export function savedInvoice(slug: string, cents: bigint): string | null {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey(slug)) ?? "{}") as Record<
      string,
      string
    >;
    return saved[cents.toString()] ?? null;
  } catch {
    return null;
  }
}

export function saveInvoice(slug: string, cents: bigint, payToken: string): void {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey(slug)) ?? "{}") as Record<
      string,
      string
    >;
    localStorage.setItem(
      storageKey(slug),
      JSON.stringify({ ...saved, [cents.toString()]: payToken }),
    );
  } catch {
    // Storage refused: nothing to reuse next time.
  }
}
