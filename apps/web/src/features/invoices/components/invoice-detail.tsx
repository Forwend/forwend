"use client";

import { cx, formatTokenAmount, PAYMENT_STATUS } from "@forwend/ui-web";
import { type ReactNode, useState } from "react";
import { useGetProfileInvoiceQuery } from "@/features/invoices/api/invoices-api";
import { InvoiceAmountPanel } from "@/features/invoices/components/invoice-amount-panel";
import { InvoiceClientPanel } from "@/features/invoices/components/invoice-client-panel";
import { InvoiceDetailHeader } from "@/features/invoices/components/invoice-detail-header";
import { InvoiceDetailSkeleton } from "@/features/invoices/components/invoice-detail-skeleton";
import { InvoiceDetailsPanel } from "@/features/invoices/components/invoice-details-panel";
import { InvoiceHistory } from "@/features/invoices/components/invoice-history";
import { InvoiceLines } from "@/features/invoices/components/invoice-lines";
import { InvoicePayLinkPhone } from "@/features/invoices/components/invoice-pay-link";
import { InvoiceTimeline } from "@/features/invoices/components/invoice-timeline";
import { PaymentAmountsNotice } from "@/features/invoices/components/payment-amounts-notice";
import {
  GRID,
  MAIN_COLUMN,
  ORDER,
  SIDE_COLUMN,
} from "@/features/invoices/constants/invoice-detail";
import { INVOICE_COPY as COPY, REQUESTS_COPY } from "@/features/invoices/constants/invoices-copy";
import { useCheckStatus } from "@/features/invoices/hooks/use-check-status";
import {
  canStillBePaid,
  invoiceException,
  invoiceNumber,
  invoiceStatus,
  linesFigures,
  overpaid,
  recordSteps,
} from "@/features/invoices/lib/invoices";
import type { Invoice } from "@/features/invoices/types/invoices";
import { BackLink } from "@/shared/components/detail-header";
import { LoadError } from "@/shared/components/load-error";
import { LIVE_QUERY } from "@/shared/config/refresh";
import { APP_ROUTES } from "@/shared/config/routes";
import { MONEY_COPY } from "@/shared/constants/money-copy";
import { API_PAYMENT_STATUSES } from "@/shared/constants/payment-state";
import { chainName } from "@/shared/lib/chains";
import { exactDigits } from "@/shared/lib/money";

const NOT_FOUND = 404;
const FADE_IN = "motion-safe:animate-[fw-fade-in_var(--fw-duration-base)_var(--fw-ease-out)]";

export interface InvoiceDetailProps {
  invoiceId: string;
  profileId: string;
  request?: boolean;
  notFound?: ReactNode;
}

// A 404 is another profile's invoice, or one of this profile's other mode.
export function InvoiceDetail({
  invoiceId,
  profileId,
  request = false,
  notFound,
}: InvoiceDetailProps) {
  const invoice = useGetProfileInvoiceQuery({ profileId, invoiceId, summary: true }, LIVE_QUERY);
  const failure = invoice.error as { status?: unknown } | undefined;
  const back = (
    <BackLink href={APP_ROUTES.invoices} label={request ? REQUESTS_COPY.invoices : COPY.back} />
  );

  if (invoice.data) {
    return (
      <InvoicePage
        back={back}
        profileId={profileId}
        invoice={invoice.data}
        mine={invoice.currentData ?? null}
        clientFailed={invoice.error !== undefined}
        request={request}
        onRetry={() => void invoice.refetch()}
        retrying={invoice.isFetching}
      />
    );
  }
  if (failure?.status === NOT_FOUND || invoice.isError) {
    return (
      <div className="flex flex-col gap-4">
        {back}
        {failure?.status === NOT_FOUND ? (
          <>
            <p className="text-muted">{COPY.notFound}</p>
            {notFound}
          </>
        ) : (
          <LoadError message={COPY.failed} onRetry={() => void invoice.refetch()} />
        )}
      </div>
    );
  }
  return <InvoiceDetailSkeleton back={back} request={request} />;
}

