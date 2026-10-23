// Copies of light-theme tokens for the Open Graph image and theme-color, where CSS variables can't reach. No test
// compares them: change them with packages/design-tokens/src/tokens.css in the same commit.
export const BRAND_COLORS = {
  bg: "#f4f8f7",
  ink: "#0f2219",
  muted: "#3a5047",
} as const;

/** Dark-theme copies, same rule as above. */
export const BRAND_COLORS_DARK = {
  bg: "#0d1412",
} as const;
