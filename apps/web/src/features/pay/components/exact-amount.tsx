"use client";

import { COPY_STATUS, formatTokenAmount, IconButton, Money, useCopy } from "@forwend/ui-web";
import { Check, Copy } from "lucide-react";
import { PAY_COPY as COPY } from "@/features/pay/constants/pay-copy";
import type { PayToken } from "@/features/pay/types/pay";
import { exactDigits } from "@/shared/lib/money";

export interface ExactAmountProps {
  amount: bigint;
  token: PayToken;
}

export function ExactAmount({ amount, token }: ExactAmountProps) {
  const fractionDigits = exactDigits(amount, token.decimals);
  const plain = formatTokenAmount({
    baseUnits: amount,
    decimals: token.decimals,
    fractionDigits,
  }).replaceAll(",", "");
  const [status, copy] = useCopy(plain);
  const label =
    status === COPY_STATUS.copied
      ? COPY.amountCopied
      : status === COPY_STATUS.failed
        ? COPY.copyAmountFailed
        : COPY.copyAmount;
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <span className="text-xs text-muted">{COPY.exactAmount}</span>
      <div className="flex items-center justify-between gap-2 rounded-md border border-field bg-surface py-1 pr-1 pl-3">
        <Money
          baseUnits={amount}
          decimals={token.decimals}
          fractionDigits={fractionDigits}
          token={token.symbol}
          className="min-w-0 text-base font-semibold break-all text-ink"
        />
        <IconButton label={label} title={label} onClick={copy}>
          {status === COPY_STATUS.copied ? (
            <Check aria-hidden className="size-[var(--fw-icon-sm)] text-success" />
          ) : (
            <Copy aria-hidden className="size-[var(--fw-icon-sm)]" />
          )}
        </IconButton>
      </div>
      <span role="status" className="sr-only">
        {status === COPY_STATUS.idle ? "" : label}
      </span>
    </div>
  );
}
