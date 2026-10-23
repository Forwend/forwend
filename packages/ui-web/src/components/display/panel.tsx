import type { ComponentPropsWithoutRef } from "react";
import { cx } from "../../lib/cx";

export const PANEL_TONES = {
  solid: "solid",
  glass: "glass",
} as const;

export type PanelTone = (typeof PANEL_TONES)[keyof typeof PANEL_TONES];

export interface PanelProps extends ComponentPropsWithoutRef<"div"> {
  tone?: PanelTone;
}

/** Glass only where the panel sits on imagery. */
export function Panel({ tone = PANEL_TONES.solid, className, ...props }: PanelProps) {
  return (
    <div
      className={cx(
        "rounded-lg border p-5 text-ink",
        tone === PANEL_TONES.glass
          ? "border-[color-mix(in_oklab,var(--fw-surface)_60%,transparent)] bg-glass shadow-lg backdrop-blur-glass"
          : "border-line bg-surface",
        className,
      )}
      {...props}
    />
  );
}
