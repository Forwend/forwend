// The river in the hero image (/images/hero-dawn.webp), in that image's pixels (1672x941).
// Positions were picked on water by eye; check them visually whenever the image changes.
export const RIVER_VIEWBOX = { width: 1672, height: 941 } as const;

/** One mark per payment step, from the sunrise toward the visitor (desktop: panel beside the river). */
export const RIVER_MARKS = [
  [855, 635],
  [930, 665],
  [790, 730],
  [930, 810],
] as const;

/** Phones: the panel overlaps the lower river, so the last mark stays in the open water above it. */
export const RIVER_MARKS_COMPACT = [
  [855, 630],
  [925, 660],
  [800, 712],
  [830, 748],
] as const;

export const RIVER_SOURCE = [848, 606] as const;
