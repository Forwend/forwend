"use client";
import {
  Badge,
  buttonClasses,
  cx,
  DetailList,
  DetailRow,
  PAYMENT_STATUSES,
  Skeleton,
  StatusPill,
  Tooltip,
  WalletStateLabel,
} from "@forwend/ui-web";
import { ExternalLink, FileDown, ReceiptText } from "lucide-react";
import { type ReactNode, useId, useRef } from "react";
import { InvoiceLines } from "@/features/invoices/components/invoice-lines";
import { invoiceNumber, invoicePdfUrl, linesFigures } from "@/features/invoices/lib/invoices";
import { useGetPaymentQuery } from "@/features/payments/api/payments-api";
import { ExportPayments } from "@/features/payments/components/export-payments";
import { PaymentJourney } from "@/features/payments/components/payment-journey";
import { PaymentProblems } from "@/features/payments/components/payment-problems";
import { PaymentSum } from "@/features/payments/components/payment-sum";
import { SOURCE_ICONS, SOURCE_LABELS } from "@/features/payments/constants/payments";
import { PAYMENT_DETAIL_COPY as COPY } from "@/features/payments/constants/payments-copy";
import {
  checkoutOver,
  paymentJourney,
  paymentMoney,
} from "@/features/payments/lib/payment-journey";
import {
  heldHint,
  paymentDisplayStatus,
  paymentLabel,
  paymentWallet,
} from "@/features/payments/lib/payments";
import type { PaymentDetail as PaymentDetailType } from "@/features/payments/types/payments";
import { DetailHeader, DetailHeaderSkeleton } from "@/shared/components/detail-header";
import { LoadError } from "@/shared/components/load-error";
import { RecordLink } from "@/shared/components/record-link";
import { LineSkeleton } from "@/shared/components/rows-skeleton";
import { LIVE_QUERY } from "@/shared/config/refresh";
import { APP_ROUTES } from "@/shared/config/routes";
import { MONEY_COPY } from "@/shared/constants/money-copy";
import { API_PAYMENT_STATUSES } from "@/shared/constants/payment-state";
import { dateTime } from "@/shared/lib/dates";

const NOT_FOUND = 404;

export interface PaymentDetailProps {
  profileId: string;
  paymentId: string;
  /** More header actions the screen composes from other features, such as a checkout's Cancel; focusTitle is where
   * focus goes once one of them is done and gone. */
  actions?: (payment: PaymentDetailType, focusTitle: () => void) => ReactNode;
  /** Under the not found line: the screen's way to the other mode (R-221). */
  notFound?: ReactNode;
}

