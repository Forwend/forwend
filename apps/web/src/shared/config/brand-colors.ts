// Copies of light-theme tokens for the Open Graph image and theme-color, where CSS variables can't reach. No test
// compares them: change them with packages/design-tokens/src/tokens.css in the same commit.
export const BRAND_COLORS = {
  bg: "#ffffff",
  ink: "#0e0f0e",
  muted: "#5b5e5a",
} as const;

/** Dark-theme copies, same rule as above. */
export const BRAND_COLORS_DARK = {
  bg: "#0c0d0c",
} as const;
