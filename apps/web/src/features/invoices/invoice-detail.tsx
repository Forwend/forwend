"use client";

import { Button, COPY_STATUS, formatTokenAmount, Skeleton, useCopy } from "@forwend/ui-web";
import { skipToken } from "@reduxjs/toolkit/query";
import { Check, ChevronLeft, Copy } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { InvoiceAmount } from "@/features/invoices/invoice-amount";
import { InvoiceDeposits } from "@/features/invoices/invoice-deposits";
import { ConfirmingStatus, InvoiceTimeline } from "@/features/invoices/invoice-progress";
import {
  exactDigits,
  formatDueDate,
  INVOICE_STEPS,
  type Invoice,
  type InvoiceSummary,
  type InvoiceToken,
  invoiceNumber,
  invoiceProgress,
  tokenKey,
} from "@/features/invoices/invoices";
import { useGetInvoiceQuery, useGetProfileInvoiceQuery } from "@/features/invoices/invoices-api";
import { INVOICE_COPY as COPY } from "@/features/invoices/invoices-copy";
import { ExplorerLink } from "@/shared/chains/explorer-link";
import { TokenMark } from "@/shared/chains/token-mark";
import { LIVE_QUERY } from "@/shared/config/refresh";
import { APP_ROUTES } from "@/shared/config/routes";

const NOT_FOUND = 404;
const TIME = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
const COUNTRY = new Intl.DisplayNames(undefined, { type: "region" });
const PANEL = "rounded-md border border-line bg-surface";
const PANEL_TITLE = "border-b border-line px-4 py-3 text-base font-semibold text-ink sm:px-5";

// The public read gives the terms, statuses and deposits and is read again every REFRESH_MS; the profile's own list
// gives the client once, and also tells whether this profile made the invoice. On desktop the header's breadcrumb leads
// back; phones have no breadcrumb, so they get a back link.
export function InvoiceDetail({
  invoiceId,
  profileId,
  tokens,
}: {
  invoiceId: string;
  profileId: string;
  tokens: readonly InvoiceToken[] | null;
}) {
  const invoice = useGetInvoiceQuery(invoiceId, LIVE_QUERY);
  const number = invoice.data?.number;
  const owned = useGetProfileInvoiceQuery(number ? { profileId, number } : skipToken);
  const mine = owned.data?.invoiceId === invoiceId ? owned.data : null;
  const failure = invoice.error as { status?: unknown } | undefined;

  return (
    <div className="flex flex-col gap-6">
      <Link
        href={APP_ROUTES.invoices}
        className="-ml-1 inline-flex items-center gap-1 self-start rounded-sm px-1 text-sm text-muted hover:text-ink lg:hidden"
      >
        <ChevronLeft aria-hidden className="size-[var(--fw-icon-sm)]" />
        {COPY.back}
      </Link>
      {invoice.data ? (
        owned.isSuccess && !mine ? (
          <p className="text-muted">{COPY.otherProfile}</p>
        ) : (
          <Loaded invoice={invoice.data} mine={mine} clientFailed={owned.isError} tokens={tokens} />
        )
      ) : failure?.status === NOT_FOUND ? (
        <p className="text-muted">{COPY.notFound}</p>
      ) : invoice.isError ? (
        <div role="alert" className="flex flex-wrap items-center gap-4 text-sm text-muted">
          {COPY.failed}
          <Button size="sm" variant="secondary" onClick={invoice.refetch}>
            {COPY.retry}
          </Button>
        </div>
      ) : (
        <Skeleton className="h-64" />
      )}
    </div>
  );
}

