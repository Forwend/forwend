// The --fw-duration-* tokens in milliseconds, for JavaScript timers. test/tokens-sync.test.ts
// fails if these drift from tokens.css.
export const DURATION_MS = {
  fast: 140,
  base: 200,
  slow: 400,
  slower: 900,
} as const;
