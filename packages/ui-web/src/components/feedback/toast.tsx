import { cx } from "../../lib/cx";
import { TONE_DOT_CLASSES, TONES, type Tone } from "../../lib/tone";

export interface ToastProps {
  tone?: Tone;
  title: string;
  description?: string;
}

export function Toast({ tone = TONES.neutral, title, description }: ToastProps) {
  return (
    <div
      role="status"
      className="flex w-full max-w-sm items-start gap-3 rounded-lg border border-line bg-surface p-4 shadow-lg"
    >
      <span
        aria-hidden
        className={cx("mt-1.5 size-2 shrink-0 rounded-pill", TONE_DOT_CLASSES[tone])}
      />
      <span>
        <span className="block text-sm font-semibold text-ink">{title}</span>
        {description ? (
          <span className="mt-0.5 block text-sm text-muted">{description}</span>
        ) : null}
      </span>
    </div>
  );
}
