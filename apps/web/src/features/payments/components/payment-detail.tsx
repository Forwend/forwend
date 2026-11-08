"use client";
import {
  Badge,
  buttonClasses,
  DetailList,
  DetailRow,
  PAYMENT_STATUS,
  PAYMENT_STATUSES,
  Skeleton,
  StatusPill,
  shortAddress,
  TABLE_HEAD_CLASSES,
  TABLE_ROW_CLASSES,
  TIMELINE_STATES,
  Timeline,
  type TimelineEntry,
  TONES,
  Tooltip,
  WalletStateLabel,
} from "@forwend/ui-web";
import { ArrowDownLeft, ExternalLink, FileDown } from "lucide-react";
import { type ReactNode, useId, useRef } from "react";
import { InvoiceLines } from "@/features/invoices/components/invoice-lines";
import { ConfirmingStatus } from "@/features/invoices/components/invoice-progress";
import {
  invoiceNumber,
  invoicePdfUrl,
  linesFigures,
  optionFees,
} from "@/features/invoices/lib/invoices";
import { useGetPaymentQuery } from "@/features/payments/api/payments-api";
import { ExportPayments } from "@/features/payments/components/export-payments";
import { PaymentAmount } from "@/features/payments/components/payment-amount";
import { PaymentProblems } from "@/features/payments/components/payment-problems";
import { ReturnRow } from "@/features/payments/components/return-row";
import {
  TransferCell,
  WalletTransferRow,
} from "@/features/payments/components/wallet-transfer-row";
import { SOURCE_ICONS, SOURCE_LABELS } from "@/features/payments/constants/payments";
import { PAYMENT_DETAIL_COPY as COPY } from "@/features/payments/constants/payments-copy";
import {
  heldHint,
  leadOption,
  optionFigures,
  paymentDisplayStatus,
  paymentLabel,
  paymentWallet,
} from "@/features/payments/lib/payments";
import type { PaymentDetail as PaymentDetailType } from "@/features/payments/types/payments";
import { AssetStack } from "@/shared/components/chains/asset-stack";
import { ExplorerLink } from "@/shared/components/chains/explorer-link";
import { NetworkName } from "@/shared/components/chains/network-name";
import { TokenMark } from "@/shared/components/chains/token-mark";
import { DetailHeader, DetailHeaderSkeleton } from "@/shared/components/detail-header";
import { LoadError } from "@/shared/components/load-error";
import { RecordLink } from "@/shared/components/record-link";
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

