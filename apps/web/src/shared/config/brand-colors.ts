// Copies of light-theme tokens for places CSS variables cannot reach: the generated Open Graph
// image and the browser theme-color. No test compares them (colors are judged in screenshots): when one of
// these tokens changes in packages/design-tokens/src/tokens.css, change it here in the same commit.
export const BRAND_COLORS = {
  bg: "#f4f8f7",
  ink: "#0f2219",
  muted: "#3a5047",
} as const;

/** Dark-theme copies, same rule as above. */
export const BRAND_COLORS_DARK = {
  bg: "#0d1412",
} as const;
