# js

`@forwend/js`: the browser side of checkout (R-169, D-88, D-117). Hand-written TypeScript, ESM, no dependency.
`README.md` is its npm page; `CHANGELOG.md` gets a line with every change that ships.

- It frames `/embed/<token>` and takes only messages from that frame, from Forwend's origin, in the D-117 shape.
- Its events are hints: nothing in it may decide that an order is paid.
- Test: `pnpm --filter @forwend/js test`. Build: `pnpm --filter @forwend/js build` writes `dist/`.
- `node scripts/check-browser-packages.mjs` packs it with `@forwend/react`: files, gzip budget, a fresh install.
- Version 0.1.0 is published on npm. Later releases need the owner's approval and use CI (PLAN 11.9.4).
