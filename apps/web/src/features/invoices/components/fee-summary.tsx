"use client";

import { Switch } from "@forwend/ui-web";
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
        // A refused price says why in its own field; only a quote that can't be had now is said here.
        <p role="status" className="text-sm text-muted">
          {failed
            ? (quote.error as { status?: unknown }).status === UNAVAILABLE
              ? COPY.failed
              : null
            : COPY.pricing}
        </p>
      )}
    </div>
  );
}
