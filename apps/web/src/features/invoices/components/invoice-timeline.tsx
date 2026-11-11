import { cx, TIMELINE_STATES, Timeline, type TimelineEntry } from "@forwend/ui-web";
import { RECORD_STEPS } from "@/features/invoices/constants/invoices";
import { INVOICE_COPY as COPY } from "@/features/invoices/constants/invoices-copy";
import type { RecordStep } from "@/features/invoices/types/invoices";
import { dateTime } from "@/shared/lib/dates";

export interface InvoiceTimelineProps {
  steps: readonly RecordStep[];
  className?: string;
}

/** The invoice's record as a vertical timeline: the phone's form of the amount panel's step row. */
export function InvoiceTimeline({ steps, className }: InvoiceTimelineProps) {
  return (
    <section aria-labelledby="invoice-timeline" className={cx("fw-panel", className)}>
      <h2 id="invoice-timeline" className="fw-panel-head text-base font-semibold text-ink">
        {COPY.progressTitle}
      </h2>
      <div className="px-4 py-4 sm:px-5">
        <Timeline label={COPY.progressTitle} entries={entries(steps)} />
      </div>
    </section>
  );
}

function entries(steps: readonly RecordStep[]): TimelineEntry[] {
  const ended = steps.some((s) => s.id === RECORD_STEPS.closed || s.id === RECORD_STEPS.canceled);
  const current = steps.findIndex((s) => !s.done);
  return steps.map((step, i) => ({
    id: step.id,
    title: COPY.timelineSteps[step.id],
    time: step.at ? dateTime(step.at) : undefined,
    chips: step.count ? [{ label: COPY.openedChip, value: COPY.opened(step.count) }] : undefined,
    state: step.done
      ? TIMELINE_STATES.done
      : i === current && !ended
        ? TIMELINE_STATES.current
        : TIMELINE_STATES.upcoming,
  }));
}
