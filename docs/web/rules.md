# Web rules

Apply to `apps/web`, `packages/ui-web` and `packages/design-tokens`. Before adding or moving files, read
[structure.md](structure.md): ownership, filenames, landing sections, shared UI groups, hooks, services and state (D-11).

- Start every new screen or control from the closest one that exists, and reuse its layout and components, not only
  its look: the kit on `/kit`, `apps/web/src/shared/`, and a screen of the same kind with its section in
  [DESIGN.md](DESIGN.md) (a list like Invoices, a form page like New invoice, a detail page like an invoice).
- When nothing fits, research the pattern before building it: its keyboard and screen-reader behavior in the
  [WAI-ARIA Authoring Practices](https://www.w3.org/WAI/ARIA/apg/patterns/), and how two or three well-known products
  solve it. Build it once where its next use will find it: presentation without app behavior in `packages/ui-web`
  (on `/kit` with every state), app-level pieces in `apps/web/src/shared/`. Describe the pattern in DESIGN.md.
- Use tokens from `packages/design-tokens` for every color, size, radius, shadow and duration. No raw hex or pixels.
- Reusable presentation components without app-specific behavior go in `packages/ui-web` and appear on `/kit`
  with all their states in the same change. Components tied to a product feature stay with that feature.
- Landing copy is honest: no customer logos, funding badges, or claims of being regulated, insured or live.
- Mood images (landscapes, textures) come from Codex `image_gen` via `codex exec` (D-9). Product UI, charts and text
  are code. Store images as WebP in `apps/web/public/images/` and log them in [images.md](images.md).
- Respect `prefers-reduced-motion`; no scroll hijacking.
- Tests follow [Which tests to keep](../workflow.md#which-tests-to-keep). Here that means money display, payment
  logic, `/kit` privacy and accessibility (axe). Width checks (no sideways scroll at the R-7 and R-66 widths) are
  tested; fonts, colors and section order are judged in screenshots, not tested.
- Visual decisions follow [DESIGN.md](DESIGN.md) (tokens, type, components) and [PRODUCT.md](PRODUCT.md) (brief).
