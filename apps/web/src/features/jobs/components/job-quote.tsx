"use client";

import { BigAmount, buttonClasses, PAYMENT_STATUS, Skeleton, StatusPill } from "@forwend/ui-web";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { formatUsd } from "@/features/balances/lib/balances";
import { invoiceNumber } from "@/features/invoices/lib/invoices";
import { useAcceptJobMutation, useGetPublicJobQuery } from "@/features/jobs/api/jobs-api";
import { AcceptChange } from "@/features/jobs/components/accept-change";
import { ConsentForm } from "@/features/jobs/components/consent-form";
import { JobRecord } from "@/features/jobs/components/job-record";
import { PaymentStep } from "@/features/jobs/components/payment-step";
import { QUOTE_COPY as COPY } from "@/features/jobs/constants/jobs-copy";
import { apiCents, isPendingChange } from "@/features/jobs/lib/jobs";
import type { JobPayment, JobPaymentStatus } from "@/features/jobs/types/jobs";
import { Backdrop } from "@/features/pay/components/backdrop";
import { Payee } from "@/features/pay/components/payee";
import { LEFT_PAD, RIGHT_PAD } from "@/features/pay/constants/pay";
import { LoadError } from "@/shared/components/load-error";
import { MONEY_COPY } from "@/shared/constants/money-copy";

const TIME = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
const COUNTRY = new Intl.DisplayNames(undefined, { type: "region" });
const PANEL = "fw-panel";
const PANEL_TITLE = "fw-panel-head text-base font-semibold text-ink";
const NOT_FOUND = 404;
const usd = (amountUsd: string) => `${formatUsd(apiCents(amountUsd))} ${MONEY_COPY.usd}`;
// The pay link carries its token (D-86).
const payHref = (p: JobPayment) => `/pay/${p.payToken}`;
const payable = (p: JobPayment) => p.payToken !== null && p.status === PAYMENT_STATUS.open;

// R-102. Once accepted, focus moves to who accepted and when.
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
      <div className={`flex w-full flex-col gap-4 lg:col-span-2 lg:pt-8 ${LEFT_PAD}`}>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">{COPY.title}</h1>
        {status === NOT_FOUND ? (
          <p role="alert" className="text-muted">
            {COPY.notFound}
          </p>
        ) : query.isError ? (
          <LoadError
            message={COPY.failed}
            onRetry={() => void query.refetch()}
            retrying={query.isFetching}
          />
        ) : (
          <Skeleton className="h-96 w-full" />
        )}
      </div>
    );
  }

  const deposit = job.payments.find((p) => p.onAccept && payable(p));
  const agreed = job.payments.filter((p) => !isPendingChange(p)).length;
  const i = job.issuer;
  // From large screens the quote reads on the left half and the client acts on the right, as on the checkout pages.
  return (
    <>
      <Backdrop />
      <div className={`flex min-w-0 flex-col gap-8 lg:pt-8 lg:pb-12 ${LEFT_PAD}`}>
        <header className="flex flex-col gap-5">
          <Payee as="p" name={i.name} subtitle={COPY.title} />
          <div className="flex flex-col gap-1.5">
            <h1 className="text-2xl font-semibold tracking-tight break-words text-ink sm:text-3xl">
              {job.title}
            </h1>
            <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <BigAmount
                value={formatUsd(apiCents(job.totalUsd))}
                unit={MONEY_COPY.usd}
                className="text-3xl sm:text-4xl"
              />
              <span className="text-sm text-muted">{COPY.paymentCount(agreed)}</span>
            </p>
          </div>
        </header>

        {/* Plain sections on the summary's ground, as the checkout lists its items. */}
        <section aria-labelledby="quote-payments" className="flex flex-col">
          <h2
            id="quote-payments"
            className="border-b border-line pb-2 text-sm font-medium text-muted"
          >
            {COPY.payments}
          </h2>
          {gone ? (
            <p
              ref={goneNotice}
              tabIndex={-1}
              className="border-b border-line py-3 text-sm text-danger outline-none"
            >
              {COPY.change.gone}
            </p>
          ) : null}
          <ol className="pt-1 [&>li]:px-0">
            {job.payments.map((p, n) => (
              <PaymentStep
                key={p.position}
                payment={p}
                first={n === 0}
                last={n === job.payments.length - 1}
                amount={usd(p.amountUsd)}
              >
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
                    className="text-sm text-ink underline decoration-line-strong underline-offset-4 hover:decoration-ink"
                  >
                    {COPY.delivered}
                    <span className="sr-only"> {COPY.inNewTab}</span>
                  </a>
                ) : null}
                {p.invoiceId && p.number ? (
                  payable(p) && p !== deposit ? (
                    <Link
                      href={payHref(p)}
                      className={`${buttonClasses({ size: "sm", variant: "secondary" })} mt-1`}
                    >
                      {COPY.pay(invoiceNumber(p.number))}
                    </Link>
                  ) : p.status && p.status !== PAYMENT_STATUS.open ? (
                    <span className="flex flex-wrap items-center gap-2 text-sm text-muted">
                      {invoiceNumber(p.number)}
                      <StatusPill status={p.status as JobPaymentStatus} />
                    </span>
                  ) : null
                ) : null}
              </PaymentStep>
            ))}
          </ol>
          <p className="flex items-baseline justify-between gap-3 border-t border-line-strong pt-3">
            <span className="text-sm text-muted">{COPY.total}</span>
            <span className="font-semibold tabular-nums text-ink">{usd(job.totalUsd)}</span>
          </p>
        </section>

        {job.scope ? (
          <section aria-labelledby="quote-scope" className="flex flex-col gap-2">
            <h2 id="quote-scope" className="text-sm font-medium text-muted">
              {COPY.scope}
            </h2>
            <p className="text-sm break-words whitespace-pre-line text-ink">{job.scope}</p>
          </section>
        ) : null}

        <section aria-labelledby="quote-issuer" className="flex flex-col gap-1">
          <h2 id="quote-issuer" className="text-sm font-medium text-muted">
            {COPY.issuer}
          </h2>
          <ul className="flex flex-col text-sm text-ink">
            {[
              i.name,
              i.email,
              i.address,
              COUNTRY.of(i.country) ?? i.country,
              i.taxId ? `${COPY.taxId} ${i.taxId}` : null,
            ]
              .filter(Boolean)
              .map((line) => (
                <li key={line} className="break-words whitespace-pre-line">
                  {line}
                </li>
              ))}
          </ul>
        </section>
      </div>

      <div className={`flex min-w-0 flex-col lg:self-stretch lg:py-8 lg:pl-16 ${RIGHT_PAD}`}>
        <div className="flex flex-col gap-4 lg:my-auto">
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
                    <Link href={payHref(deposit)} className={buttonClasses({})}>
                      {COPY.payDeposit}
                    </Link>
                  </>
                ) : null}
              </div>
            </section>
          ) : (
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
          <JobRecord job={job} />
        </div>
      </div>
    </>
  );
}