function InvoicePage({
  back,
  profileId,
  invoice,
  mine,
  clientFailed,
  request,
  onRetry,
  retrying,
}: {
  back: ReactNode;
  profileId: string;
  invoice: Invoice;
  mine: Invoice | null;
  clientFailed: boolean;
  request: boolean;
  onRetry: () => void;
  retrying: boolean;
}) {
  // The option the money follows: the one the payer locked, or the only one.
  const shown = invoice.options.find((o) => o.optionId === invoice.optionId);
  // Lines are in the base units of the invoice's own option, whichever option was locked.
  const main = invoice.options.find((o) => o.optionId === invoice.invoiceId);
  const number = invoiceNumber(invoice.number);
  const noun = request ? COPY.noun.request : COPY.noun.invoice;
  const status = invoiceStatus(invoice);
  const exception = invoiceException(invoice, status);
  const over = overpaid(invoice, shown);
  // No restart while money may still change the answer, or once revised.
  const restart =
    invoice.replacedBy ||
    invoice.amounts?.unreconciled ||
    invoice.amounts?.hasPolicyException ||
    (invoice.closed && invoice.amounts && BigInt(invoice.amounts.payable) > 0n)
      ? null
      : exception.kind;
  const payable = canStillBePaid(invoice, status, new Date());
  // Dust under 1 USD on a payer-chooses invoice leaves it open, so the status decides.
  const beforePayment =
    payable && (status === PAYMENT_STATUS.open || status === PAYMENT_STATUS.overdue);
  const payLink = payable ? invoice.payToken : null;
  const money = (units: bigint) =>
    shown
      ? `${formatTokenAmount({ baseUnits: units, decimals: shown.decimals, fractionDigits: exactDigits(units, shown.decimals) })} ${shown.symbol}`
      : units.toString();
  const recheck = useCheckStatus({
    payToken: payLink,
    network: chainName(invoice.chainId),
    money,
    nextCheckAt: invoice.nextCheckAt,
  });
  const [canceling, setCanceling] = useState(false);
  const [reopening, setReopening] = useState(false);
  const paymentHref = `${APP_ROUTES.payments}/${invoice.invoiceId}`;
  const receipt = invoice.paymentStatus === API_PAYMENT_STATUSES.paid ? invoice.payToken : null;
  const steps = recordSteps(invoice, mine?.sends ?? [], mine?.views ?? null);
  const phoneBar = Boolean(payLink || invoice.paidAt || restart);

  return (
    <div className={cx("flex flex-col gap-4 lg:gap-6", FADE_IN, phoneBar && "max-lg:pb-20")}>
      <InvoiceDetailHeader
        back={back}
        profileId={profileId}
        invoice={invoice}
        mine={mine}
        number={number}
        noun={noun}
        status={status}
        request={request}
        payLink={payLink}
        beforePayment={beforePayment}
        restart={restart}
        recheck={payLink ? recheck : null}
        receipt={receipt}
        paymentHref={paymentHref}
        onCanceled={() => setCanceling(true)}
        onReopened={() => setReopening(true)}
      />
      <PaymentAmountsNotice
        options={invoice.options}
        detailsHref={paymentHref}
        returnsShownFor={
          over.refunded > 0n && over.refunded === over.returned ? shown?.optionId : undefined
        }
      />

      <div className={GRID}>
        <div className={MAIN_COLUMN}>
          <InvoiceAmountPanel
            invoice={invoice}
            status={status}
            shown={shown}
            money={money}
            received={exception.received}
            over={over}
            recheck={payLink ? recheck : null}
            steps={steps}
            paymentHref={paymentHref}
          />
          {payLink ? <InvoicePayLinkPhone payToken={payLink} /> : null}
          <InvoiceTimeline steps={steps} className="lg:hidden" />
          {main && invoice.lines.length > 0 ? (
            <div className={ORDER.items}>
              <InvoiceLines
                lines={invoice.lines}
                decimals={main.decimals}
                unit={invoice.optionCount > 1 ? MONEY_COPY.usd : main.symbol}
                {...linesFigures(main, shown)}
              />
            </div>
          ) : null}
          <div className={ORDER.history}>
            <InvoiceHistory
              invoice={invoice}
              history={mine?.history ?? []}
              views={mine?.views ?? null}
            />
          </div>
        </div>

        <div className={SIDE_COLUMN}>
          {request ? null : (
            <InvoiceClientPanel
              profileId={profileId}
              invoice={invoice}
              mine={mine}
              clientFailed={clientFailed}
              onRetry={onRetry}
              retrying={retrying}
              number={number}
              payLink={payLink}
              payable={payable}
            />
          )}
          <InvoiceDetailsPanel
            invoice={invoice}
            receipt={receipt}
            canceling={canceling}
            reopening={reopening}
          />
        </div>
      </div>
    </div>
  );
}
