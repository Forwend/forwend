/** The shop's own prices, in cents. The browser sends item ids and quantities, never a price (R-170). */
export const CATALOG = {
  beans: { name: "Espresso beans, 1 kg", cents: 2400 },
  mug: { name: "Stoneware mug", cents: 1250 },
  grinder: { name: "Hand grinder", cents: 8900 },
} as const;

export type ItemId = keyof typeof CATALOG;

export const MAX_QUANTITY = 10;

export interface PricedLine {
  id: ItemId;
  name: string;
  quantity: number;
  cents: number;
}

/** Prices a cart from the catalog; null when it names an unknown item, an item twice, or a quantity out of 1 to 10. */
export function priceCart(lines: unknown): { lines: PricedLine[]; totalCents: number } | null {
  if (!Array.isArray(lines) || lines.length === 0) return null;
  const priced: PricedLine[] = [];
  for (const line of lines) {
    const { id, quantity } = (line ?? {}) as { id?: unknown; quantity?: unknown };
    if (
      typeof id !== "string" ||
      !Object.hasOwn(CATALOG, id) ||
      priced.some((p) => p.id === id) ||
      typeof quantity !== "number" ||
      !Number.isInteger(quantity) ||
      quantity < 1 ||
      quantity > MAX_QUANTITY
    ) {
      return null;
    }
    const item = CATALOG[id as ItemId];
    priced.push({ id: id as ItemId, name: item.name, quantity, cents: item.cents });
  }
  return { lines: priced, totalCents: priced.reduce((sum, l) => sum + l.cents * l.quantity, 0) };
}

/** Cents as the API's decimal USD: 2450 is "24.50". */
export function usd(cents: number): string {
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}