type Option = PaymentDetailType["options"][number];

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
  const funded = payment.options.filter(
    (option) =>
      option.deposits.length > 0 || (payment.optionLocked && option.optionId === payment.optionId),
  );
  const used = funded.length
    ? funded
    : payment.options.filter((option) => option.optionId === payment.optionId);
  const status = paymentDisplayStatus(payment);
  const held = heldHint(payment.problems);
  const wallet = paymentWallet(payment);
  const payToken = payment.payToken ?? null;
  const chosen = payment.options.find((option) => option.optionId === payment.optionId);
  // Items are in the base units of the option whose id is the payment's.
  const main = payment.options.find((option) => option.optionId === payment.paymentId);
  const receiptOf = (option: Option) =>
    (payment.receipts ?? []).find((receipt) => receipt.optionId === option.optionId);
  // A payment with money on other options lists those transfers below.
  const lead = leadOption(payment, payment.options, (option) => option.deposits.length > 0);
  const figures = lead ? optionFigures(lead.amount, receiptOf(lead)) : null;
  const SourceIcon = SOURCE_ICONS[payment.source];
  // The token money arrived in, else the one the payment is fixed to; before either, it lists what it accepts.
  const paidWith =
    lead ?? (chosen && (payment.optionLocked || payment.optionCount === 1) ? chosen : undefined);
  // R-228: the fees settlement pays from this option's amount, and what reaches the owner.
  const fees = paidWith ? optionFees(paidWith) : null;
  const deposits = used.flatMap((option) =>
    option.deposits.map((deposit) => ({ deposit, option })),
  );
  return (
    <div className="flex flex-col gap-6">
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
        figure={{
          label: COPY.requested,
          value: (
            <PaymentAmount
              amount={payment.amount}
              decimals={payment.decimals}
              symbol={payment.optionCount > 1 ? MONEY_COPY.usd : payment.symbol}
            />
          ),
        }}
        actions={
          <>
            {payment.hostedUrl ? (
              <a
                href={`${payment.hostedUrl}?preview=1`}
                target="_blank"
                rel="noopener"
                className={buttonClasses({ variant: "secondary" })}
              >
                {payment.paymentStatus === "paid" ? COPY.viewReceipt : COPY.viewCheckout}
                <ExternalLink aria-hidden className="size-[var(--fw-icon-sm)]" />
              </a>
            ) : null}
            <ExportPayments profileId={profileId} paymentId={paymentId} />
            {actions?.(payment, () => title.current?.focus())}
          </>
        }
      />
      {read.error ? (
        <LoadError
          inline
          message={COPY.stale}
          onRetry={() => void read.refetch()}
          retrying={read.isFetching}
        />
      ) : null}
      <PaymentProblems problems={payment.problems} />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(24rem,2fr)] xl:items-start">
        <div className="flex min-w-0 flex-col gap-6">
          <Panel title={COPY.amount}>
            <dl className="grid grid-cols-[repeat(auto-fit,minmax(11rem,1fr))] divide-line max-sm:divide-y sm:divide-x">
              <Figure term={COPY.receivedOf}>
                {lead && figures && figures.received > 0n ? (
                  <PaymentAmount
                    amount={figures.received.toString()}
                    decimals={lead.decimals}
                    symbol={lead.symbol}
                  />
                ) : (
                  <span className="text-subtle">{COPY.nothing}</span>
                )}
              </Figure>
              {paidWith &&
              fees &&
              fees.total > 0n &&
              // The owner receives nothing of a payment canceled or closed unpaid.
              payment.paymentStatus !== API_PAYMENT_STATUSES.canceled &&
              !(payment.closed && payment.paymentStatus !== API_PAYMENT_STATUSES.paid) ? (
                <>
                  <Figure term={COPY.fees}>
                    <PaymentAmount
                      amount={fees.total.toString()}
                      decimals={paidWith.decimals}
                      symbol={paidWith.symbol}
                    />
                  </Figure>
                  <Figure term={COPY.youReceive}>
                    <PaymentAmount
                      amount={fees.net.toString()}
                      decimals={paidWith.decimals}
                      symbol={paidWith.symbol}
                    />
                  </Figure>
                </>
              ) : null}
              {lead && BigInt(lead.amounts.refunded) > 0n ? (
                <Figure term={COPY.returned}>
                  <PaymentAmount
                    amount={lead.amounts.refunded}
                    decimals={lead.decimals}
                    symbol={lead.symbol}
                  />
                </Figure>
              ) : null}
              {lead && figures && figures.extra > 0n ? (
                <Figure term={COPY.extra}>
                  <PaymentAmount
                    amount={figures.extra.toString()}
                    decimals={lead.decimals}
                    symbol={lead.symbol}
                  />
                </Figure>
              ) : lead &&
                figures &&
                figures.due > 0n &&
                figures.received > 0n &&
                !payment.closed &&
                status !== PAYMENT_STATUS.canceled ? (
                <Figure term={COPY.due}>
                  <PaymentAmount
                    amount={figures.due.toString()}
                    decimals={lead.decimals}
                    symbol={lead.symbol}
                  />
                </Figure>
              ) : null}
              {/* Before any money it says what the customer may pay with, never "Paid with". */}
              <Figure term={lead ? COPY.paidWith : paidWith ? COPY.payingWith : COPY.accepts}>
                {paidWith ? (
                  <span className="text-base font-medium">
                    <TokenMark chainId={paidWith.chainId} symbol={paidWith.symbol} />
                  </span>
                ) : (
                  <AssetStack assets={payment.options} label={COPY.options(payment.optionCount)} />
                )}
              </Figure>
            </dl>
          </Panel>
          <Panel title={COPY.transfers}>
            {deposits.length ? (
              <div className="overflow-x-auto">
                {/* Money wraps its unit in narrow places; here the row has room, so each amount stays on one line. */}
                <table className="w-full text-sm [&_[data-money]]:flex-nowrap">
                  <caption className="sr-only">{COPY.transfers}</caption>
                  <thead>
                    <tr className={TABLE_HEAD_CLASSES}>
                      <th scope="col">{COPY.columns.transfer}</th>
                      {/* Paid with and the timeline name the network; very wide screens repeat it per row. */}
                      <th scope="col" className="max-2xl:hidden">
                        {COPY.columns.network}
                      </th>
                      <th scope="col" className="max-sm:hidden">
                        {COPY.columns.state}
                      </th>
                      <th scope="col" className="text-right">
                        {COPY.columns.amount}
                      </th>
                      <th scope="col" className="w-12">
                        <span className="sr-only">{COPY.columns.transaction}</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {deposits.map(({ deposit, option }) => (
                      <tr
                        key={`${deposit.txHash}:${deposit.logIndex}`}
                        className={`${TABLE_ROW_CLASSES} [&>td]:py-2.5`}
                      >
                        <td>
                          <TransferCell
                            icon={ArrowDownLeft}
                            label={COPY.fromCustomer}
                            time={dateTime(deposit.blockTime)}
                            state={<DepositState deposit={deposit} />}
                          />
                        </td>
                        <td className="whitespace-nowrap max-2xl:hidden">
                          <NetworkName chainId={option.chainId} />
                        </td>
                        <td className="max-sm:hidden">
                          <DepositState deposit={deposit} />
                        </td>
                        <td className="text-right font-medium whitespace-nowrap text-ink tabular-nums">
                          <PaymentAmount
                            amount={deposit.amount}
                            decimals={option.decimals}
                            symbol={option.symbol}
                          />
                        </td>
                        <td className="text-right">
                          <ExplorerLink chainId={option.chainId} txHash={deposit.txHash} />
                        </td>
                      </tr>
                    ))}
                    {used.map((option) => (
                      <WalletTransferRow key={option.optionId} option={option} />
                    ))}
                    {payment.options.flatMap((option) =>
                      option.returns.map((sent) => (
                        <ReturnRow
                          key={`${option.optionId}:${sent.txHash}:${sent.to}:${sent.amount}`}
                          option={option}
                          sent={sent}
                        />
                      )),
                    )}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="px-4 py-6 text-sm text-muted sm:px-5">{COPY.nothingYet}</p>
            )}
          </Panel>
          {payment.items?.length && main ? (
            <InvoiceLines
              lines={payment.items}
              decimals={main.decimals}
              unit={payment.optionCount > 1 ? MONEY_COPY.usd : main.symbol}
              // Every option carries the same fees (D-122), so before the client picks, the main option's are theirs.
              {...linesFigures(main, paidWith ?? main)}
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
                <DetailRow term={payment.documentKind === "request" ? COPY.request : COPY.invoice}>
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
              <DetailRow term={payment.closed ? COPY.closed : COPY.closes}>
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
                      <PdfLink href={invoicePdfUrl(payToken, "invoice")}>{COPY.invoicePdf}</PdfLink>
                    ) : null}
                    {payment.paymentStatus === "paid" ? (
                      <PdfLink href={invoicePdfUrl(payToken, "receipt")}>{COPY.receiptPdf}</PdfLink>
                    ) : null}
                    {payment.documentKind === "none" && payment.paymentStatus !== "paid" ? (
                      <span className="text-subtle">{COPY.noDocuments}</span>
                    ) : null}
                  </span>
                </DetailRow>
              ) : null}
            </DetailList>
          </Panel>
          <Panel title={COPY.timeline}>
            <div className="px-4 py-4 sm:px-5">
              <Timeline label={COPY.timeline} entries={timeline(payment, deposits)} />
            </div>
          </Panel>
        </aside>
      </div>
    </div>
  );
}

