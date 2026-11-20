"use client";

import { buttonClasses } from "@forwend/ui-web";
import { FileDown } from "lucide-react";
import Link from "next/link";
import { type ReactNode, type Ref, useEffect, useRef } from "react";
import { ICON, ORDER } from "@/features/invoices/constants/invoice-detail";
import { INVOICE_PDFS } from "@/features/invoices/constants/invoices";
import { INVOICE_COPY as COPY } from "@/features/invoices/constants/invoices-copy";
import { formatAgreed, invoiceNumber, invoicePdfUrl } from "@/features/invoices/lib/invoices";
import type { Invoice, InvoicePdf, Revision } from "@/features/invoices/types/invoices";
import { RecordLink } from "@/shared/components/record-link";
import { APP_ROUTES } from "@/shared/config/routes";
import { CROSS_CHAIN_STATUSES } from "@/shared/constants/chains";
import { PANEL_TITLE } from "@/shared/constants/panel";
import { API_PAYMENT_STATUSES } from "@/shared/constants/payment-state";
import { blockchainName, crossChainOptionRecorded } from "@/shared/lib/chains";
import { countryName } from "@/shared/lib/countries";
import { dateTime, formatDueDate } from "@/shared/lib/dates";
import { amountText } from "@/shared/lib/money";

const LINK = "text-ink underline decoration-line-strong underline-offset-4 hover:decoration-ink";

export interface InvoiceDetailsPanelProps {
  invoice: Invoice;
  receipt: string | null;
  canceling: boolean;
  reopening: boolean;
}

export function InvoiceDetailsPanel({
  invoice,
  receipt,
  canceling,
  reopening,
}: InvoiceDetailsPanelProps) {
  const closed = Date.parse(invoice.closesAt) <= Date.now();
  const issuer = invoice.issuer;
  const crossChain = invoice.crossChain;
  // Cancel and Reopen take away the focused control: focus waits for the row that shows the change.
  const canceledRow = useRef<HTMLDivElement>(null);
  const canceled = invoice.paymentStatus === API_PAYMENT_STATUSES.canceled;
  useEffect(() => {
    if (canceling && canceled) canceledRow.current?.focus();
  }, [canceling, canceled]);
  const closesRow = useRef<HTMLDivElement>(null);
  const reopened = Date.parse(invoice.closesAt) > Date.parse(invoice.expiresAt);
  useEffect(() => {
    if (reopening && reopened) closesRow.current?.focus();
  }, [reopening, reopened]);

  return (
    <section aria-labelledby="invoice-details" className={`fw-panel ${ORDER.details}`}>
      <h2 id="invoice-details" className={PANEL_TITLE}>
        {COPY.details}
      </h2>
      <dl className="divide-y divide-line">
        {invoice.store ? (
          <Row term={COPY.store}>
            <RecordLink href={`${APP_ROUTES.stores}/${invoice.store.storeId}`}>
              {invoice.store.name}
            </RecordLink>
          </Row>
        ) : null}
        {invoice.linkId ? (
          <Row term={COPY.paymentLink}>
            <RecordLink href={`${APP_ROUTES.links}/${invoice.linkId}`}>{COPY.openLink}</RecordLink>
          </Row>
        ) : null}
        {invoice.reference ? <Row term={COPY.reference}>{invoice.reference}</Row> : null}
        {invoice.dueDate ? <Row term={COPY.dueDate}>{formatDueDate(invoice.dueDate)}</Row> : null}
        {/* Focusable only for the reopen that moves focus here. */}
        <Row term={closed ? COPY.closed : COPY.expires} ref={reopening ? closesRow : undefined}>
          {dateTime(invoice.closesAt)}
        </Row>
        <Row term={COPY.created}>{dateTime(invoice.createdAt)}</Row>
        {crossChain?.status === CROSS_CHAIN_STATUSES.success &&
        crossChainOptionRecorded(invoice) ? (
          <Row term={COPY.paidThrough}>
            {COPY.paidThroughValue(
              amountText(BigInt(crossChain.deposited ?? crossChain.amountIn), crossChain),
              blockchainName(crossChain.blockchain),
            )}
          </Row>
        ) : null}
        {invoice.supplyDate ? (
          <Row term={COPY.supplyDate}>{formatDueDate(invoice.supplyDate)}</Row>
        ) : null}
        {invoice.agreedValue ? (
          <Row term={COPY.agreedValue}>
            {COPY.agreedOn(
              formatAgreed(invoice.agreedValue),
              formatDueDate(invoice.agreedValue.date),
            )}
          </Row>
        ) : null}
        {invoice.canceledAt ? (
          <Row term={COPY.canceledOn} ref={canceledRow}>
            {dateTime(invoice.canceledAt)}
          </Row>
        ) : null}
        {invoice.replacedBy ? (
          <Row term={COPY.replacedBy}>
            <RevisionLink revision={invoice.replacedBy} />
          </Row>
        ) : null}
        {invoice.replaces ? (
          <Row term={COPY.replaces}>
            <RevisionLink revision={invoice.replaces} />
          </Row>
        ) : null}
        <Row term={COPY.issuer} stacked>
          {issuer ? (
            [
              issuer.name,
              issuer.email,
              issuer.address,
              countryName(issuer.country),
              issuer.taxId ? `${COPY.taxId} ${issuer.taxId}` : null,
            ]
              .filter(Boolean)
              .join("\n")
          ) : invoice.senderName ? (
            invoice.senderName
          ) : (
            <>
              {COPY.noIssuer}{" "}
              <Link href={APP_ROUTES.billingDetails} className={LINK}>
                {COPY.addBillingDetails}
              </Link>
            </>
          )}
        </Row>
        {invoice.note ? (
          <Row term={COPY.note} stacked>
            {invoice.note}
          </Row>
        ) : null}
        {invoice.memo ? (
          <Row term={COPY.memo} stacked>
            {invoice.memo}
          </Row>
        ) : null}
        <Row term={COPY.pdfs}>
          <span className="flex flex-wrap justify-end gap-x-5 gap-y-1">
            <PdfLink payToken={invoice.payToken} pdf={INVOICE_PDFS.invoice} />
            {receipt ? <PdfLink payToken={receipt} pdf={INVOICE_PDFS.receipt} /> : null}
          </span>
        </Row>
      </dl>
    </section>
  );
}

