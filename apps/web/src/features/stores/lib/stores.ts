import type { StoreField } from "@/features/stores/types/stores";
import { API_BASE } from "@/shared/config/api";

const FIELDS: StoreField[] = [
  "name",
  "defaultExpiresIn",
  "allowedOrigins",
  "brandColor",
  "tokensOff",
];

export function originLines(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

/** The API's message reads "invalid profile request: name must be …". */
export function invalidStoreField(message: string): StoreField | null {
  const name = message.split(": ")[1]?.split(" ")[0];
  return FIELDS.find((field) => field === name) ?? null;
}

/** https only, never a store's test-mode loopback origin. */
export function returnLinkOrigins(origins: readonly string[]): string[] {
  return origins.filter((origin) => origin.startsWith("https://"));
}

export function allowsReturnLink(origins: readonly string[], link: string): boolean {
  try {
    return returnLinkOrigins(origins).includes(new URL(link).origin);
  } catch {
    return false;
  }
}

/** Its save time keeps a cached older logo from showing. */
export function storeLogoUrl(storeId: string, logoAt: string): string {
  return `${API_BASE}/v1/stores/${encodeURIComponent(storeId)}/logo.png?v=${Date.parse(logoAt)}`;
}
