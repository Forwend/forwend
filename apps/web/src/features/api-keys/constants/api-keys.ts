import { PERMISSIONS } from "@/features/profiles/constants/profile";

/** What a key may be made with (D-95): never money, the team, billing details or a store's settings. */
export const KEY_SCOPES = [
  PERMISSIONS.invoicesRead,
  PERMISSIONS.invoicesWrite,
  PERMISSIONS.storesRead,
  PERMISSIONS.tokensRead,
] as const;

/** How long a rolled key keeps working beside its new one, in hours; the API takes 0 to 168, 24 by default. */
export const OVERLAP_HOURS = [0, 1, 24, 168] as const;
export const DEFAULT_OVERLAP_HOURS = 24;

/** The API's limit on a key's name. */
export const KEY_NAME_MAX = 100;
