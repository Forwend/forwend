import { TIMELINE_STATES, Timeline, type TimelineEntry } from "@forwend/ui-web";
import { INVOICE_COPY as COPY } from "@/features/invoices/constants/invoices-copy";
import type { Invoice, InvoiceSend, InvoiceViews } from "@/features/invoices/types/invoices";
import { dateTime } from "@/shared/lib/dates";

export interface InvoiceTimelineProps {
  invoice: Invoice;
  sends: readonly InvoiceSend[];
  views: InvoiceViews | null;
}

/** The invoice's life so far and what comes next, from the facts the API gave: never a step ahead of them. */
export function InvoiceTimeline({ invoice, sends, views }: InvoiceTimelineProps) {
  return (
    <section aria-labelledby="invoice-timeline" className="fw-panel">
      <h2 id="invoice-timeline" className="fw-panel-head text-base font-semibold text-ink">
        {COPY.timeline}
      </h2>
      <div className="px-4 py-4 sm:px-5">
        <Timeline label={COPY.timeline} entries={entries(invoice, sends, views)} />
      </div>
    </section>
  );
}

function entries(
  invoice: Invoice,
  sends: readonly InvoiceSend[],
  views: InvoiceViews | null,
): TimelineEntry[] {
  const sent = sends.find((s) => s.sentAt)?.sentAt ?? null;
  const paid = invoice.paidAt !== null;
  const settled = invoice.settledAt !== null;
  const canceled = invoice.canceledAt !== null;
  const ended = !paid && (canceled || Date.parse(invoice.closesAt) <= Date.now());
  // Emailing is optional: the step shows once an email went out, never as a missing step.
  const steps: (Omit<TimelineEntry, "state"> & { done: boolean })[] = [
    {
      id: "created",
      title: COPY.timelineSteps.created,
      time: dateTime(invoice.createdAt),
      done: true,
    },
    ...(sent
      ? [{ id: "sent", title: COPY.timelineSteps.sent, time: dateTime(sent), done: true }]
      : []),
    {
      id: "opened",
      title: COPY.timelineSteps.opened,
      time: views?.firstAt ? dateTime(views.firstAt) : undefined,
      chips: views?.count
        ? [{ label: COPY.openedChip, value: COPY.opened(views.count) }]
        : undefined,
      done: Boolean(views?.firstAt) || paid,
    },
    {
      id: "paid",
      title: COPY.timelineSteps.paid,
      time: invoice.paidAt ? dateTime(invoice.paidAt) : undefined,
      done: paid,
    },
    ended
      ? {
          id: "ended",
          title: canceled ? COPY.timelineSteps.canceled : COPY.timelineSteps.closed,
          time: dateTime(invoice.canceledAt ?? invoice.closesAt),
          done: true,
        }
      : {
          id: "wallet",
          title: COPY.timelineSteps.wallet,
          time: invoice.settledAt ? dateTime(invoice.settledAt) : undefined,
          done: settled,
        },
  ];
  const current = steps.findIndex((s) => !s.done);
  return steps.map(({ done, ...step }, i) => ({
    ...step,
    state: done
      ? TIMELINE_STATES.done
      : i === current && !ended
        ? TIMELINE_STATES.current
        : TIMELINE_STATES.upcoming,
  }));
}
