import { TIMELINE_STATES, Timeline } from "@forwend/ui-web";
import { invoiceNumber } from "@/features/invoices/lib/invoices";
import { RECORD_EVENTS } from "@/features/jobs/constants/jobs";
import { RECORD_COPY as COPY } from "@/features/jobs/constants/jobs-copy";
import { jobRecord, usdText } from "@/features/jobs/lib/jobs";
import type { Job, PublicJob, RecordEvent } from "@/features/jobs/types/jobs";
import { dateTime } from "@/shared/lib/dates";

const number = (event: RecordEvent) => invoiceNumber(event.payment?.number ?? 0);
// Only the owner's read gives the emails the client typed to accept the quote and each change.
const acceptedEmail = (read: object) =>
  "acceptedEmail" in read ? (read.acceptedEmail as string | null) : null;

function describeEvent(event: RecordEvent, job: PublicJob): string {
  const title = event.payment?.title ?? "";
  switch (event.kind) {
    case RECORD_EVENTS.created:
      return COPY.created;
    case RECORD_EVENTS.accepted:
      return COPY.accepted(job.acceptedName ?? "", acceptedEmail(job));
    case RECORD_EVENTS.proposed:
      return COPY.proposed(title, usdText(event.payment?.amountUsd ?? "0.00"));
    case RECORD_EVENTS.changeAccepted:
      return COPY.changeAccepted(
        title,
        event.payment?.acceptedName ?? "",
        event.payment ? acceptedEmail(event.payment) : null,
      );
    case RECORD_EVENTS.done:
      return COPY.done(title);
    case RECORD_EVENTS.invoiced:
      return COPY.invoiced(number(event), title);
    default:
      return COPY.paid(number(event));
  }
}

export interface JobRecordProps {
  job: PublicJob | Job;
}

// R-104: dispute evidence, so every time is the server's. The same timeline as the payment and invoice pages.
export function JobRecord({ job }: JobRecordProps) {
  return (
    <section aria-labelledby="job-record" className="fw-panel">
      <h2 id="job-record" className="fw-panel-head text-base font-semibold text-ink">
        {COPY.title}
      </h2>
      <div className="px-4 py-4 sm:px-5">
        <Timeline
          label={COPY.title}
          entries={jobRecord(job).map((event) => ({
            id: `${event.kind}-${event.payment?.position ?? 0}`,
            title: describeEvent(event, job),
            state: TIMELINE_STATES.done,
            time: dateTime(event.at),
            description:
              event.kind === RECORD_EVENTS.done && event.payment?.deliveryLink ? (
                <a
                  href={event.payment.deliveryLink}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  className="underline underline-offset-2"
                >
                  {COPY.deliveryLink}
                  <span className="sr-only"> {COPY.inNewTab}</span>
                </a>
              ) : undefined,
          }))}
        />
      </div>
    </section>
  );
}
