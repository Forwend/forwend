import { TIMELINE_STATES, Timeline } from "@forwend/ui-web";
import { formatUsd } from "@/features/balances/lib/balances";
import { invoiceNumber } from "@/features/invoices/lib/invoices";
import { RECORD_EVENTS } from "@/features/jobs/constants/jobs";
import { RECORD_COPY as COPY } from "@/features/jobs/constants/jobs-copy";
import { apiCents, jobRecord } from "@/features/jobs/lib/jobs";
import type { PublicJob, RecordEvent } from "@/features/jobs/types/jobs";
import { MONEY_COPY } from "@/shared/constants/money-copy";
import { dateTime } from "@/shared/lib/dates";

const number = (event: RecordEvent) => invoiceNumber(event.payment?.number ?? 0);
const amount = (event: RecordEvent) =>
  `${formatUsd(apiCents(event.payment?.amountUsd ?? "0.00"))} ${MONEY_COPY.usd}`;
// Only the owner's read gives the email the client typed to accept a change.
const changeEmail = (event: RecordEvent) =>
  event.payment && "acceptedEmail" in event.payment
    ? (event.payment.acceptedEmail as string | null)
    : null;

function describeEvent(event: RecordEvent, job: PublicJob, acceptedEmail: string | null): string {
  const title = event.payment?.title ?? "";
  switch (event.kind) {
    case RECORD_EVENTS.created:
      return COPY.created;
    case RECORD_EVENTS.accepted:
      return COPY.accepted(job.acceptedName ?? "", acceptedEmail);
    case RECORD_EVENTS.proposed:
      return COPY.proposed(title, amount(event));
    case RECORD_EVENTS.changeAccepted:
      return COPY.changeAccepted(title, event.payment?.acceptedName ?? "", changeEmail(event));
    case RECORD_EVENTS.done:
      return COPY.done(title);
    case RECORD_EVENTS.invoiced:
      return COPY.invoiced(number(event), title);
    default:
      return COPY.paid(number(event));
  }
}

export interface JobRecordProps {
  job: PublicJob;
  /** The email the client typed when accepting; only the owner sees it. */
  acceptedEmail?: string | null;
}

// R-104: dispute evidence, so every time is the server's. The same timeline as the payment and invoice pages.
export function JobRecord({ job, acceptedEmail = null }: JobRecordProps) {
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
            title: describeEvent(event, job, acceptedEmail),
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
