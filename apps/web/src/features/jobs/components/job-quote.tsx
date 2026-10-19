"use client";

import { Button, buttonClasses, PAYMENT_STATUS, Skeleton, StatusPill } from "@forwend/ui-web";
import { useEffect, useRef, useState } from "react";
import { formatUsd } from "@/features/balances/lib/balances";
import { invoiceNumber } from "@/features/invoices/lib/invoices";
import { useAcceptJobMutation, useGetPublicJobQuery } from "@/features/jobs/api/jobs-api";
import { AcceptChange } from "@/features/jobs/components/accept-change";
import { ConsentForm } from "@/features/jobs/components/consent-form";
import { JobRecord } from "@/features/jobs/components/job-record";
import { QUOTE_COPY as COPY } from "@/features/jobs/constants/jobs-copy";
import { apiCents, isPendingChange } from "@/features/jobs/lib/jobs";
import type { JobPayment, JobPaymentStatus } from "@/features/jobs/types/jobs";
import { Party } from "@/shared/components/party";
import { MONEY_COPY } from "@/shared/constants/money-copy";

const TIME = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
const COUNTRY = new Intl.DisplayNames(undefined, { type: "region" });
const PANEL = "fw-panel";
const PANEL_TITLE = "fw-panel-head text-base font-semibold text-ink";
const NOT_FOUND = 404;
const usd = (amountUsd: string) => `${formatUsd(apiCents(amountUsd))} ${MONEY_COPY.usd}`;
// The pay link carries its token (D-86).
const payHref = (p: JobPayment) => `/pay/${p.payToken}`;
// A made payment the client can still pay: its pay page takes money.
const payable = (p: JobPayment) => p.payToken !== null && p.status === PAYMENT_STATUS.open;

