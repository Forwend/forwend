import type { ReactNode } from "react";
import { cx } from "../../lib/cx";
import { TONE_CLASSES, TONES, type Tone } from "../../lib/tone";

export interface BadgeProps {
  tone?: Tone;
  children: ReactNode;
}

export function Badge({ tone = TONES.neutral, children }: BadgeProps) {
  return (
    <span
      className={cx(
        "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-pill border px-2.5 py-0.5 text-xs font-medium",
        TONE_CLASSES[tone],
      )}
    >
      {children}
    </span>
  );
}
