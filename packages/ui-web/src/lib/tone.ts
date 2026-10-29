export const TONES = {
  neutral: "neutral",
  accent: "accent",
  success: "success",
  warning: "warning",
  danger: "danger",
  info: "info",
} as const;

export type Tone = (typeof TONES)[keyof typeof TONES];

export const TONE_DOT_CLASSES: Record<Tone, string> = {
  neutral: "bg-subtle",
  accent: "bg-accent",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
  info: "bg-info",
};

// One compact shape for every status and tag, so a badge and a payment status line up in a row.
export const BADGE_CLASSES =
  "inline-flex h-6 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-sm border px-2 text-xs font-medium";

// Text on its soft ground; the contrast test covers each pair, accent on info-soft included.
export const TONE_CLASSES: Record<Tone, string> = {
  neutral: "bg-surface-2 text-muted border-line",
  accent: "bg-info-soft text-accent border-transparent",
  success: "bg-success-soft text-success border-transparent",
  warning: "bg-warning-soft text-warning border-transparent",
  danger: "bg-danger-soft text-danger border-transparent",
  info: "bg-info-soft text-info border-transparent",
};
