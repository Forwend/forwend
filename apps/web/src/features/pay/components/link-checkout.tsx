"use client";

import { Button, EmptyState, Form, Money, Skeleton, TextField } from "@forwend/ui-web";
import { WifiOff } from "lucide-react";
import { notFound, useRouter } from "next/navigation";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { useLazyGetInvoiceQuery } from "@/features/invoices/api/invoices-api";
import {
  useCountLinkVisitMutation,
  useGetPublicLinkQuery,
  usePayLinkMutation,
} from "@/features/links/api/links-api";
import {
  LINK_CLOSED_CODES,
  LINK_NOT_READY_CODE,
  LINK_STATES,
  USD_PATTERN,
} from "@/features/links/constants/links";
import { amountLabel } from "@/features/links/lib/links";
import type { PublicLink } from "@/features/links/types/links";
import { Payee } from "@/features/pay/components/payee";
import { PAY_STATES } from "@/features/pay/constants/pay";
import { LINK_PAY_COPY as COPY, PAY_COPY } from "@/features/pay/constants/pay-copy";
import { savedInvoice, saveInvoice, usdCents } from "@/features/pay/lib/link-pay";
import { payState } from "@/features/pay/lib/pay";

const NOT_FOUND = 404;
const TOO_MANY = 429;

/** R-142: a payment link's page. Opening it counts a visit and makes nothing (D-54); Pay makes the payer's invoice. */
export function LinkCheckout({ slug }: { slug: string }) {
  const link = useGetPublicLinkQuery(slug);
  const [countVisit] = useCountLinkVisitMutation();
  // One visit per load; the ref holds across React's dev double mount.
  const counted = useRef(false);
  useEffect(() => {
    if (counted.current) return;
    counted.current = true;
    countVisit(slug);
  }, [countVisit, slug]);
  const failure = link.error as { status?: unknown } | undefined;
  if (link.data) return <Loaded link={link.data} onClosed={link.refetch} />;
  if (failure?.status === NOT_FOUND) notFound();
  if (link.isError) {
    return (
      <div role="alert" data-load-error className="mx-auto w-full max-w-lg">
        <EmptyState
          icon={WifiOff}
          title={PAY_COPY.failedTitle}
          description={PAY_COPY.failed}
          action={
            <Button variant="secondary" onClick={link.refetch}>
              {PAY_COPY.retry}
            </Button>
          }
        />
      </div>
    );
  }
  return (
    <div aria-busy="true" className="flex flex-col gap-4">
      <span role="status" className="sr-only">
        {COPY.loading}
      </span>
      <Skeleton className="h-11 w-2/3" />
      <Skeleton className="h-24" />
    </div>
  );
}

function Loaded({ link, onClosed }: { link: PublicLink; onClosed: () => void }) {
  const router = useRouter();
  const [pay] = usePayLinkMutation();
  const [readInvoice] = useLazyGetInvoiceQuery();
  // One key per page load and amount: a retried Pay gets its invoice back, another amount makes another invoice.
  const attempt = useRef(crypto.randomUUID());
  const [error, setError] = useState("");
  const [formError, setFormError] = useState("");
  const [busy, setBusy] = useState(false);
  // A Pay refused because the link closed meanwhile: the reason takes the focus Pay had.
  const [refused, setRefused] = useState(false);
  const reason = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (refused && link.state !== LINK_STATES.on) reason.current?.focus();
  }, [refused, link.state]);
  const fixed = link.amountUsd !== null;
  const limits = amountLabel(link);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const typed = fixed ? null : String(new FormData(form).get("amountUsd") ?? "").trim();
    const amount = link.amountUsd ?? typed ?? "";
    const cents = USD_PATTERN.test(amount) ? usdCents(amount) : 0n;
    const shown =
      cents === 0n
        ? COPY.errors.amount
        : (link.minUsd && cents < usdCents(link.minUsd)) ||
            (link.maxUsd && cents > usdCents(link.maxUsd))
          ? COPY.errors.limits(limits)
          : "";
    flushSync(() => {
      setError(shown);
      setFormError("");
    });
    if (shown) {
      form.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
      return;
    }
    setBusy(true);
    try {
      // The same browser goes back to its invoice for this amount while that one can still be paid.
      const saved = savedInvoice(link.slug, cents);
      if (saved) {
        const read = await readInvoice(saved);
        // A failed read is no answer: another invoice now could have the payer pay twice.
        if (read.error && (read.error as { status?: unknown }).status !== NOT_FOUND)
          throw read.error;
        const state = read.data ? payState(read.data, Date.now()) : null;
        if (
          state &&
          !state.closed &&
          state.state !== PAY_STATES.paid &&
          state.state !== PAY_STATES.settled
        ) {
          router.push(`/pay/${saved}`);
          return;
        }
      }
      const { payToken } = await pay({
        slug: link.slug,
        amountUsd: typed,
        idempotencyKey: `${attempt.current}:${cents}`,
      }).unwrap();
      saveInvoice(link.slug, cents, payToken);
      router.push(`/pay/${payToken}`);
    } catch (err) {
      const failure = err as { status?: unknown; data?: { error?: { code?: string } } };
      const code = failure.data?.error?.code ?? "";
      if (LINK_CLOSED_CODES.includes(code)) {
        setRefused(true);
        onClosed();
      } else if (code === LINK_NOT_READY_CODE) setFormError(COPY.errors.notReady);
      else if (failure.status === TOO_MANY) setFormError(COPY.errors.busy);
      else setFormError(COPY.errors.failed);
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="link-amount" className="flex flex-col gap-6">
      <Payee name={link.payee ?? link.title} subtitle={COPY.title} brand={link.brand} />
      {link.payee ? <p className="text-base break-words text-ink">{link.title}</p> : null}
      {link.state === LINK_STATES.on ? (
        <Form onSubmit={submit} noValidate>
          {fixed ? (
            <div className="flex flex-col gap-1.5">
              <h2 id="link-amount" className="text-sm text-muted">
                {COPY.amount}
              </h2>
              <Money
                baseUnits={usdCents(link.amountUsd ?? "0")}
                decimals={2}
                token="USD"
                className="min-w-0 text-amount-lg text-ink"
              />
              <p className="text-sm text-muted">{COPY.fixedHint}</p>
            </div>
          ) : (
            <>
              <h2 id="link-amount" className="sr-only">
                {COPY.amount}
              </h2>
              <TextField
                label={COPY.amountField}
                name="amountUsd"
                inputMode="decimal"
                autoComplete="off"
                hint={COPY.amountHint(limits)}
                error={error}
              />
            </>
          )}
          <div className="flex flex-col gap-2">
            <Button type="submit" loading={busy} className="w-full sm:w-auto">
              {COPY.pay}
            </Button>
            <p className="text-sm text-muted">{COPY.next}</p>
          </div>
          <p role="alert" className="min-h-5 text-sm text-danger">
            {formError || (fixed ? error : "")}
          </p>
        </Form>
      ) : (
        <>
          <h2 id="link-amount" className="sr-only">
            {COPY.amount}
          </h2>
          <p
            ref={reason}
            tabIndex={-1}
            role="status"
            className="rounded-md bg-surface-2 px-4 py-3 text-sm text-ink outline-none"
          >
            {COPY.closed[link.state]}
          </p>
        </>
      )}
    </section>
  );
}
