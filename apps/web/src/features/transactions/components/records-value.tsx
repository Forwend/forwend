"use client";

import { Tooltip } from "@forwend/ui-web";
import { AGREED_CURRENCIES } from "@/features/invoices/constants/invoices";
import { formatDueDate } from "@/features/invoices/lib/invoices";
import { TRANSACTIONS_COPY as COPY } from "@/features/transactions/constants/transactions-copy";
import type { TransactionRecordsValue } from "@/features/transactions/types/transactions";

function formatRecordsValue(value: TransactionRecordsValue): string {
  const digits = AGREED_CURRENCIES[value.currency as keyof typeof AGREED_CURRENCIES];
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: value.currency,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(Number(value.amount));
}

export interface RecordsValueProps {
  value: TransactionRecordsValue;
}

// R-111.
export function RecordsValue({ value }: RecordsValueProps) {
  const rate = COPY.rateOf(formatDueDate(value.rateDate));
  const text = formatRecordsValue(value);
  return (
    <Tooltip content={rate}>
      <button
        type="button"
        aria-label={`${text}, ${rate}`}
        // On a touch screen a 44px band, at least as wide, takes the tap; the line keeps its size.
        className="relative rounded-sm text-xs whitespace-nowrap text-muted tabular-nums underline decoration-dotted underline-offset-2 outline-none before:absolute focus-visible:outline-2 focus-visible:outline-focus pointer-coarse:before:top-1/2 pointer-coarse:before:left-1/2 pointer-coarse:before:h-11 pointer-coarse:before:w-[max(100%,2.75rem)] pointer-coarse:before:-translate-x-1/2 pointer-coarse:before:-translate-y-1/2"
      >
        {text}
      </button>
    </Tooltip>
  );
}
