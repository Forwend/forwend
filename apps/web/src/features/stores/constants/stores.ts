/** The API's limits (apps/backend/api/openapi.yaml, StoreRequest and putStoreLogo). */
export const STORE_LIMITS = {
  name: 64,
  origins: 20,
  logoBytes: 1_048_576,
  logoSide: 1024,
} as const;

/** "#rrggbb", or empty for none (R-135). */
export const BRAND_COLOR_PATTERN = /^(#[0-9a-fA-F]{6})?$/;

/** What the color picker shows before a color is set: it can't be empty. */
export const COLOR_PICKER_START = "#000000";

/** The logo types the API takes; it serves every logo as a PNG. */
export const LOGO_TYPES = ["image/png", "image/jpeg"] as const;
