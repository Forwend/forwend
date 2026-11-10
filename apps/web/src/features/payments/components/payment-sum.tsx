import { cx } from "@forwend/ui-web";
import { CircleCheck } from "lucide-react";
import type { ReactNode } from "react";
import { PaymentAmount } from "@/features/payments/components/payment-amount";
import { SUM_CELLS } from "@/features/payments/constants/payments";
import { PAYMENT_DETAIL_COPY as COPY } from "@/features/payments/constants/payments-copy";
import { crossChainOf, crossMoney } from "@/features/payments/lib/payment-journey";
import type { PaymentDetail, PaymentMoney, SumCell } from "@/features/payments/types/payments";
import { AssetStack } from "@/shared/components/chains/asset-stack";
import { blockchainName, chainName } from "@/shared/lib/chains";

export interface PaymentSumProps {
  payment: PaymentDetail;
  money: PaymentMoney;
}

/** R-248: the payment's money as one sum. A row of figures on wide screens; on narrow ones the last figure is the
 * headline and the others are lines under it. */
export function PaymentSum({ payment, money }: PaymentSumProps) {
  const { cells, adds, lead, paidWith, settled } = money;
  const headline = cells.find((cell) => cell.id === SUM_CELLS.wallet) ?? cells[0];
  const cross = crossChainOf(payment);
  const place = paidWith ? COPY.sum.on(paidWith.symbol, chainName(paidWith.chainId)) : null;
  const sent = cross
    ? ([
        crossMoney(BigInt(cross.deposited ?? cross.amountIn), cross),
        blockchainName(cross.blockchain),
      ] as const)
    : null;
  // The page has no other Requested figure once money came.
  const asked =
    lead && cells[0]?.id === SUM_CELLS.paid && cells[0].units !== BigInt(lead.amount)
      ? COPY.sum.ofRequested(crossMoney(BigInt(lead.amount), lead))
      : null;
  const notes: Partial<Record<SumCell["id"], ReactNode>> = {
    paid: (
      <>
        {sent ? COPY.sum.sentAs(...sent) : place}
        {asked ? <span className="block">{asked}</span> : null}
      </>
    ),
    // Still converting: the customer's own transfer is all the page has.
    requested: sent ? COPY.sum.sent(...sent) : place ? COPY.sum.payingWith(place) : null,
    networkFee: COPY.sum.feeNote,
    platformFee: COPY.sum.feeNote,
    wallet: place,
  };
  const dense = cells.length > 3;
  return (
    <section aria-label={COPY.amount} className="fw-panel overflow-hidden">
      <dl className="flex flex-col lg:flex-row">
        {cells.map((cell, i) => {
          const end = cell.id === SUM_CELLS.wallet;
          const top = cell === headline;
          const sign = !adds || i === 0 ? null : end ? "=" : "−";
          return (
            <div
              key={cell.id}
              className={cx(
                "relative flex min-w-0 gap-x-4 gap-y-1.5 px-4 sm:px-5 lg:flex-1 lg:flex-col lg:border-l lg:border-line lg:px-6 lg:py-5 lg:first:border-l-0",
                top
                  ? "flex-col py-4 max-lg:order-first"
                  : "border-line py-3 max-lg:items-baseline max-lg:justify-between max-lg:border-t",
                end && "lg:flex-[1.25] lg:bg-surface-2",
              )}
            >
              <dt
                className={cx(
                  "flex items-center gap-1.5 text-sm",
                  top ? "max-lg:font-medium max-lg:text-ink" : "",
                  end ? "lg:font-medium lg:text-ink" : "text-muted",
                )}
              >
                {sign ? (
                  <span className="absolute top-1/2 left-0 z-10 grid size-8 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-pill border border-line-strong bg-surface text-lg leading-none font-normal text-ink max-lg:hidden">
                    {sign}
                  </span>
                ) : null}
                <span>
                  {COPY.sum.cells[cell.id === SUM_CELLS.wallet && !settled ? "expected" : cell.id]}
                </span>
                {end && settled ? (
                  <CircleCheck aria-hidden className="size-[var(--fw-icon-sm)] text-success" />
                ) : null}
              </dt>
              <dd
                className={cx(
                  "flex min-w-0 flex-col gap-1 text-ink tabular-nums",
                  top ? "" : "max-lg:items-end",
                )}
              >
                <span
                  className={cx(
                    "font-medium tracking-tight",
                    top ? "max-lg:text-4xl" : "max-lg:text-sm max-lg:tracking-normal",
                    end
                      ? dense
                        ? "lg:text-3xl"
                        : "lg:text-4xl"
                      : dense
                        ? "lg:text-2xl"
                        : "lg:text-3xl",
                  )}
                >
                  {sign === "−" ? <span className="lg:hidden">− </span> : null}
                  <PaymentAmount
                    amount={cell.units.toString()}
                    decimals={cell.decimals}
                    symbol={cell.symbol}
                  />
                </span>
                {notes[cell.id] ? (
                  <span className={cx("text-xs text-subtle", top ? "" : "max-lg:hidden")}>
                    {notes[cell.id]}
                  </span>
                ) : null}
              </dd>
            </div>
          );
        })}
        {paidWith ? null : (
          // Before any money it says what the customer may pay with.
          <div className="flex min-w-0 items-center justify-between gap-x-4 gap-y-1.5 border-line px-4 py-3 max-lg:border-t sm:px-5 lg:flex-1 lg:flex-col lg:items-start lg:justify-start lg:border-l lg:px-6 lg:py-5">
            <dt className="text-sm text-muted">{COPY.accepts}</dt>
            <dd className="min-w-0 text-sm text-ink">
              <AssetStack assets={payment.options} label={COPY.options(payment.optionCount)} />
            </dd>
          </div>
        )}
      </dl>
    </section>
  );
}
