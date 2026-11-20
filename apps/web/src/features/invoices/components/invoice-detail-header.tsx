"use client";

import {
  Badge,
  buttonClasses,
  cx,
  PAYMENT_STATUS,
  type PaymentStatus,
  StatusPill,
  TONES,
  WalletStateLabel,
} from "@forwend/ui-web";
import { ArrowLeftRight, FileDown, FilePlus2, FileText } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { InvoiceActions } from "@/features/invoices/components/invoice-actions";
import { InvoicePayLinkActions } from "@/features/invoices/components/invoice-pay-link";
import { ConfirmingStatus } from "@/features/invoices/components/invoice-progress";
import { ReopenInvoice } from "@/features/invoices/components/reopen-invoice";
import {
  HEADER,
  HEADER_MORE,
  HEADER_TITLE,
  ICON,
  PHONE_ACTION_BAR,
  TILE,
  TITLE,
} from "@/features/invoices/constants/invoice-detail";
import { INVOICE_EXCEPTIONS, INVOICE_PDFS } from "@/features/invoices/constants/invoices";
import { INVOICE_COPY as COPY } from "@/features/invoices/constants/invoices-copy";
import type { CheckStatusState } from "@/features/invoices/hooks/use-check-status";
import { invoiceCopyHref, invoicePdfUrl, invoiceProgress } from "@/features/invoices/lib/invoices";
import type { Invoice, InvoiceExceptionKind } from "@/features/invoices/types/invoices";
import { walletStateOf } from "@/shared/lib/payment-state";

export interface InvoiceDetailHeaderProps {
  back: ReactNode;
  profileId: string;
  invoice: Invoice;
  mine: Invoice | null; // Edit waits for it
  number: string;
  noun: string;
  status: PaymentStatus;
  request: boolean;
  payLink: string | null;
  beforePayment: boolean;
  restart: InvoiceExceptionKind | null; // null while money may still change
  recheck: CheckStatusState | null;
  receipt: string | null;
  paymentHref: string;
  onCanceled: () => void;
  onReopened: () => void;
}

/** The next step sits here from large screens, in a bottom bar on phones. */
export function InvoiceDetailHeader({
  back,
  profileId,
  invoice,
  mine,
  number,
  noun,
  status,
  request,
  payLink,
  beforePayment,
  restart,
  recheck,
  receipt,
  paymentHref,
  onCanceled,
  onReopened,
}: InvoiceDetailHeaderProps) {
  const client = mine?.client;
  const paidAt = invoice.paidAt;
  const reopen =
    restart === INVOICE_EXCEPTIONS.closedPartial ? (invoice.reopenUntil ?? null) : null;
  const { blocksLeft, blocksTotal, secondsLeft } = invoiceProgress(invoice);
  const receiptLink = (className: string) =>
    receipt ? (
      <a href={invoicePdfUrl(receipt, INVOICE_PDFS.receipt)} className={className}>
        <FileDown aria-hidden className={ICON} />
        {COPY.pdf.receipt}
      </a>
    ) : null;

  return (
    <header className={HEADER}>
      {back}
      <div className={`${HEADER_MORE} flex items-center gap-2`}>
        {payLink ? (
          <div className="flex items-center gap-2 max-lg:hidden">
            <InvoicePayLinkActions payToken={payLink} />
          </div>
        ) : paidAt ? (
          <div className="flex items-center gap-2 max-lg:hidden">
            <Link href={paymentHref} className={buttonClasses({ variant: "secondary" })}>
              <ArrowLeftRight aria-hidden className={ICON} />
              {COPY.viewPayment}
            </Link>
            {receiptLink(buttonClasses({ variant: "secondary" }))}
          </div>
        ) : null}
        {restart ? (
          <div className={cx(PHONE_ACTION_BAR, "lg:flex lg:items-center lg:gap-2")}>
            {reopen ? (
              <ReopenInvoice
                profileId={profileId}
                invoiceId={invoice.invoiceId}
                number={number}
                noun={noun}
                until={reopen}
                onReopened={onReopened}
                className="max-lg:h-11 max-lg:flex-1"
              />
            ) : null}
            <Link
              href={invoiceCopyHref(invoice.invoiceId, false)}
              className={cx(
                buttonClasses({ variant: reopen ? "secondary" : "primary" }),
                "max-lg:h-11 max-lg:flex-1",
              )}
            >
              <FilePlus2 aria-hidden className={ICON} />
              {request ? COPY.newRequest : COPY.newInvoice}
            </Link>
          </div>
        ) : null}
        {paidAt ? (
          <div className={`${PHONE_ACTION_BAR} lg:hidden`}>
            <Link
              href={paymentHref}
              className={cx(buttonClasses({ variant: "secondary" }), "h-11 flex-1")}
            >
              {COPY.viewPayment}
            </Link>
            {receiptLink(cx(buttonClasses({ variant: "secondary" }), "h-11 flex-1"))}
          </div>
        ) : null}
        <InvoiceActions
          profileId={profileId}
          invoiceId={invoice.invoiceId}
          number={number}
          noun={noun}
          recheck={recheck}
          cancelable={beforePayment}
          onCanceled={onCanceled}
          editable={
            mine
              ? {
                  memo: invoice.memo ?? null,
                  clientEmail: client?.email ?? null,
                  returnUrl: invoice.returnUrl,
                  reference: invoice.reference,
                  note: invoice.note,
                  dueDate: invoice.dueDate,
                  beforePayment,
                  closesOn: invoice.expiresAt.slice(0, 10),
                  today: new Date().toISOString().slice(0, 10),
                  request,
                }
              : null
          }
        />
      </div>
      <div className={HEADER_TITLE}>
        <span className={TILE}>
          <FileText aria-hidden />
        </span>
        <div className="min-w-0">
          <PhoneLabel parts={client?.name ? [number, invoice.title] : [invoice.title]} />
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <h1 className={TITLE}>
              {client?.name ? (
                <>
                  <span className="max-lg:hidden">{number}</span>
                  <span className="lg:hidden">{client.name}</span>
                </>
              ) : (
                number
              )}
            </h1>
            <span className="flex flex-wrap items-center gap-2">
              {/* Testnet money must never pass for real money. */}
              {invoice.livemode ? null : <Badge tone={TONES.warning}>{COPY.testnet}</Badge>}
              {status === PAYMENT_STATUS.confirming ? (
                <span role="status" aria-label={COPY.confirmation}>
                  <ConfirmingStatus blocks={blocksLeft} total={blocksTotal} seconds={secondsLeft} />
                </span>
              ) : (
                <StatusPill status={status} />
              )}
              {invoice.settlementStatus !== "none" ? (
                <WalletStateLabel state={walletStateOf(invoice)} />
              ) : null}
            </span>
          </div>
          {invoice.title || (!request && client?.name) ? (
            <p className="mt-1 text-sm text-muted max-lg:hidden">
              {[invoice.title, request || !client?.name ? null : COPY.billedTo(client.name)]
                .filter(Boolean)
                .join(" · ")}
            </p>
          ) : null}
        </div>
      </div>
    </header>
  );
}

function PhoneLabel({ parts }: { parts: (string | null)[] }) {
  const text = parts.filter(Boolean).join(" · ");
  return text ? <p className="text-sm text-muted lg:hidden">{text}</p> : null;
}
