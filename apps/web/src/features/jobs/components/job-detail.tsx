"use client";

import { Button, buttonClasses, COPY_STATUS, StatusPill, useCopy } from "@forwend/ui-web";
import { Check, Copy, ExternalLink } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { formatUsd } from "@/features/balances/lib/balances";
import { invoiceNumber } from "@/features/invoices/lib/invoices";
import { JobRecord } from "@/features/jobs/components/job-record";
import { MarkDone } from "@/features/jobs/components/mark-done";
import { JOBS_COPY } from "@/features/jobs/constants/jobs-copy";
import { apiCents } from "@/features/jobs/lib/jobs";
import type { Job, JobPaymentStatus } from "@/features/jobs/types/jobs";
import { Party } from "@/shared/components/party";
import { APP_ROUTES } from "@/shared/config/routes";
import { MONEY_COPY } from "@/shared/constants/money-copy";

const COPY = JOBS_COPY.detail;
const TIME = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
const DAY = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });
const COUNTRY = new Intl.DisplayNames(undefined, { type: "region" });
const PANEL = "fw-panel";
const PANEL_TITLE = "fw-panel-head text-base font-semibold text-ink";
const usd = (amountUsd: string) => `${formatUsd(apiCents(amountUsd))} ${MONEY_COPY.usd}`;

export interface JobDetailProps {
  profileId: string;
  job: Job;
}

