"use client";

import { Button, EmptyState, Form, Money, Skeleton, TextField } from "@forwend/ui-web";
import { WifiOff } from "lucide-react";
import { notFound, useRouter } from "next/navigation";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
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
  USD_PATTERN,
} from "@/features/links/constants/links";
import { amountLabel } from "@/features/links/lib/links";
import type { PublicLink } from "@/features/links/types/links";
import { Payee } from "@/features/pay/components/payee";
import { LINK_PAY_COPY as COPY, PAY_COPY } from "@/features/pay/constants/pay-copy";
import { purchaseSearch, readPurchase, usdCents, usdFromCents } from "@/features/pay/lib/link-pay";
import type { LinkPurchase } from "@/features/pay/types/link-pay";

const NOT_FOUND = 404;
const TOO_MANY = 429;

/** R-142: a payment link's page. Opening it counts a visit and makes nothing (D-54); Pay creates checkout. */
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
  if (link.data) return <Loaded key={link.data.slug} link={link.data} onClosed={link.refetch} />;
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
  const [purchase, setPurchase] = useState(() => readPurchase(window.location.search));
  const [error, setError] = useState("");
  const [formError, setFormError] = useState("");
  const [busy, setBusy] = useState(false);
  const section = useRef<HTMLElement>(null);
  // A Pay refused because the link closed meanwhile: the reason takes the focus Pay had.
  const [refused, setRefused] = useState(false);
  const reason = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (refused && link.state !== LINK_STATES.on) reason.current?.focus();
  }, [refused, link.state]);
  const fixed = link.amountUsd !== null;
  const limits = amountLabel(link);

  const keepPurchase = (next: LinkPurchase | null) => {
    const url = new URL(window.location.href);
    url.search = purchaseSearch(url.search, next);
    window.history.replaceState(window.history.state, "", url);
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
    section.current?.querySelector<HTMLElement>("#link-amount")?.focus();
    try {
      const { payToken } = await pay({
        slug: link.slug,
        amountUsd: request.amountUsd,
        idempotencyKey: request.idempotencyKey,
        expectedAmountUsd: usdFromCents(BigInt(request.cents)),
        expectedVersion: request.offerVersion ?? undefined,
      }).unwrap();
      router.push(`/pay/${payToken}`);
    } catch (err) {
      const failure = err as { status?: unknown; data?: { error?: { code?: string } } };
      const code = failure.data?.error?.code ?? "";
      if (LINK_CLOSED_CODES.includes(code)) {
        keepPurchase(null);
        setRefused(true);
        onClosed();
      } else if (code === LINK_CHANGED_CODE) {
        setFormError(COPY.errors.changed);
        onClosed();
      } else if (code === LINK_NOT_READY_CODE) {
        keepPurchase(null);
        setFormError(COPY.errors.notReady);
      } else if (failure.status === TOO_MANY) setFormError(COPY.errors.busy);
      else setFormError(COPY.errors.failed);
      setBusy(false);
    }
  };

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
    const next = {
      idempotencyKey: `${crypto.randomUUID()}:${cents}`,
      amountUsd: typed,
      cents: cents.toString(),
      offerVersion: link.version ?? null,
    };
    keepPurchase(next);
    await startPurchase(next);
  };

  return (
    <section ref={section} aria-labelledby="link-amount" className="flex flex-col gap-6">
      <Payee name={link.payee ?? link.title} subtitle={COPY.title} brand={link.brand} />
      {link.livemode ? null : (
        <p className="rounded-md bg-warning-soft px-4 py-3 text-sm text-warning">{COPY.testMode}</p>
      )}
      {link.payee && !purchase ? (
        <p className="text-base break-words text-ink">{link.title}</p>
      ) : null}
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
          <div className="flex flex-wrap gap-3">
            <Button loading={busy} onClick={() => void startPurchase(purchase)}>
              {COPY.continue}
            </Button>
            <Button variant="secondary" disabled={busy} onClick={() => keepPurchase(null)}>
              {COPY.another}
            </Button>
          </div>
          <p role="alert" className="min-h-5 text-sm text-danger">
            {formError}
          </p>
        </div>
      ) : link.state === LINK_STATES.on ? (
        <Form onSubmit={submit} noValidate>
          {fixed ? (
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
