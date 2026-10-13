import { z } from "zod";

// Building blocks for the API's shapes (apps/backend/api/openapi.yaml). A response that breaks them is reported as a
// failed request rather than shown: money is never drawn from a value the page cannot trust.

/** Integer base units as a decimal string: never a float, never negative. */
export const baseUnits = z.string().regex(/^\d+$/);

/** USD to the cent or finer as a decimal string, such as "12.50". */
export const usdAmount = z.string().regex(/^\d+(\.\d+)?$/);

/** An EVM address, 0x and 40 hex digits. */
export const evmAddress = z.string().regex(/^0x[0-9a-fA-F]{40}$/);

/** A 32-byte hex value: a transaction hash or an invoice id. */
export const hash32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/);

/** An RFC 3339 time with its offset, as the API writes them. */
export const apiTime = z.iso.datetime({ offset: true });

/** A YYYY-MM-DD date. */
export const apiDate = z.iso.date();

/** A non-negative integer: chain ids, block numbers, counts. */
export const count = z.number().int().nonnegative();

/**
 * A status from the API: one of `values` today, but a newer API may add one, which the page shows as unknown rather
 * than failing. The type keeps the known values for autocomplete.
 */
export function openEnum<T extends string>() {
  return z.custom<T | (string & {})>((value) => typeof value === "string");
}

/** A cursor page: the items and the cursor of the next page, null on the last. */
export function pageOf<T extends z.ZodType>(item: T) {
  return z.object({ items: z.array(item), nextCursor: z.string().nullable() });
}
