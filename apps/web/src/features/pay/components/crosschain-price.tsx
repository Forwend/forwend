import { IconButton, Tooltip } from "@forwend/ui-web";
import { CircleHelp } from "lucide-react";
import { YouSend } from "@/features/pay/components/you-send";
import { ONECLICK_SLIPPAGE_BPS } from "@/features/pay/constants/crosschain";
import { PAY_COPY } from "@/features/pay/constants/pay-copy";
import {
  bufferLine,
  crossChainFeeUsd,
  priceProblem,
  sendUnits,
  slippageCoversRefundFee,
  usdPerToken,
} from "@/features/pay/lib/crosschain";
import type { CrossQuote } from "@/features/pay/types/crosschain";
import type { PayToken } from "@/features/pay/types/pay";
import { PoweredByNearIntents } from "@/shared/components/chains/near-intents";
import { LineSkeleton } from "@/shared/components/rows-skeleton";
import { FADE_IN } from "@/shared/constants/motion";
import { amountText } from "@/shared/lib/money";

const COPY = PAY_COPY.crossChain;

const PRICE_LINES = ["fee", "buffer", "refund", "time"] as const;

export interface CrossChainPriceProps {
  price: CrossQuote | undefined;
  loading: boolean;
  error: unknown;
  token: PayToken;
}

export function CrossChainPrice({ price, loading, error, token }: CrossChainPriceProps) {
  if (error) {
    return (
      <p role="alert" className="text-sm text-danger">
        {priceProblem(error)}
      </p>
    );
  }
  if (!price || loading) {
    return (
      <div className="flex flex-col gap-3">
        <span role="status" className="sr-only">
          {COPY.gettingPrice}
        </span>
        <div aria-hidden className="flex flex-col gap-1">
          <LineSkeleton size="text-xs" className="w-16" />
          <LineSkeleton size="text-3xl" className="w-48 max-w-full" />
        </div>
        <div aria-hidden className="flex flex-col gap-2 border-y border-line py-3">
          {PRICE_LINES.map((line) => (
            <div key={line} className="flex justify-between gap-4">
              <LineSkeleton size="text-sm" className="w-36" />
              <LineSkeleton size="text-sm" className="w-24" />
            </div>
          ))}
        </div>
        <LineSkeleton size="text-xs" className="mx-auto w-40" />
      </div>
    );
  }
  const amountIn = BigInt(price.amountIn);
  // Rounded as the deposit address's amount is.
  const sends = sendUnits(
    amountIn,
    token.decimals,
    usdPerToken(price.amountInUsd, amountIn, token.decimals),
  );
  const refundFee = /^\d+$/.test(price.refundFee) ? BigInt(price.refundFee) : 0n;
  const minutes = Math.max(1, Math.round(price.timeEstimate / 60));
  return (
    <YouSend
      className={FADE_IN}
      amount={
        <>
          {amountText(sends, token).slice(0, -token.symbol.length - 1)}{" "}
          <span className="text-unit text-muted">{token.symbol}</span>
        </>
      }
      rows={[
        {
          term: COPY.conversionFee,
          value: (
            <span className="inline-flex items-center">
              {COPY.feeApprox(crossChainFeeUsd(price).toFixed(2))}
              <Tooltip content={COPY.feeHint}>
                <IconButton label={COPY.feeHint} size="xs">
                  <CircleHelp aria-hidden className="size-3.5" />
                </IconButton>
              </Tooltip>
            </span>
          ),
        },
        {
          term: COPY.buffer(ONECLICK_SLIPPAGE_BPS / 100),
          value: bufferLine(sends, BigInt(price.minAmountIn), refundFee),
        },
        ...(refundFee > 0n
          ? [{ term: COPY.refundFeeRow, value: amountText(refundFee, token) }]
          : []),
        { term: COPY.arrivesIn, value: COPY.arrives(minutes) },
      ]}
    >
      {slippageCoversRefundFee(sends, BigInt(price.minAmountIn), refundFee) ? null : (
        <span className="text-xs text-warning">{COPY.slippageUnderFee}</span>
      )}
      <PoweredByNearIntents />
    </YouSend>
  );
}
