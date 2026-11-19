"use client";

import {
  BigAmount,
  buttonClasses,
  cx,
  formatTokenAmount,
  PAYMENT_STATUS,
  type PaymentStatus,
} from "@forwend/ui-web";
import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { CheckStatusNote } from "@/features/invoices/components/check-status";
import { InvoiceAmount } from "@/features/invoices/components/invoice-amount";
import {
  InvoiceMoneyLine,
  type MoneyTerm,
} from "@/features/invoices/components/invoice-money-line";
import { InvoiceSteps } from "@/features/invoices/components/invoice-steps";
import { AMOUNT_BODY, ICON, PHONE_ROW } from "@/features/invoices/constants/invoice-detail";
import { INVOICE_COPY as COPY } from "@/features/invoices/constants/invoices-copy";
import type { CheckStatusState } from "@/features/invoices/hooks/use-check-status";
import {
  daysUntilDue,
  formatDueDateShort,
  optionFees,
  type overpaid,
} from "@/features/invoices/lib/invoices";
import type { Invoice, InvoiceOption, RecordStep } from "@/features/invoices/types/invoices";
import { ExplorerLink } from "@/shared/components/chains/explorer-link";
import { MarkIcon } from "@/shared/components/chains/token-mark";
import { CHAINS, TOKEN_ICONS } from "@/shared/constants/chains";
import { MONEY_COPY } from "@/shared/constants/money-copy";
import { API_PAYMENT_STATUSES } from "@/shared/constants/payment-state";
import { chainName } from "@/shared/lib/chains";
import { shortDate, timeOfDay } from "@/shared/lib/dates";
import { exactDigits } from "@/shared/lib/money";

const FADE_IN = "motion-safe:animate-[fw-fade-in_var(--fw-duration-base)_var(--fw-ease-out)]";
const AMOUNT = "max-w-full flex-wrap text-4xl [overflow-wrap:anywhere] sm:text-5xl";

export interface InvoiceAmountPanelProps {
  invoice: Invoice;
  status: PaymentStatus;
  shown: InvoiceOption | undefined; // the option the money follows
  money: (units: bigint) => string;
  received: bigint; // on time, in the shown option's units
  over: ReturnType<typeof overpaid>;
  recheck: CheckStatusState | null;
  steps: readonly RecordStep[];
  paymentHref: string;
}