type Deposit = Option["deposits"][number];

// Confirmed only once booked: a deposit final on chain but not yet booked still reads as confirming (D-24).
function DepositState({ deposit }: { deposit: Deposit }) {
  if (deposit.late) return <Badge tone={TONES.neutral}>{COPY.late}</Badge>;
  if (deposit.status === "detected" || deposit.paid === null)
    return (
      <span className="flex flex-col items-start gap-1 text-xs text-muted">
        {deposit.status === "detected" ? (
          <ConfirmingStatus
            blocks={deposit.blocksLeft}
            total={deposit.blocksTotal}
            seconds={deposit.secondsLeft}
          />
        ) : (
          <>
            <StatusPill status={PAYMENT_STATUS.confirming} />
            {COPY.depositVerifying}
          </>
        )}
      </span>
    );
  return <StatusPill status={PAYMENT_STATUS.confirmed} />;
}

/** The payment's life so far and what comes next, from the facts the API gave: never a step ahead of them. */
function timeline(
  payment: PaymentDetailType,
  deposits: readonly { deposit: Deposit; option: Option }[],
): TimelineEntry[] {
  const first = deposits[0];
  const paidBy = deposits
    .filter(({ deposit }) => deposit.paid !== null && BigInt(deposit.paid) > 0n)
    .at(-1);
  const paid = payment.paymentStatus === "paid";
  const settled = payment.settlementStatus === "settled";
  // The option the payment is recorded on is the one settled.
  const settledBy = payment.options.find((option) => option.optionId === payment.optionId);
  const ended = !paid && (payment.closed || payment.paymentStatus === "canceled");
  const steps: Omit<TimelineEntry, "state">[] = [
    {
      id: "created",
      title: COPY.steps.created,
      time: dateTime(payment.createdAt),
      chips: [{ label: COPY.chips.source, value: SOURCE_LABELS[payment.source] }],
    },
    {
      id: "detected",
      title: COPY.steps.detected,
      time: first ? dateTime(first.deposit.blockTime) : undefined,
      chips: first
        ? [
            { label: COPY.chips.network, value: <NetworkName chainId={first.option.chainId} /> },
            {
              label: COPY.chips.tx,
              value: <span className="font-mono">{shortAddress(first.deposit.txHash)}</span>,
            },
          ]
        : undefined,
    },
    {
      id: "paid",
      title: COPY.steps.paid,
      time: paid && paidBy ? dateTime(paidBy.deposit.blockTime) : undefined,
    },
    ...(ended
      ? [{ id: "closed", title: COPY.steps.closed, time: dateTime(payment.closesAt) }]
      : [
          {
            id: "wallet",
            title: COPY.steps.wallet,
            time:
              settled && settledBy?.settlement?.signedAt
                ? dateTime(settledBy.settlement.signedAt)
                : undefined,
          },
        ]),
  ];
  const done = [true, Boolean(first), paid, ended || settled];
  // The last return to a payer, when support sent one (PLAN 11.10.3).
  const returned = payment.options
    .flatMap((o) => o.returns)
    .reduce<PaymentDetailType["options"][number]["returns"][number] | undefined>(
      (last, r) => (!last || r.blockTime > last.blockTime ? r : last),
      undefined,
    );
  if (returned) {
    steps.push({
      id: "returned",
      title: COPY.steps.returned,
      time: dateTime(returned.blockTime),
      chips: [
        {
          label: COPY.chips.tx,
          value: <span className="font-mono">{shortAddress(returned.txHash)}</span>,
        },
      ],
    });
    done.push(true);
  }
  const current = done.indexOf(false);
  return steps.map((step, i) => ({
    ...step,
    state: done[i]
      ? TIMELINE_STATES.done
      : i === current && !ended
        ? TIMELINE_STATES.current
        : TIMELINE_STATES.upcoming,
  }));
}

/** A labelled figure in the Amount card. */
function Figure({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1 px-4 py-4 sm:px-5">
      <dt className="text-sm text-muted">{term}</dt>
      <dd className="text-2xl font-medium tracking-tight text-ink tabular-nums">{children}</dd>
    </div>
  );
}

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
    <div aria-busy className="flex flex-col gap-6">
      <span className="sr-only" role="status">
        {COPY.loading}
      </span>
      <DetailHeaderSkeleton
        back={{ href: APP_ROUTES.payments, label: COPY.back }}
        // The source's icon is not known yet: an empty tile.
        icon={<span />}
        figure={COPY.requested}
      />
      <Skeleton className="h-11 w-full" />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(24rem,2fr)]">
        <span className="flex flex-col gap-6">
          <Skeleton className="h-32" />
          <Skeleton className="h-48" />
        </span>
        <Skeleton className="h-80" />
      </div>
    </div>
  );
}