// The client's quote (R-102): who sends it, the work and the payments, then Accept with a typed name and email. Once
// accepted the form gives way to who accepted and when, and focus moves there; the deposit's pay link is the main
// action. A made payment links its pay page while it takes money.
export function JobQuote({ token }: { token: string }) {
  const query = useGetPublicJobQuery(token);
  const [accept, accepted] = useAcceptJobMutation();
  const heading = useRef<HTMLHeadingElement>(null);
  const [justAccepted, setJustAccepted] = useState(false);
  // The accept's answer until the read shows the acceptance; then the read, which also follows the changes.
  const job = query.currentData?.acceptedAt
    ? query.currentData
    : (accepted.data ?? query.currentData);
  const status = (query.error as { status?: unknown } | undefined)?.status;
  useEffect(() => {
    if (justAccepted) heading.current?.focus();
  }, [justAccepted]);
  // An accepted change's form goes: focus moves to the line that says it is accepted, once the job shows it.
  const [focusChange, setFocusChange] = useState<number | null>(null);
  const changeAccepted = focusChange ? Boolean(job?.payments[focusChange - 1]?.acceptedAt) : false;
  useEffect(() => {
    if (focusChange && changeAccepted) {
      document.getElementById(`quote-change-${focusChange}`)?.focus();
      setFocusChange(null);
    }
  }, [focusChange, changeAccepted]);

  // A change withdrawn or replaced before the client's accept: the read takes its form away, so the page says so.
  const [gone, setGone] = useState(0);
  const goneNotice = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (gone) goneNotice.current?.focus();
  }, [gone]);

  if (!job) {
    return (
      <div className="flex w-full max-w-2xl flex-col gap-4">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">{COPY.title}</h1>
        {status === NOT_FOUND ? (
          <p role="alert" className="text-muted">
            {COPY.notFound}
          </p>
        ) : query.isError ? (
          <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-muted">
            {COPY.failed}
            <Button size="sm" variant="secondary" onClick={() => void query.refetch()}>
              {COPY.retry}
            </Button>
          </div>
        ) : (
          <Skeleton className="h-96 w-full" />
        )}
      </div>
    );
  }

  const deposit = job.payments.find((p) => p.onAccept && payable(p));
  const i = job.issuer;
  return (
    <div className="flex w-full max-w-2xl flex-col gap-4">
      <header className="flex flex-col gap-1">
        <p className="text-sm text-muted">{COPY.from(i.name)}</p>
        <h1 className="text-2xl font-semibold tracking-tight break-words text-ink sm:text-3xl">
          {job.title}
        </h1>
      </header>

      {job.acceptedAt && job.acceptedName ? (
        <section aria-labelledby="quote-accepted" className={PANEL}>
          <h2
            id="quote-accepted"
            ref={heading}
            tabIndex={-1}
            className={`${PANEL_TITLE} outline-none`}
          >
            {COPY.accepted.title}
          </h2>
          <div className="flex flex-col items-start gap-3 px-4 py-3 sm:px-5">
            <p role="status" className="text-sm text-ink">
              {COPY.accepted.by(job.acceptedName, TIME.format(new Date(job.acceptedAt)))}
            </p>
            {deposit ? (
              <>
                <p className="text-sm text-muted">{COPY.accepted.deposit}</p>
                <a href={payHref(deposit)} className={buttonClasses({})}>
                  {COPY.payDeposit}
                </a>
              </>
            ) : null}
          </div>
        </section>
      ) : null}

      <section aria-labelledby="quote-payments" className={PANEL}>
        <h2 id="quote-payments" className={PANEL_TITLE}>
          {COPY.payments}
        </h2>
        {gone ? (
          <p
            ref={goneNotice}
            tabIndex={-1}
            className="border-b border-line px-4 py-3 text-sm text-danger outline-none sm:px-5"
          >
            {COPY.change.gone}
          </p>
        ) : null}
        <ol className="divide-y divide-line">
          {job.payments.map((p) => (
            <li
              key={p.position}
              className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-4 py-3 sm:px-5"
            >
              <div className="flex min-w-0 flex-col gap-1">
                <p className="font-medium break-words text-ink">{p.title}</p>
                <p className="text-sm text-muted">
                  {p.onAccept ? COPY.onAccept : COPY.afterDone}, {COPY.dueDays(p.dueDays)}
                </p>
                {p.proposedAt ? (
                  <p
                    id={`quote-change-${p.position}`}
                    tabIndex={-1}
                    className="text-sm text-muted outline-none"
                  >
                    <span className="font-medium text-ink">{COPY.change.label}</span>
                    {" · "}
                    {p.acceptedAt && p.acceptedName
                      ? COPY.change.accepted(p.acceptedName, TIME.format(new Date(p.acceptedAt)))
                      : COPY.change.waiting}
                  </p>
                ) : null}
                {isPendingChange(p) ? (
                  <AcceptChange
                    token={token}
                    change={p}
                    onAccepted={(position) => {
                      setGone(0);
                      setFocusChange(position);
                    }}
                    onGone={() => setGone((n) => n + 1)}
                  />
                ) : null}
                {p.deliveryLink ? (
                  <a
                    href={p.deliveryLink}
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                    className="self-start text-sm text-ink underline underline-offset-2"
                  >
                    {COPY.delivered}
                    <span className="sr-only"> {COPY.inNewTab}</span>
                  </a>
                ) : null}
                {p.invoiceId && p.number ? (
                  payable(p) && p !== deposit ? (
                    <a
                      href={payHref(p)}
                      className={`${buttonClasses({ size: "sm", variant: "secondary" })} self-start`}
                    >
                      {COPY.pay(invoiceNumber(p.number))}
                    </a>
                  ) : p.status && p.status !== PAYMENT_STATUS.open ? (
                    <span className="flex flex-wrap items-center gap-2 text-sm text-muted">
                      {invoiceNumber(p.number)}
                      <StatusPill status={p.status as JobPaymentStatus} />
                    </span>
                  ) : null
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
        <section aria-labelledby="quote-scope" className={PANEL}>
          <h2 id="quote-scope" className={PANEL_TITLE}>
            {COPY.scope}
          </h2>
          <p className="px-4 py-3 text-sm break-words whitespace-pre-line text-ink sm:px-5">
            {job.scope}
          </p>
        </section>
      ) : null}

      <JobRecord job={job} />

      <section aria-labelledby="quote-issuer" className={PANEL}>
        <h2 id="quote-issuer" className={PANEL_TITLE}>
          {COPY.issuer}
        </h2>
        <Party
          lines={[
            i.name,
            i.email,
            i.address,
            COUNTRY.of(i.country) ?? i.country,
            i.taxId ? `${COPY.taxId} ${i.taxId}` : null,
          ]}
        />
      </section>

      {job.acceptedAt ? null : (
        <section aria-labelledby="quote-accept" className={PANEL}>
          <h2 id="quote-accept" className={PANEL_TITLE}>
            {COPY.accept.title}
          </h2>
          <ConsentForm
            text={COPY.accept.text}
            action={COPY.accept.action}
            notFound={COPY.notFound}
            loading={accepted.isLoading}
            className="px-4 py-4 sm:px-5"
            onConsent={async (name, email) => {
              await accept({ token, name, email }).unwrap();
              setJustAccepted(true);
            }}
          />
        </section>
      )}
    </div>
  );
}
