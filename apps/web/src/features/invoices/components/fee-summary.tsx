"use client";

import { SegmentedControl, Skeleton, Switch } from "@forwend/ui-web";
import { skipToken } from "@reduxjs/toolkit/query";
import { useEffect, useState } from "react";
import { useGetFeesQuery } from "@/features/invoices/api/invoices-api";
import { FEES_FORM_COPY as COPY } from "@/features/invoices/constants/invoices-copy";
import { decimalText, feeFigures } from "@/features/invoices/lib/invoices";
import type { FeeQuote } from "@/features/invoices/types/invoices";
import { FEES_PAID_BY } from "@/features/profiles/constants/profile";

// A quote waits until typing stops, so each keystroke asks nothing.
const QUOTE_WAIT_MS = 400;
const UNAVAILABLE = 503; // network_fee_unavailable

export interface FeeSummaryProps {
  profileId: string;
  /** A merchant invoice's store, whose tokens can leave out the costliest network (R-136). */
  storeId?: string;
  /** The price: in USD when the client chooses the token, else in base units of token on chainId. */
  any: boolean;
  chainId: number;
  token: string;
  units: bigint;
  decimals: number;
  clientPays: boolean;
  onClientPays: (clientPays: boolean) => void;
  /** The quote, for the preview. */
  onQuote?: (quote: FeeQuote | undefined) => void;
  /** True while this price's quote is on its way: neither priced nor refused yet. */
  onPricing?: (pricing: boolean) => void;
  money: (units: bigint) => string;
  /** Only the fee: the price is the payer's to choose, as on an open payment link. */
  feeOnly?: boolean;
  /** As the totals under an invoice's items: subtotal, the fee with who pays it, then what each side gets. */
  totals?: boolean;
}

/** R-227: who pays the network fee, and what the client pays and the owner receives, before the form saves. */
export function FeeSummary({
  profileId,
  storeId,
  any,
  chainId,
  token,
  units,
  decimals,
  clientPays,
  onClientPays,
  onQuote,
  onPricing,
  money,
  feeOnly,
  totals,
}: FeeSummaryProps) {
  const price =
    units > 0n
      ? any
        ? `usd:${decimalText(units, decimals)}`
        : `${chainId}:${token}:${units}`
      : "";
  const [asked, setAsked] = useState(price);
  useEffect(() => {
    const wait = setTimeout(() => setAsked(price), QUOTE_WAIT_MS);
    return () => clearTimeout(wait);
  }, [price]);
  // Who pays decides which networks a small price can carry, as the invoice is priced (D-122).
  const feesPaidBy = clientPays ? FEES_PAID_BY.client : FEES_PAID_BY.owner;
  const quote = useGetFeesQuery(
    asked === ""
      ? skipToken
      : any
        ? { profileId, storeId, feesPaidBy, amountUsd: asked.slice(4) }
        : { profileId, storeId, feesPaidBy, chainId, token, amount: asked.split(":")[2] ?? "" },
  );
  // Switching who pays asks again, but rarely changes the fees: the last quote of this same price shows meanwhile.
  // A refused or failed one shows its answer instead.
  const last = quote.isError ? undefined : (quote.currentData ?? quote.data);
  const current =
    asked === price &&
    last?.options.find((o) => o.decimals === decimals)?.price === units.toString()
      ? last
      : undefined;
  useEffect(() => onQuote?.(current), [current, onQuote]);
  const failed = quote.isError && asked === price;
  const pricing = price !== "" && !current && !failed;
  useEffect(() => onPricing?.(pricing), [pricing, onPricing]);
  const figures = feeFigures(current, decimals, clientPays);
  // A refused price says why in its own field; only a quote that can't be had now is said here.
  const waiting =
    price === "" || current
      ? null
      : failed
        ? (quote.error as { status?: unknown }).status === UNAVAILABLE
          ? COPY.failed
          : null
        : COPY.pricing;
  if (totals) {
    const ROW = "flex min-h-10 items-center justify-between gap-4 px-4 py-2";
    const VALUE = "text-right font-medium whitespace-nowrap text-ink tabular-nums";
    // While the fee is priced, each figure that waits on it keeps its place as a placeholder of its own width.
    const pricingNow = pricing && !failed;
    const later = (width: string) => (
      <Skeleton className={`inline-block h-4 align-middle ${width}`} />
    );
    return (
      <dl className="flex flex-col bg-surface-2 text-sm">
        <div className={ROW}>
          <dt className="text-muted">{COPY.subtotal}</dt>
          <dd className={VALUE}>{money(units)}</dd>
        </div>
        <div className={ROW}>
          <dt className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-muted">
            {figures?.platform ? COPY.fees : COPY.networkFee}
            <SegmentedControl
              size="sm"
              label={COPY.whoPays}
              value={feesPaidBy}
              onValueChange={(by) => onClientPays(by === FEES_PAID_BY.client)}
              options={[
                { value: FEES_PAID_BY.owner, label: COPY.paidBy.owner },
                { value: FEES_PAID_BY.client, label: COPY.paidBy.client },
              ]}
              className="bg-line"
            />
          </dt>
          <dd className="text-right text-muted tabular-nums">
            {figures ? (
              <span className="whitespace-nowrap">
                {(clientPays ? COPY.feeAdded : COPY.feeTaken)(money(figures.fee))}
              </span>
            ) : pricingNow ? (
              later("w-20")
            ) : waiting ? null : (
              "—"
            )}
            {/* Always mounted, so a screen reader hears the line when it appears. Only a failure is shown. */}
            <span role="status" className={pricingNow ? "sr-only" : "block text-xs"}>
              {figures ? null : waiting}
            </span>
          </dd>
        </div>
        <div className={`${ROW} border-t border-line`}>
          <dt className="font-semibold text-ink">{COPY.clientPaysTotal}</dt>
          <dd className="text-right text-lg font-semibold whitespace-nowrap text-ink tabular-nums">
            {/* With the fee on the client's side and no quote, what the client pays is not known yet. */}
            {figures
              ? money(figures.pays)
              : clientPays && units > 0n
                ? pricingNow
                  ? later("h-5 w-24")
                  : "—"
                : money(units)}
          </dd>
        </div>
        <div className={ROW}>
          <dt className="text-muted">{COPY.youReceive}</dt>
          <dd className={VALUE}>
            {figures ? money(figures.receives) : pricingNow ? later("w-20") : "—"}
          </dd>
        </div>
      </dl>
    );
  }
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-line p-3 sm:p-4">
      <Switch
        label={COPY.clientPays}
        checked={clientPays}
        onCheckedChange={onClientPays}
        className="w-full flex-row-reverse justify-between font-medium text-ink"
      />
      {figures ? (
        <dl className="flex flex-col gap-1.5 text-sm">
          {[
            [figures.platform ? COPY.fees : COPY.networkFee, money(figures.fee)],
            ...(feeOnly
              ? []
              : [
                  [COPY.clientTotal, money(figures.pays)],
                  [COPY.youReceive, money(figures.receives)],
                ]),
          ].map(([term, value]) => (
            <div key={term} className="flex items-baseline justify-between gap-4">
              <dt className="text-muted">{term}</dt>
              <dd className="text-right text-ink tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
      ) : price === "" || current ? null : (
        <p role="status" className="text-sm text-muted">
          {waiting}
        </p>
      )}
    </div>
  );
}
