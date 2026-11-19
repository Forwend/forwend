"use client";

import { AmountField, Button, formatTokenAmount, Skeleton } from "@forwend/ui-web";
import type { FormEvent } from "react";
import { FEE_DECIMALS } from "@/features/send/constants/send";
import { SEND_COPY } from "@/features/send/constants/send-copy";
import { feeLabel, maxAmount } from "@/features/send/lib/send";
import type { SendOption } from "@/features/send/types/send";
import { MoneyChip } from "@/shared/components/chains/money-chip";
import { exactDigits } from "@/shared/lib/money";

export interface SendAmountStepProps {
  option: SendOption;
  amount: string;
  error: string | null;
  /** The network fee in the token's base units; null until read. */
  fee: bigint | null;
  feeFailed: boolean;
  /** What Max may send: the balance less the fee; null until the fee is known. */
  room: bigint | null;
  preparing: boolean;
  onAmount: (amount: string) => void;
  onSubmit: (event: FormEvent) => void;
}

export function SendAmountStep({
  option,
  amount,
  error,
  fee,
  feeFailed,
  room,
  preparing,
  onAmount,
  onSubmit,
}: SendAmountStepProps) {
  return (
    <form noValidate onSubmit={onSubmit} className="flex flex-col gap-6">
      <div className="flex flex-col items-center gap-4 pt-2">
        <MoneyChip chainId={option.chainId} symbol={option.symbol} />
        <AmountField
          bare
          label={SEND_COPY.amount}
          unit={option.symbol}
          placeholder="0"
          value={amount}
          autoFocus
          onChange={(e) => onAmount(e.target.value)}
          error={error ?? undefined}
        />
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted tabular-nums">
            {/* Cut, never rounded up: the wallet never seems to hold more than it does. */}
            {SEND_COPY.available(
              `${formatTokenAmount({
                baseUnits: option.balance,
                decimals: option.decimals,
                fractionDigits: Math.min(
                  exactDigits(option.balance, option.decimals),
                  FEE_DECIMALS,
                ),
              })} ${option.symbol}`,
            )}
          </span>
          <Button
            size="sm"
            variant="secondary"
            disabled={room === null}
            onClick={() => {
              if (room !== null) onAmount(maxAmount(room, option.decimals));
            }}
          >
            {SEND_COPY.max}
          </Button>
        </div>
      </div>
      <div className="flex items-center justify-between gap-3 border-t border-line pt-4 text-sm">
        <span className="text-muted">{SEND_COPY.networkFee}</span>
        <span className="font-medium text-ink tabular-nums">
          {fee === null ? (
            feeFailed ? (
              SEND_COPY.feeAtReview
            ) : (
              <Skeleton className="inline-block h-4 w-20 align-middle" />
            )
          ) : (
            feeLabel(fee, option)
          )}
        </span>
      </div>
      <Button type="submit" className="w-full" loading={preparing}>
        {SEND_COPY.continue}
      </Button>
    </form>
  );
}
