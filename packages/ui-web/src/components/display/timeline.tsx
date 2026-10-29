import { Check } from "lucide-react";
import type { ReactNode } from "react";
import { cx } from "../../lib/cx";

export const TIMELINE_STATES = {
  done: "done",
  current: "current",
  upcoming: "upcoming",
} as const;

export type TimelineState = (typeof TIMELINE_STATES)[keyof typeof TIMELINE_STATES];

export interface TimelineChip {
  label: string;
  value: ReactNode;
}

export interface TimelineEntry {
  id: string;
  title: string;
  state: TimelineState;
  /** When it happened, already formatted; an upcoming step may have none yet. */
  time?: string;
  description?: ReactNode;
  /** Small label and value pairs under the entry, such as the network or a transaction. */
  chips?: readonly TimelineChip[];
}

export interface TimelineProps {
  entries: readonly TimelineEntry[];
  label: string;
  className?: string;
}

/** A vertical record of what happened and what comes next: done is a check, current a ring, upcoming an empty
 * circle, joined by a line that is ink below finished steps. */
export function Timeline({ entries, label, className }: TimelineProps) {
  return (
    <ol aria-label={label} className={cx("flex flex-col", className)}>
      {entries.map((entry, i) => {
        const last = i === entries.length - 1;
        return (
          <li
            key={entry.id}
            aria-current={entry.state === TIMELINE_STATES.current ? "step" : undefined}
            className="relative grid grid-cols-[1.25rem_minmax(0,1fr)] gap-x-3"
          >
            <span className="relative flex justify-center">
              <Marker state={entry.state} />
              {last ? null : (
                <span
                  aria-hidden
                  className={cx(
                    "absolute top-6 bottom-0 w-px",
                    entry.state === TIMELINE_STATES.done ? "bg-ink/40" : "bg-line",
                  )}
                />
              )}
            </span>
            <div className={cx("min-w-0", last ? "pb-0" : "pb-5")}>
              <p className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <span
                  className={cx(
                    "text-sm font-medium",
                    entry.state === TIMELINE_STATES.upcoming ? "text-subtle" : "text-ink",
                  )}
                >
                  {entry.title}
                </span>
                {entry.time ? (
                  <span className="text-xs text-muted tabular-nums">{entry.time}</span>
                ) : null}
              </p>
              {entry.description ? (
                <p className="mt-1 text-sm text-muted [overflow-wrap:anywhere]">
                  {entry.description}
                </p>
              ) : null}
              {entry.chips?.length ? (
                <p className="mt-2 flex flex-wrap gap-1.5">
                  {entry.chips.map((chip) => (
                    <span
                      key={chip.label}
                      className="inline-flex max-w-full items-center gap-1 rounded-sm border border-line bg-surface-2 px-1.5 py-0.5 text-xs"
                    >
                      <span className="text-subtle">{chip.label}</span>
                      <span className="min-w-0 truncate text-ink">{chip.value}</span>
                    </span>
                  ))}
                </p>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function Marker({ state }: { state: TimelineState }) {
  if (state === TIMELINE_STATES.done) {
    return (
      <span className="relative z-1 mt-0.5 grid size-5 place-items-center rounded-pill bg-ink text-bg">
        <Check aria-hidden strokeWidth={3} className="size-3" />
        <span className="sr-only">Done: </span>
      </span>
    );
  }
  if (state === TIMELINE_STATES.current) {
    return (
      <span className="relative z-1 mt-0.5 grid size-5 place-items-center rounded-pill border-2 border-accent bg-surface">
        <span className="size-1.5 rounded-pill bg-accent" />
        <span className="sr-only">Now: </span>
      </span>
    );
  }
  return (
    <span className="relative z-1 mt-0.5 size-5 rounded-pill border border-line-strong bg-surface">
      <span className="sr-only">Next: </span>
    </span>
  );
}