// A job's page (R-101), laid out like an invoice's: the payments on the left, then the scope; the client's link and
// who is billed on the right. Each payment shows how it gets invoiced, and once it is, its invoice and status. Once
// accepted, the next payment without an invoice can be marked done (R-103).
export function JobDetail({ profileId, job }: JobDetailProps) {
  // The app renders only in the browser, after sign-in.
  const link = `${window.location.origin}/w/${job.token}`;
  const [copyStatus, copy] = useCopy(link);
  const c = job.client;
  const next = job.acceptedAt ? job.payments.find((p) => !p.invoiceId) : undefined;
  // Marking a step done takes its button away: focus moves to its invoice once the job shows it.
  const [focusInvoice, setFocusInvoice] = useState<number | null>(null);
  const made = focusInvoice ? job.payments[focusInvoice - 1]?.invoiceId : null;
  useEffect(() => {
    if (focusInvoice && made) {
      document.getElementById(`job-payment-${focusInvoice}-invoice`)?.focus();
      setFocusInvoice(null);
    }
  }, [focusInvoice, made]);
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,22rem)]">
      <div className="flex min-w-0 flex-col gap-4">
        <section aria-labelledby="job-payments" className={PANEL}>
          <h2 id="job-payments" className={PANEL_TITLE}>
            {COPY.payments}
          </h2>
          <ol className="divide-y divide-line">
            {job.payments.map((p) => (
              <li
                key={p.position}
                className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-4 py-3 sm:px-5"
              >
                <div className="flex min-w-0 flex-col gap-0.5">
                  <p className="font-medium break-words text-ink">{p.title}</p>
                  <p className="text-sm text-muted">
                    {p.onAccept ? COPY.onAccept : COPY.afterDone}, {COPY.dueDays(p.dueDays)}
                  </p>
                  {p.invoiceId && p.number ? (
                    <p className="flex flex-wrap items-center gap-2 text-sm">
                      <Link
                        id={`job-payment-${p.position}-invoice`}
                        href={`${APP_ROUTES.invoices}/${p.invoiceId}`}
                        className="font-medium text-ink underline underline-offset-2"
                      >
                        {invoiceNumber(p.number)}
                      </Link>
                      {p.status ? <StatusPill status={p.status as JobPaymentStatus} /> : null}
                    </p>
                  ) : (
                    <p className="text-sm text-subtle">{COPY.notInvoiced}</p>
                  )}
                  {p.doneAt ? (
                    <p className="flex flex-wrap gap-x-2 text-sm text-muted">
                      {COPY.done(DAY.format(new Date(p.doneAt)))}
                      {p.deliveryLink ? (
                        <a
                          href={p.deliveryLink}
                          target="_blank"
                          rel="noopener noreferrer nofollow"
                          className="text-ink underline underline-offset-2"
                        >
                          {COPY.deliveryLink}
                          <span className="sr-only"> {COPY.inNewTab}</span>
                        </a>
                      ) : null}
                    </p>
                  ) : null}
                  {p === next ? (
                    <MarkDone
                      profileId={profileId}
                      job={job}
                      payment={p}
                      onDone={setFocusInvoice}
                    />
                  ) : null}
                </div>
                <p className="shrink-0 font-medium tabular-nums text-ink">{usd(p.amountUsd)}</p>
              </li>
            ))}
          </ol>
          <p className="flex items-baseline justify-between gap-3 border-t border-line px-4 py-3 sm:px-5">
            <span className="text-sm text-muted">{COPY.total}</span>
            <span className="text-lg font-semibold tabular-nums text-ink">{usd(job.totalUsd)}</span>
          </p>
        </section>
        {job.scope ? (
          <section aria-labelledby="job-scope" className={PANEL}>
            <h2 id="job-scope" className={PANEL_TITLE}>
              {COPY.scope}
            </h2>
            <p className="px-4 py-3 text-sm break-words whitespace-pre-line text-ink sm:px-5">
              {job.scope}
            </p>
          </section>
        ) : null}
      </div>

      <div className="flex min-w-0 flex-col gap-4">
        <section aria-labelledby="job-link" className={PANEL}>
          <h2 id="job-link" className={PANEL_TITLE}>
            {COPY.linkGroup}
          </h2>
          <div className="flex flex-col items-start gap-3 px-4 py-3 sm:px-5">
            <p className="text-sm text-ink">
              {job.acceptedAt && job.acceptedName
                ? COPY.acceptedBy(
                    job.acceptedName,
                    job.acceptedEmail ?? "",
                    TIME.format(new Date(job.acceptedAt)),
                  )
                : COPY.waiting(c.name)}
            </p>
            <p className="text-sm text-muted">
              {job.acceptedAt ? COPY.linkHintAccepted : COPY.linkHint}
            </p>
            <p className="w-full truncate rounded-md bg-sunken px-3 py-2 font-mono text-xs text-ink">
              {link}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" onClick={() => void copy()}>
                {copyStatus === COPY_STATUS.copied ? (
                  <Check aria-hidden className="size-[var(--fw-icon-sm)]" />
                ) : (
                  <Copy aria-hidden className="size-[var(--fw-icon-sm)]" />
                )}
                {copyStatus === COPY_STATUS.copied
                  ? COPY.copied
                  : copyStatus === COPY_STATUS.failed
                    ? COPY.copyFailed
                    : COPY.copy}
              </Button>
              <a
                href={link}
                target="_blank"
                rel="noopener noreferrer"
                className={buttonClasses({ size: "sm", variant: "ghost" })}
              >
                <ExternalLink aria-hidden className="size-[var(--fw-icon-sm)]" />
                {COPY.open}
                <span className="sr-only"> {COPY.inNewTab}</span>
              </a>
            </div>
            <p role="status" className="sr-only">
              {copyStatus === COPY_STATUS.copied
                ? COPY.copied
                : copyStatus === COPY_STATUS.failed
                  ? COPY.copyFailed
                  : ""}
            </p>
          </div>
        </section>
        <JobRecord job={job} acceptedEmail={job.acceptedEmail} />
        <section aria-labelledby="job-client" className={PANEL}>
          <h2 id="job-client" className={PANEL_TITLE}>
            {COPY.client}
          </h2>
          <Party
            lines={[
              c.name,
              c.email,
              c.address,
              c.country ? (COUNTRY.of(c.country) ?? c.country) : null,
              c.taxId ? `${COPY.taxId} ${c.taxId}` : null,
            ]}
          />
        </section>
      </div>
    </div>
  );
}
