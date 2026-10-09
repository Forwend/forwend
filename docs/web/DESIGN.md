# Design

Direction: Dawn Path marketing, dark Dusk Ledger product bands, Halftone Horizon texture (PROJECT D-13).
Use `/kit` for the implemented components. This file owns visual use; token source owns values:
[colors and sizes](../../packages/design-tokens/src/tokens.css), [themes](../../packages/design-tokens/src/theme.css),
[base styles](../../packages/design-tokens/src/base.css). Do not copy token values into documentation.

## Composition

- Dawn landscape with an open sky and a path toward the horizon. Center the serif headline in the upper third;
  keep badges, logos and metrics out of the sky. Sample invoice sits low over the river.
- Hero, dark checkout showcase and closing call-to-action run edge to edge, without inset corners.
- Regular section headings align left; hero and final call-to-action center. Fees and FAQ split at desktop widths.
- Step sequences form one connected path, horizontal on wide screens and vertical on phones.
- Light/dark hero images share their composition. Footer ridges and halftone dots use art tokens; paper grain is light-only.
- Glass sits over landscape art; floating navigation is the exception. Elsewhere use solid panels and soft shadows.

## Type and color

- Libre Caslon Display at 400 for large headings; Hanken Grotesk for UI and body; Geist Mono for money, addresses,
  hashes and event names. Money uses tabular figures. One exception: the app dashboard's total balance is the page's
  single display moment, set in Libre Caslon Display with lining tabular figures; every other amount stays mono. No bold display serif or small serif labels.
- Use role tokens for hero, section headings and featured amounts. No eyebrow labels or tracked uppercase kickers.
- Text and primary buttons share the primary ink. River blue identifies links, focus, the current step and information.
  Completed steps use ink; upcoming steps use line color.
- Success, warning and error use their matching text/background token pairs. Art colors never become UI colors.
- Cool neutral surfaces, rounded controls and cards, pill navigation/buttons/chips. No hard offset shadows.

## App shell

The signed-in app (`/app`) uses these patterns. The menu, sheet and action button are in `/kit`.

- Desktop: a full-height sidebar on the surface color with a line divider. The profile switcher sits at the top,
  page links in the middle (the current page on the second surface), the account at the bottom. Switching a profile
  keeps the current page.
- Phones: a compact header with the switcher, and a bottom tab bar: icon over label for each page, a raised round
  primary Receive button in the center, Account last. The current tab gets the same tint as the sidebar link.
- A choice opened from the sidebar is a menu; the same choice on a phone is a bottom sheet, which becomes a centered
  panel from small screens up. Both are solid surface panels with the float shadow and rise from the edge they open
  on; reduced motion removes the movement.
- Money actions are round icon buttons with the label underneath. Only the main action is filled with the primary
  ink; the others are outlined on the surface.
- A feature that is not built yet keeps its place in the subtle text color, with "Soon" as plain text at the end:
  no badge, no link. A disabled action says why in its accessible name and shows the reason when pressed.

## Theme and behavior

- Apply the saved theme, otherwise the system choice, before first paint using `data-theme` on `<html>`.
  Product sections can force dark with their own `data-theme="dark"`. Use the theme variant for theme-only differences.
- Status changes keep row geometry stable. Labels accompany status colors. Mark all demonstration data as Sample.
- Use motion tokens; respect reduced motion. No scroll hijacking or layout jumps during state changes.
- Target WCAG 2.2 AA, including text contrast, keyboard access and accessible status announcements.
- Keyboard focus stays visible. Errors identify the field and explain the correction; loading and success states are
  accessible to screen readers. Copy controls confirm successful copying and handle unavailable clipboard access.
- Responsive behavior, accessibility and money formatting have tests. Review composition and typography in screenshots.

Product wording: [PRODUCT.md](PRODUCT.md). Code rules: [rules.md](rules.md). Image prompts: [images.md](images.md).