function Loaded({
  invoice,
  mine,
  clientFailed,
  tokens,
}: {
  invoice: Invoice;
  mine: InvoiceSummary | null;
  clientFailed: boolean;
  tokens: readonly InvoiceToken[] | null;
}) {
  const { current, blocksLeft, secondsLeft } = invoiceProgress(invoice);
  const token = tokens?.find((t) => tokenKey(t) === tokenKey(invoice));
  const amount = BigInt(invoice.amount);
  const client = mine?.client;
  const issuer = invoice.issuer;

  return (
    <>
      {/* The number is the breadcrumb's last step on desktop, so the heading shows only on phones. */}
      <div className="flex flex-col gap-1 lg:contents">
        <h1 className="text-2xl font-semibold tracking-tight text-ink lg:sr-only">
          {invoiceNumber(invoice.number)}
        </h1>
        {invoice.title ? (
          <p className="break-words text-muted lg:text-lg lg:font-medium lg:text-ink">
            {invoice.title}
          </p>
        ) : null}
      </div>

      <section aria-labelledby="invoice-amount" className={PANEL}>
        <div className="flex flex-col gap-3 border-b border-line px-4 py-4 sm:px-5">
          <h2 id="invoice-amount" className="text-sm text-muted">
            {COPY.amount}
          </h2>
          <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
            {token ? (
              <p className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-ink">
                <span className="text-3xl font-semibold tracking-tight break-all sm:text-4xl">
                  {formatTokenAmount({
                    baseUnits: amount,
                    decimals: token.decimals,
                    fractionDigits: exactDigits(amount, token.decimals),
                  })}
                </span>{" "}
                <span className="text-lg font-medium text-muted">{token.symbol}</span>
              </p>
            ) : (
              <p className="min-w-0 text-ink">
                <InvoiceAmount invoice={invoice} tokens={tokens} />
              </p>
            )}
            {token ? <TokenMark chainId={invoice.chainId} symbol={token.symbol} /> : null}
          </div>
        </div>
        <div className="flex flex-col gap-3 px-4 py-5 sm:px-5">
          {/* No details under the steps: a phone leaves each column too little room for them. */}
          <InvoiceTimeline invoice={invoice} label={COPY.progress} />
          <p role="status" className="text-sm text-ink empty:sr-only">
            {current === INVOICE_STEPS.confirming ? (
              <ConfirmingStatus blocks={blocksLeft} seconds={secondsLeft} />
            ) : null}
          </p>
          <InvoiceDeposits invoice={invoice} token={token ?? null} />
        </div>
      </section>

      <ShareLink invoiceId={invoice.invoiceId} />

      <div className="grid items-start gap-4 lg:grid-cols-3">
        <section aria-labelledby="invoice-details" className={PANEL}>
          <h2 id="invoice-details" className={PANEL_TITLE}>
            {COPY.details}
          </h2>
          <dl className="divide-y divide-line">
            <Row term={COPY.dueDate}>
              {invoice.dueDate ? formatDueDate(invoice.dueDate) : COPY.none}
            </Row>
            <Row term={COPY.expires}>{TIME.format(new Date(invoice.expiresAt))}</Row>
            <Row term={COPY.created}>{TIME.format(new Date(invoice.createdAt))}</Row>
            {invoice.settlementTxHash ? (
              <Row term={COPY.settlement}>
                <span className="font-mono break-all">{invoice.settlementTxHash}</span>{" "}
                <ExplorerLink
                  chainId={invoice.chainId}
                  txHash={invoice.settlementTxHash}
                  className="align-middle"
                />
              </Row>
            ) : null}
            <Row term={COPY.note}>{invoice.note ?? COPY.none}</Row>
          </dl>
        </section>

        <section aria-labelledby="invoice-client" className={PANEL}>
          <h2 id="invoice-client" className={PANEL_TITLE}>
            {COPY.client}
          </h2>
          {clientFailed ? (
            <p className="px-4 py-3 text-sm text-muted sm:px-5">{COPY.clientFailed}</p>
          ) : !mine ? (
            <Skeleton className="m-5 h-16" />
          ) : client?.name || client?.email || client?.address ? (
            <Party lines={[client.name, client.email, client.address]} />
          ) : (
            <p className="px-4 py-3 text-sm text-muted sm:px-5">{COPY.noClient}</p>
          )}
        </section>

        <section aria-labelledby="invoice-issuer" className={PANEL}>
          <h2 id="invoice-issuer" className={PANEL_TITLE}>
            {COPY.issuer}
          </h2>
          {issuer ? (
            <Party
              lines={[
                issuer.name,
                issuer.email,
                issuer.address,
                COUNTRY.of(issuer.country) ?? issuer.country,
                issuer.taxId ? `${COPY.taxId} ${issuer.taxId}` : null,
              ]}
            />
          ) : (
            <p className="px-4 py-3 text-sm text-muted sm:px-5">{COPY.noIssuer}</p>
          )}
        </section>
      </div>
    </>
  );
}

function Row({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="px-4 py-3 sm:px-5">
      <dt className="text-xs text-muted">{term}</dt>
      <dd className="mt-0.5 text-sm break-words whitespace-pre-line text-ink">{children}</dd>
    </div>
  );
}

function Party({ lines }: { lines: (string | null)[] }) {
  const [first, ...rest] = lines.filter(Boolean);
  return (
    <div className="px-4 py-3 text-sm break-words whitespace-pre-line sm:px-5">
      <p className="font-medium text-ink">{first}</p>
      {rest.map((line) => (
        <p key={line} className="mt-0.5 text-muted">
          {line}
        </p>
      ))}
    </div>
  );
}

function ShareLink({ invoiceId }: { invoiceId: string }) {
  // The app renders only in the browser, after sign-in.
  const link = `${window.location.origin}/pay/${invoiceId}`;
  const [status, copy] = useCopy(link);
  const label =
    status === COPY_STATUS.copied
      ? COPY.copied
      : status === COPY_STATUS.failed
        ? COPY.copyFailed
        : COPY.copy;
  return (
    <section aria-labelledby="invoice-share" className={`${PANEL} flex flex-col gap-3 p-4 sm:p-5`}>
      <div>
        <h2 id="invoice-share" className="text-base font-semibold text-ink">
          {COPY.share}
        </h2>
        <p className="mt-0.5 text-sm text-muted">{COPY.shareHint}</p>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <p className="min-w-0 flex-1 rounded-md border border-line bg-surface-2 px-3 py-2 font-mono text-sm break-all text-ink select-all">
          {link}
        </p>
        <Button variant="secondary" onClick={copy} className="shrink-0">
          {status === COPY_STATUS.copied ? (
            <Check aria-hidden className="size-[var(--fw-icon-sm)]" />
          ) : (
            <Copy aria-hidden className="size-[var(--fw-icon-sm)]" />
          )}
          {label}
        </Button>
      </div>
      <p role="status" className="sr-only">
        {status === COPY_STATUS.idle ? "" : label}
      </p>
    </section>
  );
}