export function PaymentDetail({ profileId, paymentId, actions, notFound }: PaymentDetailProps) {
  const read = useGetPaymentQuery({ profileId, paymentId }, LIVE_QUERY);
  const title = useRef<HTMLHeadingElement>(null);
  const payment = read.currentData;
  if (!payment && (read.error as { status?: unknown } | undefined)?.status === NOT_FOUND)
    return (
      <div className="flex flex-col gap-3">
        <p className="text-muted">{COPY.notFound}</p>
        {notFound}
      </div>
    );
  if (!payment)
    return read.isError ? (
      <LoadError
        page
        message={COPY.unavailable}
        onRetry={() => void read.refetch()}
        retrying={read.isFetching}
      />
    ) : (
      <DetailSkeleton />
    );
  const status = paymentDisplayStatus(payment);
  const held = heldHint(payment.problems);
  const wallet = paymentWallet(payment);
  const payToken = payment.payToken ?? null;
  // Items are in the base units of the option whose id is the payment's.
  const main = payment.options.find((option) => option.optionId === payment.paymentId);
  const money = paymentMoney(payment);
  const paid = payment.paymentStatus === API_PAYMENT_STATUSES.paid;
  const SourceIcon = SOURCE_ICONS[payment.source];
  return (
    <div className={PAGE}>
      <DetailHeader
        back={{ href: APP_ROUTES.payments, label: COPY.back }}
        icon={<SourceIcon aria-hidden />}
        title={paymentLabel(payment)}
        titleRef={title}
        badges={
          <>
            {payment.livemode ? null : <Badge tone="warning">{COPY.testnet}</Badge>}
            {held ? (
              // Held money is the customer's and support handles it: a hint on the status, not a warning.
              <Tooltip content={held}>
                <button
                  type="button"
                  aria-label={`${PAYMENT_STATUSES[status].label}. ${held}`}
                  // On a touch screen a 44px band takes the tap; the badge keeps its size.
                  className="relative cursor-default rounded-sm outline-none before:absolute focus-visible:outline-2 focus-visible:outline-focus pointer-coarse:before:top-1/2 pointer-coarse:before:left-1/2 pointer-coarse:before:h-11 pointer-coarse:before:w-[max(100%,2.75rem)] pointer-coarse:before:-translate-x-1/2 pointer-coarse:before:-translate-y-1/2"
                >
                  <StatusPill status={status} />
                </button>
              </Tooltip>
            ) : (
              <StatusPill status={status} />
            )}
            {wallet === "none" ? null : <WalletStateLabel state={wallet} />}
          </>
        }
        meta={
          <>
            {SOURCE_LABELS[payment.source]}
            {payment.storeName ? ` · ${payment.storeName}` : ""} · {dateTime(payment.createdAt)}
          </>
        }
      />
      <div className="flex flex-col gap-6 empty:hidden lg:col-span-2">
        {read.error ? (
          <LoadError
            inline
            message={COPY.stale}
            onRetry={() => void read.refetch()}
            retrying={read.isFetching}
          />
        ) : null}
        <PaymentProblems problems={payment.problems} />
      </div>
      <div className={`${FADE} lg:col-span-2`}>
        <PaymentSum payment={payment} money={money} />
      </div>
      <div className={ACTIONS}>
        {payment.hostedUrl ? (
          <a
            href={`${payment.hostedUrl}?preview=1`}
            target="_blank"
            rel="noopener"
            className={buttonClasses({ variant: "secondary" })}
          >
            {paid ? (
              <ReceiptText aria-hidden className="size-[var(--fw-icon-sm)]" />
            ) : (
              <ExternalLink aria-hidden className="size-[var(--fw-icon-sm)]" />
            )}
            <span className="lg:hidden">{paid ? COPY.receipt : COPY.checkout}</span>
            <span className="max-lg:hidden">{paid ? COPY.viewReceipt : COPY.viewCheckout}</span>
          </a>
        ) : null}
        {payToken && payment.documentKind !== "none" ? (
          // Details has this link too; on a narrow screen it is far below.
          <a
            href={invoicePdfUrl(payToken, "invoice")}
            className={`${buttonClasses({ variant: "secondary" })} lg:hidden`}
          >
            <FileDown aria-hidden className="size-[var(--fw-icon-sm)]" />
            {COPY.invoiceShort}
          </a>
        ) : null}
        <ExportPayments profileId={profileId} paymentId={paymentId} />
        {actions?.(payment, () => title.current?.focus())}
      </div>
      <div className={`${FADE} lg:col-span-2`}>
        <div className="grid gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(24rem,2fr)] xl:items-start">
          <div className="flex min-w-0 flex-col gap-6">
            <PaymentJourney payment={payment} steps={paymentJourney(payment, money)} />
            {payment.items?.length && main ? (
              <InvoiceLines
                lines={payment.items}
                decimals={main.decimals}
                unit={payment.optionCount > 1 ? MONEY_COPY.usd : main.symbol}
                // Every option carries the same fees (D-122), so before the client picks, the main option's are theirs.
                {...linesFigures(main, money.paidWith ?? main)}
                owner
              />
            ) : null}
          </div>
          <aside className="flex min-w-0 flex-col gap-6">
            <Panel title={COPY.details}>
              <DetailList>
                {payment.reference ? (
                  <DetailRow term={COPY.reference}>{payment.reference}</DetailRow>
                ) : null}
                {payment.documentKind !== "none" && payment.number ? (
                  <DetailRow
                    term={payment.documentKind === "request" ? COPY.request : COPY.invoice}
                  >
                    <RecordLink href={`${APP_ROUTES.invoices}/${payment.paymentId}`}>
                      {invoiceNumber(payment.number)}
                    </RecordLink>
                  </DetailRow>
                ) : null}
                {payment.linkId ? (
                  <DetailRow term={COPY.link}>
                    <RecordLink href={`${APP_ROUTES.links}/${payment.linkId}`}>
                      {payment.title ?? COPY.viewLink}
                    </RecordLink>
                  </DetailRow>
                ) : null}
                {payment.storeId ? (
                  <DetailRow term={COPY.store}>
                    <RecordLink href={`${APP_ROUTES.stores}/${payment.storeId}`}>
                      {payment.storeName ?? COPY.store}
                    </RecordLink>
                  </DetailRow>
                ) : null}
                <DetailRow term={COPY.customer}>
                  {payment.customer.name || payment.customer.email || (
                    <span className="text-subtle">{COPY.noCustomer}</span>
                  )}
                  {payment.customer.name && payment.customer.email ? (
                    <span className="block break-all text-muted">{payment.customer.email}</span>
                  ) : null}
                </DetailRow>
                <DetailRow term={checkoutOver(payment) ? COPY.closed : COPY.closes}>
                  {dateTime(payment.closesAt)}
                </DetailRow>
                {Object.entries(payment.metadata).map(([key, value]) => (
                  <DetailRow key={key} term={key}>
                    <span className="font-mono text-xs">{value}</span>
                  </DetailRow>
                ))}
                {payToken ? (
                  <DetailRow term={COPY.documents}>
                    <span className="flex flex-wrap justify-end gap-x-5 gap-y-1">
                      {payment.documentKind !== "none" ? (
                        <PdfLink href={invoicePdfUrl(payToken, "invoice")}>
                          {COPY.invoicePdf}
                        </PdfLink>
                      ) : null}
                      {payment.paymentStatus === "paid" ? (
                        <PdfLink href={invoicePdfUrl(payToken, "receipt")}>
                          {COPY.receiptPdf}
                        </PdfLink>
                      ) : null}
                      {payment.documentKind === "none" && payment.paymentStatus !== "paid" ? (
                        <span className="text-subtle">{COPY.noDocuments}</span>
                      ) : null}
                    </span>
                  </DetailRow>
                ) : null}
              </DetailList>
            </Panel>
          </aside>
        </div>
      </div>
    </div>
  );
}

