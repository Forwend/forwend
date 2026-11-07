# react

`@forwend/react`: `PayButton`, `Checkout` and `PaymentElement` over `@forwend/js` (R-169). React 18 and 19.
`README.md` is its npm page; `CHANGELOG.md` gets a line with every change that ships.

- Test: `pnpm --filter @forwend/react test` on React 19.
  - `test/react-18` runs the same file on React 18 (`pnpm --filter @forwend/react-18-check test`).
- Build: `pnpm --filter @forwend/react build` writes `dist/`; it reads `@forwend/js` from that package's `dist/`.
- `node scripts/check-browser-packages.mjs` packs both packages: files, gzip budget, a fresh install.
- Version 0.1.1 is published on npm. Later releases need the owner's approval and use CI (PLAN 11.9.4).