/** The amount that matters now, one sentence on where it stands, and the money as one sum. */
export function InvoiceAmountPanel({
  invoice,
  status,
  shown,
  money,
  received,
  over,
  recheck,
  steps,
  paymentHref,
}: InvoiceAmountPanelProps) {
  const amount = BigInt(invoice.amount);
  const paidAt = invoice.paidAt;
  const settled = invoice.settledAt !== null;
  const canceled = invoice.paymentStatus === API_PAYMENT_STATUSES.canceled;
  const ended = status === PAYMENT_STATUS.expired || status === PAYMENT_STATUS.expiredPartiallyPaid;
  const waiting = status === PAYMENT_STATUS.open || status === PAYMENT_STATUS.overdue;
  // The client still picks the token: the amount reads in USD.
  const choosing = invoice.optionCount > 1 && !invoice.optionLocked;
  // A canceled invoice owes nothing: money after the cancel is held for the payer.
  const owing = !paidAt && !canceled && shown !== undefined && received > 0n && received < amount;
  const fees = shown ? optionFees(shown) : null;
  const wait = invoice.settlementWait ?? null;
  // While the client picks, every option carries the same fees, so the sum reads in USD.
  const lineMoney =
    choosing && shown
      ? (units: bigint) =>
          `${formatTokenAmount({ baseUnits: units, decimals: shown.decimals, fractionDigits: exactDigits(units, shown.decimals) })} ${MONEY_COPY.usd}`
      : money;
  const label =
    paidAt && settled
      ? COPY.inWallet
      : paidAt
        ? COPY.amount
        : ended
          ? COPY.notPaid
          : owing
            ? COPY.stillDue
            : waiting
              ? COPY.amountDue
              : COPY.amount;
  const figure = paidAt && settled && fees ? fees.net : owing ? amount - received : amount;
  const due = invoice.dueDate ? formatDueDateShort(invoice.dueDate, new Date()) : null;
  const sentence: readonly [string, string | null] | null = canceled
    ? [COPY.say.canceled, null]
    : paidAt
      ? [COPY.say.paid(shortDate(paidAt)), null]
      : ended
        ? [COPY.say.closed(shortDate(invoice.closesAt)), null]
        : status === PAYMENT_STATUS.overdue && invoice.dueDate
          ? [
              COPY.say.late(-daysUntilDue(invoice.dueDate, new Date())),
              COPY.say.until(shortDate(invoice.closesAt)),
            ]
          : owing
            ? due
              ? [COPY.say.due(due), COPY.say.rest]
              : [COPY.say.rest, null]
            : status === PAYMENT_STATUS.detected || status === PAYMENT_STATUS.confirming
              ? [COPY.say.arriving, null]
              : due
                ? [COPY.say.due(due), null]
                : null;
  // A fee of 0 is no term.
  const returnTx = shown?.amounts?.lastReturnTxHash;
  const feeTerms: MoneyTerm[] = fees
    ? [
        ...(fees.network > 0n ? [{ label: COPY.networkFee, units: fees.network }] : []),
        ...(fees.platform > 0n ? [{ label: COPY.platformFee, units: fees.platform }] : []),
      ]
    : [];
  const terms: MoneyTerm[] =
    !fees || canceled || ended || owing
      ? []
      : paidAt
        ? [
            { label: COPY.terms.customerPaid, units: amount + over.extra },
            ...(over.refunded > 0n
              ? [
                  {
                    label: COPY.terms.refunded,
                    units: over.refunded,
                    after:
                      shown && returnTx ? (
                        <ExplorerLink chainId={shown.chainId} txHash={returnTx} className="-my-1" />
                      ) : null,
                  },
                ]
              : []),
            ...(over.extra > over.refunded
              ? [{ label: COPY.terms.held, units: over.extra - over.refunded }]
              : []),
            ...feeTerms,
            { label: settled ? COPY.inWallet : COPY.terms.toWallet, units: fees.net },
          ]
        : [
            { label: COPY.terms.clientPays, units: BigInt(shown?.amount ?? invoice.amount) },
            ...feeTerms,
            { label: COPY.youReceive, units: fees.net },
          ];

  return (
    <section aria-labelledby="invoice-amount" className="fw-panel overflow-hidden">
      <div key={status} className={cx(AMOUNT_BODY, FADE_IN)}>
        <div className="flex min-w-0 flex-col items-start">
          <p id="invoice-amount" className="text-sm font-medium text-muted">
            {label}
          </p>
          <p className={cx("mt-1 max-w-full", canceled && "opacity-50")}>
            {shown ? (
              <BigAmount
                value={formatTokenAmount({
                  baseUnits: figure,
                  decimals: shown.decimals,
                  fractionDigits: exactDigits(figure, shown.decimals),
                })}
                unit={choosing ? MONEY_COPY.usd : shown.symbol}
                className={AMOUNT}
              />
            ) : (
              <InvoiceAmount invoice={invoice} tokens={[]} className="text-2xl" />
            )}
          </p>
          <p className="mt-2 flex items-center gap-2 text-sm text-muted">
            {choosing ? (
              COPY.clientChooses
            ) : shown ? (
              <>
                <MarkIcon
                  token={TOKEN_ICONS[shown.symbol]}
                  chain={CHAINS[shown.chainId]?.icon}
                  letter={shown.symbol.slice(0, 1)}
                  small
                />
                {COPY.onNetwork(shown.symbol, chainName(shown.chainId))}
              </>
            ) : null}
          </p>
          {sentence ? (
            <p className="mt-4 max-w-prose text-sm sm:text-base">
              <b className="font-semibold text-ink">{sentence[0]}</b>
              {sentence[1] ? <span className="text-muted"> {sentence[1]}</span> : null}
            </p>
          ) : null}
          {wait ? (
            <p role="status" className="mt-2 text-sm text-muted">
              {COPY.settling[wait.kind](
                chainName(invoice.chainId),
                wait.secondsLeft ?? 0,
                wait.until ? timeOfDay(wait.until) : "",
              )}
            </p>
          ) : null}
          {recheck ? <CheckStatusNote status={recheck} className="mt-2" /> : null}
          {paidAt ? null : (
            <div className="mt-3 max-lg:hidden">
              <Link
                href={paymentHref}
                className={cx(buttonClasses({ variant: "ghost", size: "sm" }), "-ml-3 self-start")}
              >
                {COPY.viewPayment}
                <ChevronRight aria-hidden className={ICON} />
              </Link>
            </div>
          )}
        </div>
        {owing ? (
          <div className="flex w-full flex-col gap-2">
            <Received share={Number((received * 1000n) / amount) / 10} />
            <p className="text-sm text-muted">{COPY.receivedOf(money(received), money(amount))}</p>
          </div>
        ) : terms.length > 2 ? (
          <InvoiceMoneyLine terms={terms} money={lineMoney} className="w-full" />
        ) : null}
      </div>
      <InvoiceSteps steps={steps} className="border-t border-line px-6 py-5 max-lg:hidden" />
      {paidAt ? null : (
        <Link
          href={paymentHref}
          className={`${PHONE_ROW} text-ink outline-none hover:bg-surface-2 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus`}
        >
          {COPY.viewPayment}
          <ChevronRight aria-hidden className={`${ICON} text-muted`} />
        </Link>
      )}
    </section>
  );
}

function Received({ share }: { share: number }) {
  return (
    <span aria-hidden className="block h-1.5 w-full overflow-hidden rounded-pill bg-line">
      <span
        className="block h-full origin-left rounded-pill bg-accent motion-safe:animate-[fw-grow_var(--fw-duration-slower)_var(--fw-ease-out)]"
        style={{ width: `${share}%` }}
      />
    </span>
  );
}
