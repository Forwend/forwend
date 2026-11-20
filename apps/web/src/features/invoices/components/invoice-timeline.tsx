import { cx, TIMELINE_STATES, Timeline, type TimelineEntry } from "@forwend/ui-web";
import { RECORD_STEP_STATES } from "@/features/invoices/constants/invoices";
import { INVOICE_COPY as COPY } from "@/features/invoices/constants/invoices-copy";
import { recordStepStates } from "@/features/invoices/lib/invoices";
import type { RecordStep } from "@/features/invoices/types/invoices";
import { PANEL_TITLE } from "@/shared/constants/panel";
import { dateTime } from "@/shared/lib/dates";

export interface InvoiceTimelineProps {
  steps: readonly RecordStep[];
  className?: string;
}

export function InvoiceTimeline({ steps, className }: InvoiceTimelineProps) {
  return (
    <section aria-labelledby="invoice-timeline" className={cx("fw-panel", className)}>
      <h2 id="invoice-timeline" className={PANEL_TITLE}>
        {COPY.progressTitle}
      </h2>
      <div className="px-4 py-4 sm:px-5">
        <Timeline label={COPY.progressTitle} entries={entries(steps)} />
      </div>
    </section>
  );
}

// The timeline has no stopped state: how the invoice ended is its last done step.
const TIMELINE_STATE = {
  [RECORD_STEP_STATES.done]: TIMELINE_STATES.done,
  [RECORD_STEP_STATES.stopped]: TIMELINE_STATES.done,
  [RECORD_STEP_STATES.current]: TIMELINE_STATES.current,
  [RECORD_STEP_STATES.upcoming]: TIMELINE_STATES.upcoming,
};

function entries(steps: readonly RecordStep[]): TimelineEntry[] {
  const states = recordStepStates(steps);
  return steps.map((step, i) => ({
    id: step.id,
    title: COPY.timelineSteps[step.id],
    time: step.at ? dateTime(step.at) : undefined,
    chips: step.count ? [{ label: COPY.openedChip, value: COPY.opened(step.count) }] : undefined,
    state: TIMELINE_STATE[states[i] ?? RECORD_STEP_STATES.upcoming],
  }));
}
