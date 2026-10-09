import { PANEL_TONES } from "../constants/panel";
import { cx } from "../lib/cx";
import type { PanelProps } from "../types/ui/display";

/** Solid surface by default. Glass only where the panel sits on imagery. */
export function Panel({ tone = PANEL_TONES.solid, className, ...props }: PanelProps) {
  return (
    <div
      className={cx(
        "rounded-lg border p-5 text-ink",
        tone === PANEL_TONES.glass
          ? "border-[color-mix(in_oklab,var(--fw-surface)_60%,transparent)] bg-glass shadow-lg backdrop-blur-glass"
          : "border-line bg-surface shadow-sm",
        className,
      )}
      {...props}
    />
  );
}
