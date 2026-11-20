"use client";

import { Button, Form, Money, Skeleton, TextField } from "@forwend/ui-web";
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
  LINK_CHANGED_CODE,
  LINK_CLOSED_CODES,
  LINK_NOT_READY_CODE,
  LINK_STATES,
} from "@/features/links/constants/links";
import { amountLabel } from "@/features/links/lib/links";
import type { PublicLink } from "@/features/links/types/links";
import { Backdrop } from "@/features/pay/components/backdrop";
import { LoadFailed } from "@/features/pay/components/load-failed";
import { TestnetBadge } from "@/features/pay/components/testnet-badge";
import { LEFT_PAD, RIGHT_PAD } from "@/features/pay/constants/pay";
import { LINK_PAY_COPY as COPY } from "@/features/pay/constants/pay-copy";
import { checkLinkAmount, purchaseSearch, readPurchase } from "@/features/pay/lib/link-pay";
import type { LinkPurchase } from "@/features/pay/types/link-pay";
import { Payee } from "@/features/stores/components/payee";
import { apiError, errorStatus, HTTP_STATUS } from "@/shared/api/api-error";
import { usdCents, usdFromCents } from "@/shared/lib/money";

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
  if (link.data) return <Loaded key={link.data.slug} link={link.data} onClosed={link.refetch} />;
  if (errorStatus(link.error) === HTTP_STATUS.notFound) notFound();
  if (link.isError) return <LoadFailed onRetry={link.refetch} />;
  return (
    <div aria-busy="true" className={`flex flex-col gap-4 lg:col-span-2 lg:pt-8 ${LEFT_PAD}`}>
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
  const [purchase, setPurchase] = useState(() => readPurchase(window.location.search));
  const [error, setError] = useState("");
  const [formError, setFormError] = useState("");
  const [busy, setBusy] = useState(false);
  const section = useRef<HTMLElement>(null);
  const [refused, setRefused] = useState(false);
  const reason = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (refused && link.state !== LINK_STATES.on) reason.current?.focus();
  }, [refused, link.state]);
  const fixed = link.amountUsd !== null;
  const limits = amountLabel(link);
  const hint = COPY.amountHint(link.minUsd, link.maxUsd);

  // In the URL from the moment Pay is pressed, so a reload or retry reuses its idempotency key.
  const savePurchase = (next: LinkPurchase | null) => {
    const url = new URL(window.location.href);
    url.search = purchaseSearch(url.search, next);
    window.history.replaceState(window.history.state, "", url);
  };

  const keepPurchase = (next: LinkPurchase | null) => {
    savePurchase(next);
    flushSync(() => {
      setPurchase(next);
      setRefused(false);
      setFormError("");
    });
    const target = next
      ? section.current?.querySelector<HTMLElement>("#link-amount")
      : (reason.current ??
        section.current?.querySelector<HTMLElement>(
          'input[name="amountUsd"], #link-amount:not(.sr-only)',
        ));
    target?.focus();
  };

  const startPurchase = async (request: LinkPurchase) => {
    flushSync(() => {
      setBusy(true);
      setFormError("");
    });
    if (purchase) section.current?.querySelector<HTMLElement>("#link-amount")?.focus();
    try {
      const { payToken } = await pay({
        slug: link.slug,
        amountUsd: request.amountUsd,
        idempotencyKey: request.idempotencyKey,
        expectedAmountUsd: usdFromCents(BigInt(request.cents)),
        expectedVersion: request.offerVersion ?? undefined,
      }).unwrap();
      // The checkout shares this page's store: read its invoice first, so it opens whole.
      router.prefetch(`/pay/${payToken}`);
      await readInvoice(payToken);
      router.push(`/pay/${payToken}`);
    } catch (err) {
      const code = apiError(err).code ?? "";
      if (LINK_CLOSED_CODES.includes(code)) {
        keepPurchase(null);
        setRefused(true);
        onClosed();
      } else if (code === LINK_NOT_READY_CODE) {
        keepPurchase(null);
        setFormError(COPY.errors.notReady);
      } else {
        // A failed Pay from the form offers this purchase again, with the same key.
        if (!purchase) keepPurchase(request);
        if (code === LINK_CHANGED_CODE) {
          setFormError(COPY.errors.changed);
          onClosed();
        } else
          setFormError(
            errorStatus(err) === HTTP_STATUS.tooManyRequests
              ? COPY.errors.busy
              : COPY.errors.failed,
          );
      }
      setBusy(false);
    }
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const typed = fixed ? null : String(new FormData(form).get("amountUsd") ?? "").trim();
    const { cents, error: shown } = checkLinkAmount(link, typed);
    flushSync(() => {
      setError(shown);
      setFormError("");
    });
    if (shown) {
      form.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
      return;
    }
    const next = {
      idempotencyKey: `${crypto.randomUUID()}:${cents}`,
      amountUsd: typed,
      cents: cents.toString(),
      offerVersion: link.version ?? null,
    };
    savePurchase(next);
    await startPurchase(next);
  };

  const amountSummary = fixed ? (
    <div className="flex flex-col gap-1.5">
      <h2 id="link-amount" tabIndex={-1} className="text-sm text-muted outline-none">
        {COPY.amount}
      </h2>
      <Money
        baseUnits={usdCents(link.amountUsd ?? "0")}
        decimals={2}
        token="USD"
        className="min-w-0 text-amount-lg text-ink"
      />
    </div>
  ) : (
    <div className="flex flex-col gap-1.5">
      <p className="text-sm text-muted">{COPY.amount}</p>
      <p className="text-2xl font-medium tracking-tight text-ink tabular-nums">{limits}</p>
    </div>
  );

  return (
    <section
      ref={section}
      aria-labelledby="link-amount"
      className="flex flex-col gap-8 lg:col-span-2 lg:grid lg:grid-cols-subgrid lg:gap-0 lg:self-stretch"
    >
      <Backdrop color={link.brand?.color} />
      <div className={`flex min-w-0 flex-col gap-6 lg:pt-8 ${LEFT_PAD}`}>
        <div className="flex items-center justify-between gap-3">
          <Payee name={link.payee ?? link.title} subtitle={COPY.title} brand={link.brand} />
          {link.livemode ? null : <TestnetBadge />}
        </div>
        {link.payee ? (
          <p className="text-base font-medium break-words text-ink">{link.title}</p>
        ) : null}
        {!purchase && link.state === LINK_STATES.on ? amountSummary : null}
      </div>
      <div className={`flex min-w-0 flex-col lg:self-stretch lg:py-8 lg:pl-16 ${RIGHT_PAD}`}>
        <div className="fw-panel flex flex-col gap-4 p-4 sm:p-5 lg:my-auto">
          {purchase ? (
            <div className="flex flex-col gap-4">
              <h2 id="link-amount" tabIndex={-1} className="text-sm text-muted outline-none">
                {COPY.previous}
              </h2>
              <Money
                baseUnits={BigInt(purchase.cents)}
                decimals={2}
                token="USD"
                className="text-amount-lg text-ink"
              />
              <p className="text-sm text-muted">{COPY.purchaseHelp}</p>
              <div className="flex flex-col gap-2 sm:flex-row sm:gap-3">
                <Button size="lg" loading={busy} onClick={() => void startPurchase(purchase)}>
                  {COPY.continue}
                </Button>
                <Button
                  size="lg"
                  variant="secondary"
                  disabled={busy}
                  onClick={() => keepPurchase(null)}
                >
                  {COPY.another}
                </Button>
              </div>
              <p role="alert" className="min-h-5 text-sm text-danger">
                {formError}
              </p>
            </div>
          ) : link.state === LINK_STATES.on ? (
            <Form onSubmit={submit} noValidate gap="md">
              <div className="flex flex-col gap-1">
                <p className="text-sm font-medium text-ink">{COPY.payPanel}</p>
                <p className="text-sm text-muted">{COPY.next}</p>
              </div>
              {fixed ? null : (
                <>
                  <h2 id="link-amount" className="sr-only">
                    {COPY.amount}
                  </h2>
                  <TextField
                    label={COPY.amountField}
                    name="amountUsd"
                    inputMode="decimal"
                    autoComplete="off"
                    hint={hint}
                    error={error}
                  />
                </>
              )}
              <Button type="submit" size="lg" loading={busy} className="w-full">
                {COPY.pay}
              </Button>
              <p role="alert" className="text-sm text-danger empty:hidden">
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
        </div>
      </div>
    </section>
  );
}
