# Web rules

Apply to `apps/web`, `packages/ui-web` and `packages/design-tokens`. TypeScript structure (D-11) is in the root AGENTS.md.

- Use tokens from `packages/design-tokens` for every color, size, radius, shadow and duration. No raw hex or pixels.
- New reusable components go in `packages/ui-web` and appear on `/kit` with all their states in the same change.
- Landing copy is honest: no customer logos, funding badges, or claims of being regulated, insured or live.
- Mood images (landscapes, textures) come from Codex `image_gen` via `codex exec` (D-9). Product UI, charts and text
  are code. Store images as WebP in `apps/web/public/images/` and log them in [images.md](images.md).
- Respect `prefers-reduced-motion`; no scroll hijacking.
- Test only important behavior: money display, payment logic, forms, `/kit` privacy, theme, accessibility (axe). No
  tests for layout, sizes, fonts, colors or section order; judge those in screenshots.
- Visual decisions follow [DESIGN.md](DESIGN.md) (tokens, type, components) and [PRODUCT.md](PRODUCT.md) (brief).
