// What this tab showed, kept so a reload shows it again. Session storage may be off: nothing is kept.

export const shownKey = (invoiceId: string) => `forwend:pay:${invoiceId}`;
const askedKey = (invoiceId: string) => `forwend:cross:${invoiceId}`;

export function readTab(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

export function keepTab(key: string, value: string | null): void {
  try {
    if (value === null) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, value);
  } catch {
    // Storage is off: nothing is kept.
  }
}

export function readAsked(invoiceId: string): { assetId: string; refundTo: string } | null {
  try {
    const asked = JSON.parse(readTab(askedKey(invoiceId)) ?? "null") as {
      assetId?: unknown;
      refundTo?: unknown;
    } | null;
    return typeof asked?.assetId === "string" && typeof asked.refundTo === "string"
      ? { assetId: asked.assetId, refundTo: asked.refundTo }
      : null;
  } catch {
    return null;
  }
}

export function keepAsked(invoiceId: string, asked: { assetId: string; refundTo: string }): void {
  keepTab(askedKey(invoiceId), JSON.stringify(asked));
}
