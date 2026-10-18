"use client";

import {
  Button,
  buttonClasses,
  Form,
  PAYMENT_STATUS,
  Skeleton,
  StatusPill,
  TextField,
} from "@forwend/ui-web";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { formatUsd } from "@/features/balances/lib/balances";
import { invoiceNumber } from "@/features/invoices/lib/invoices";
import { useAcceptJobMutation, useGetPublicJobQuery } from "@/features/jobs/api/jobs-api";
import { ACCEPT_FIELDS, EMAIL_PATTERN } from "@/features/jobs/constants/jobs";
import { QUOTE_COPY as COPY } from "@/features/jobs/constants/jobs-copy";
import { apiCents, namedField } from "@/features/jobs/lib/jobs";
import type { JobPayment, JobPaymentStatus } from "@/features/jobs/types/jobs";
import { Party } from "@/shared/components/party";
import { MONEY_COPY } from "@/shared/constants/money-copy";

const TIME = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
const COUNTRY = new Intl.DisplayNames(undefined, { type: "region" });
const PANEL = "fw-panel";
const PANEL_TITLE = "fw-panel-head text-base font-semibold text-ink";
const NOT_FOUND = 404;
const INVALID_VALUE = 422;
const TOO_MANY = 429;
const usd = (amountUsd: string) => `${formatUsd(apiCents(amountUsd))} ${MONEY_COPY.usd}`;
const payHref = (p: JobPayment) => `/pay/${p.invoiceId}`;
// A made payment the client can still pay: its pay page takes money.
const payable = (p: JobPayment) => p.invoiceId !== null && p.status === PAYMENT_STATUS.open;

type AcceptField = keyof typeof ACCEPT_FIELDS;

// The client's quote (R-102): who sends it, the work and the payments, then Accept with a typed name and email. Once
// accepted the form gives way to who accepted and when, and focus moves there; the deposit's pay link is the main
// action. A made payment links its pay page while it takes money.
export function JobQuote({ token }: { token: string }) {
  const query = useGetPublicJobQuery(token);
  const [accept, accepted] = useAcceptJobMutation();
  const [errors, setErrors] = useState<Partial<Record<AcceptField, string>>>({});
  const [formError, setFormError] = useState("");
  const heading = useRef<HTMLHeadingElement>(null);
  const [justAccepted, setJustAccepted] = useState(false);
  const job = accepted.data ?? query.currentData;
  const status = (query.error as { status?: unknown } | undefined)?.status;
  useEffect(() => {
    if (justAccepted) heading.current?.focus();
  }, [justAccepted]);

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

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const name = String(data.get("name") ?? "").trim();
    const email = String(data.get("email") ?? "").trim();
    const shown: Partial<Record<AcceptField, string>> = {};
    if (!name) shown.name = COPY.errors.required;
    if (!EMAIL_PATTERN.test(email)) shown.email = COPY.errors.email;
    flushSync(() => {
      setErrors(shown);
      setFormError("");
    });
    if (Object.keys(shown).length > 0) {
      form.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
      return;
    }
    try {
      await accept({ token, name, email }).unwrap();
      setJustAccepted(true);
    } catch (error) {
      const failure = error as { status?: unknown; data?: { error?: { message?: string } } };
      const field = namedField(failure.data?.error?.message ?? "", Object.values(ACCEPT_FIELDS));
      if (failure.status === INVALID_VALUE && field) {
        flushSync(() => setErrors({ [field]: COPY.errors.invalid[field] }));
        form.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
      } else
        setFormError(
          failure.status === NOT_FOUND
            ? COPY.notFound
            : failure.status === TOO_MANY
              ? COPY.errors.tooMany
              : COPY.errors.failed,
        );
    }
  };

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
          <Form onSubmit={submit} className="px-4 py-4 sm:px-5">
            <p className="text-sm text-muted">{COPY.accept.text}</p>
            <div className="grid gap-5 sm:grid-cols-2">
              <TextField
                label={COPY.accept.name}
                name="name"
                autoComplete="name"
                maxLength={200}
                error={errors.name}
              />
              <TextField
                type="email"
                label={COPY.accept.email}
                name="email"
                autoComplete="email"
                maxLength={254}
                error={errors.email}
              />
            </div>
            <Button type="submit" loading={accepted.isLoading} className="self-start">
              {COPY.accept.action}
            </Button>
            <p role="alert" className="min-h-5 text-sm text-danger">
              {formError}
            </p>
          </Form>
        </section>
      )}
    </div>
  );
}
