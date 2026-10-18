import { invoiceNumber } from "@/features/invoices/lib/invoices";
import { RECORD_EVENTS } from "@/features/jobs/constants/jobs";
import { RECORD_COPY as COPY } from "@/features/jobs/constants/jobs-copy";
import { jobRecord } from "@/features/jobs/lib/jobs";
import type { PublicJob, RecordEvent } from "@/features/jobs/types/jobs";

const TIME = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
const number = (event: RecordEvent) => invoiceNumber(event.payment?.number ?? 0);

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
              {event.kind === RECORD_EVENTS.created
                ? COPY.created
                : event.kind === RECORD_EVENTS.accepted
                  ? COPY.accepted(job.acceptedName ?? "", acceptedEmail)
                  : event.kind === RECORD_EVENTS.done
                    ? COPY.done(event.payment?.title ?? "")
                    : event.kind === RECORD_EVENTS.invoiced
                      ? COPY.invoiced(number(event), event.payment?.title ?? "")
                      : COPY.paid(number(event))}
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
