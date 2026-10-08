// Copies of light-theme tokens for places CSS variables cannot reach: the generated Open Graph
// image and the browser theme-color. test/brand-colors.test.ts fails if they drift from tokens.css.
export const BRAND_COLORS = {
  bg: "#f4f8f7",
  ink: "#0f2219",
  muted: "#3a5047",
} as const;
