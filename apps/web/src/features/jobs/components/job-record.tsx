import { formatUsd } from "@/features/balances/lib/balances";
import { invoiceNumber } from "@/features/invoices/lib/invoices";
import { RECORD_EVENTS } from "@/features/jobs/constants/jobs";
import { RECORD_COPY as COPY } from "@/features/jobs/constants/jobs-copy";
import { apiCents, jobRecord } from "@/features/jobs/lib/jobs";
import type { PublicJob, RecordEvent } from "@/features/jobs/types/jobs";
import { MONEY_COPY } from "@/shared/constants/money-copy";

const TIME = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
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

// R-104: the job's dated record as dispute evidence, on the owner's job page and the client's quote page. Every time is
// the server's.
export function JobRecord({ job, acceptedEmail = null }: JobRecordProps) {
  return (
    <section aria-labelledby="job-record" className="fw-panel">
      <h2 id="job-record" className="fw-panel-head text-base font-semibold text-ink">
        {COPY.title}
      </h2>
      <ol className="flex flex-col gap-2 px-4 py-3 text-sm sm:px-5">
        {jobRecord(job).map((event) => (
          <li
            key={`${event.kind}-${event.payment?.position ?? 0}`}
            className="flex flex-wrap gap-x-3 gap-y-0.5"
          >
            <time dateTime={event.at} className="shrink-0 text-muted tabular-nums sm:w-44">
              {TIME.format(new Date(event.at))}
            </time>
            <span className="min-w-0 break-words text-ink">
              {describeEvent(event, job, acceptedEmail)}
              {event.kind === RECORD_EVENTS.done && event.payment?.deliveryLink ? (
                <>
                  {" · "}
                  <a
                    href={event.payment.deliveryLink}
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                    className="underline underline-offset-2"
                  >
                    {COPY.deliveryLink}
                    <span className="sr-only"> {COPY.inNewTab}</span>
                  </a>
                </>
              ) : null}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
