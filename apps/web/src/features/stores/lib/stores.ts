import type { StoreField } from "@/features/stores/types/stores";

const FIELDS: StoreField[] = ["name", "defaultExpiresIn", "allowedOrigins"];

/** One origin per line; blank lines are dropped. */
export function originLines(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

/** The field a refused save names: the API's message reads "invalid profile request: name must be …". */
export function invalidStoreField(message: string): StoreField | null {
  const name = message.split(": ")[1]?.split(" ")[0];
  return FIELDS.find((field) => field === name) ?? null;
}

/** Whether link's origin is one of a store's allowed origins, as the API checks a return link (R-134). */
export function allowsReturnLink(origins: readonly string[], link: string): boolean {
  try {
    return origins.includes(new URL(link).origin);
  } catch {
    return false;
  }
}
