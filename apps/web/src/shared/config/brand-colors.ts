// Copies of light-theme tokens for the Open Graph image and theme-color, where CSS variables can't reach. No test
// compares them: change them with packages/design-tokens/src/tokens.css in the same commit.
export const BRAND_COLORS = {
  bg: "#ffffff",
  ink: "#0e0e0e",
  muted: "#5c5c5c",
} as const;

/** Dark-theme copies, same rule as above. */
export const BRAND_COLORS_DARK = {
  bg: "#0c0c0c",
} as const;
