"use client";

import { Switch } from "@forwend/ui-web";
import { skipToken } from "@reduxjs/toolkit/query";
import { useEffect, useState } from "react";
import { useGetFeesQuery } from "@/features/invoices/api/invoices-api";
import { FEES_FORM_COPY as COPY } from "@/features/invoices/constants/invoices-copy";
import { decimalText, feeFigures } from "@/features/invoices/lib/invoices";
import type { FeeQuote } from "@/features/invoices/types/invoices";

// A quote waits until typing stops, so each keystroke asks nothing.
const QUOTE_WAIT_MS = 400;

export interface FeeSummaryProps {
  profileId: string;
  /** The price: in USD when the client chooses the token, else in base units of token on chainId. */
  any: boolean;
  chainId: number;
  token: string;
  units: bigint;
  decimals: number;
  clientPays: boolean;
  onClientPays: (clientPays: boolean) => void;
  /** The quote, for the preview. */
  onQuote: (quote: FeeQuote | undefined) => void;
  money: (units: bigint) => string;
}

/** R-227: who pays the network fee, and what the client pays and the owner receives, before the form saves. */
export function FeeSummary({
  profileId,
  any,
  chainId,
  token,
  units,
  decimals,
  clientPays,
  onClientPays,
  onQuote,
  money,
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
  const quote = useGetFeesQuery(
    asked === ""
      ? skipToken
      : any
        ? { profileId, amountUsd: asked.slice(4) }
        : { profileId, chainId, token, amount: asked.split(":")[2] ?? "" },
  );
  const current = asked === price ? quote.currentData : undefined;
  useEffect(() => onQuote(current), [current, onQuote]);
  const figures = feeFigures(current, decimals, clientPays);
  const range = ([low, high]: [bigint, bigint]) =>
    low === high ? money(low) : COPY.range(money(low), money(high));
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
            [COPY.networkFee, range(figures.fee)],
            [COPY.clientTotal, range(figures.pays)],
            [COPY.youReceive, range(figures.receives)],
          ].map(([term, value]) => (
            <div key={term} className="flex items-baseline justify-between gap-4">
              <dt className="text-muted">{term}</dt>
              <dd className="text-right text-ink tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
      ) : price === "" ? null : (
        <p role="status" className="text-sm text-muted">
          {quote.isError && asked === price ? COPY.failed : COPY.pricing}
        </p>
      )}
    </div>
  );
}
