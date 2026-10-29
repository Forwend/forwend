import type { ReactNode } from "react";
import { cx } from "../../lib/cx";
import { BADGE_CLASSES, TONE_CLASSES, TONES, type Tone } from "../../lib/tone";

export interface BadgeProps {
  tone?: Tone;
  children: ReactNode;
}

export function Badge({ tone = TONES.neutral, children }: BadgeProps) {
  return <span className={cx(BADGE_CLASSES, TONE_CLASSES[tone])}>{children}</span>;
}
