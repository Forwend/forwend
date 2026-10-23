import { z } from "zod";

// Building blocks for the API's shapes (apps/backend/api/openapi.yaml).

/** Integer base units as a decimal string: never a float, never negative. */
export const baseUnits = z.string().regex(/^\d+$/);

export const usdAmount = z.string().regex(/^\d+(\.\d+)?$/);

export const evmAddress = z.string().regex(/^0x[0-9a-fA-F]{40}$/);

export const hash32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/);

export const apiTime = z.iso.datetime({ offset: true });

export const apiDate = z.iso.date();

export const count = z.number().int().nonnegative();

/** A newer API may add a status, which the page shows as unknown rather than failing. The type keeps the known
 * values for autocomplete. */
export function openEnum<T extends string>() {
  return z.custom<T | (string & {})>((value) => typeof value === "string");
}

/** A cursor page: the items and the cursor of the next page, null on the last. */
export function pageOf<T extends z.ZodType>(item: T) {
  return z.object({ items: z.array(item), nextCursor: z.string().nullable() });
}
