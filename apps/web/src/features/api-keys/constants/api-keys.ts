import { PERMISSIONS } from "@/features/profiles/constants/profile";

/** Never money, the team, billing details or a store's settings. */
export const KEY_SCOPES = [
  PERMISSIONS.invoicesRead,
  PERMISSIONS.invoicesWrite,
  PERMISSIONS.storesRead,
  PERMISSIONS.tokensRead,
] as const;

export const OVERLAP_HOURS = [0, 1, 24, 168] as const;
export const DEFAULT_OVERLAP_HOURS = 24;

export const KEY_NAME_MAX = 100;