// One column on narrow screens, in the order written: header, notices, the sum, the actions, the rest. From large
// screens the grid puts the actions beside the header. They stay one element, so a dialog they open is drawn once.
const PAGE = "grid gap-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start";
const ACTIONS =
  "flex flex-wrap items-center gap-2 max-lg:*:flex-1 lg:col-start-2 lg:row-start-1 lg:justify-end";
const FADE = "motion-safe:animate-[fw-fade-in_var(--fw-duration-base)_var(--fw-ease-out)]";

function Panel({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="fw-panel overflow-hidden">
      <h2 id={id} className="fw-panel-head text-base font-semibold text-ink">
        {title}
      </h2>
      {children}
    </section>
  );
}

function PdfLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} className={`${buttonClasses({ variant: "link" })} gap-1.5 text-sm`}>
      <FileDown aria-hidden className="size-[var(--fw-icon-sm)]" />
      {children}
    </a>
  );
}

function DetailSkeleton() {
  return (
    <div aria-busy className={PAGE}>
      <span className="sr-only" role="status">
        {COPY.loading}
      </span>
      <DetailHeaderSkeleton
        back={{ href: APP_ROUTES.payments, label: COPY.back }}
        // The source's icon is not known yet: an empty tile.
        icon={<span />}
        actions={null}
      />
      <div
        aria-hidden
        className="flex flex-col overflow-hidden rounded-lg border border-line bg-surface lg:col-span-2 lg:flex-row"
      >
        {SKELETON_CELLS.map((cell, i) => (
          // On narrow screens the first is the headline and the others are lines under it, as in the sum.
          <div
            key={cell}
            className={cx(
              "flex flex-1 gap-1.5 border-line lg:flex-col lg:border-l lg:px-6 lg:py-5 lg:first:border-l-0",
              i === 0
                ? "flex-col px-4 py-4"
                : "py-3 max-lg:mx-4 max-lg:items-center max-lg:justify-between max-lg:border-t",
            )}
          >
            <LineSkeleton size="text-sm" className="w-24" />
            <LineSkeleton
              size={i === 0 ? "text-4xl lg:text-3xl" : "text-sm lg:text-3xl"}
              className="w-28"
            />
            <span className={i === 0 ? "" : "max-lg:hidden"}>
              <LineSkeleton size="text-xs" className="w-20" />
            </span>
          </div>
        ))}
      </div>
      <div aria-hidden className={ACTIONS}>
        <Skeleton className="h-10 w-36" />
        <Skeleton className="h-10 w-24" />
      </div>
      <div className="grid gap-6 lg:col-span-2 xl:grid-cols-[minmax(0,3fr)_minmax(24rem,2fr)] xl:items-start">
        <div aria-hidden className="fw-panel overflow-hidden">
          <div className="fw-panel-head">
            <LineSkeleton size="text-base" className="w-44" />
          </div>
          <div className="flex flex-col px-4 py-1.5 sm:px-5">
            {SKELETON_STEPS.map((step) => (
              <div key={step} className="flex items-center gap-3 py-3.5 sm:gap-4">
                <Skeleton className="size-9 rounded-pill" />
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <LineSkeleton size="text-sm" className="w-32" />
                  <LineSkeleton size="text-xs" className="w-44 max-w-full" />
                </span>
                <LineSkeleton size="text-base" className="w-20" />
              </div>
            ))}
          </div>
        </div>
        <div aria-hidden className="fw-panel overflow-hidden">
          <div className="fw-panel-head">
            <LineSkeleton size="text-base" className="w-20" />
          </div>
          <div className="flex flex-col divide-y divide-line">
            {SKELETON_STEPS.map((step) => (
              <div key={step} className="flex justify-between gap-4 px-4 py-3 sm:px-5">
                <LineSkeleton size="text-sm" className="w-24" />
                <LineSkeleton size="text-sm" className="w-32" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// The sum's usual three figures and the journey's usual four rows, so the page keeps its place once loaded.
const SKELETON_CELLS = ["paid", "fee", "wallet"] as const;
const SKELETON_STEPS = ["created", "sent", "fee", "wallet"] as const;
