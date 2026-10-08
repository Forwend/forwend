import type { Tone } from "../types/ui/tone";

// Text on its soft ground; every pair is covered by the design-tokens contrast test.
/** Solid tone color for small marks such as a status dot. */
export const TONE_DOT_CLASSES: Record<Tone, string> = {
  neutral: "bg-subtle",
  accent: "bg-accent",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
  info: "bg-info",
};

export const TONE_CLASSES: Record<Tone, string> = {
  neutral: "bg-surface-2 text-muted border-line",
  accent: "bg-info-soft text-accent border-transparent",
  success: "bg-success-soft text-success border-transparent",
  warning: "bg-warning-soft text-warning border-transparent",
  danger: "bg-danger-soft text-danger border-transparent",
  info: "bg-info-soft text-info border-transparent",
};