function Row({
  term,
  stacked = false,
  children,
  ref,
}: {
  term: string;
  stacked?: boolean;
  children: ReactNode;
  ref?: Ref<HTMLDivElement>;
}) {
  return stacked ? (
    <div className="px-4 py-3 sm:px-5">
      <dt className="text-sm text-muted">{term}</dt>
      <dd className="mt-1 text-sm break-words whitespace-pre-line text-ink">{children}</dd>
    </div>
  ) : (
    <div
      ref={ref}
      tabIndex={ref ? -1 : undefined}
      className="flex items-baseline justify-between gap-4 px-4 py-3 outline-none sm:px-5"
    >
      <dt className="shrink-0 text-sm text-muted">{term}</dt>
      <dd className="min-w-0 text-right text-sm break-words text-ink">{children}</dd>
    </div>
  );
}

// An invoice made before pay links has none, so its PDFs can't be fetched.
function PdfLink({ payToken, pdf }: { payToken: string | null; pdf: InvoicePdf }) {
  if (!payToken) return null;
  return (
    <a
      href={invoicePdfUrl(payToken, pdf)}
      className={`${buttonClasses({ variant: "link" })} gap-1.5 text-sm`}
    >
      <FileDown aria-hidden className={ICON} />
      {COPY.pdf[pdf]}
    </a>
  );
}

function RevisionLink({ revision }: { revision: Revision }) {
  return (
    <Link href={`${APP_ROUTES.invoices}/${revision.invoiceId}`} className={LINK}>
      {invoiceNumber(revision.number)}
    </Link>
  );
}
