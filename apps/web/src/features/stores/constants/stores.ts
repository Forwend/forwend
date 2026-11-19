export const STORE_LIMITS = {
  name: 64,
  origins: 20,
  logoBytes: 1_048_576,
  logoSide: 1024,
} as const;

export const BRAND_COLOR_PATTERN = /^(#[0-9a-fA-F]{6})?$/;

export const COLOR_PICKER_START = "#000000";

export const LOGO_TYPES = ["image/png", "image/jpeg"] as const;
