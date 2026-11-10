"use client";

import { IconButton, Tooltip } from "@forwend/ui-web";
import { Info } from "lucide-react";
import { INVOICE_COPY as COPY } from "@/features/invoices/constants/invoices-copy";

export interface ConfirmingStatusProps {
  blocks?: number | null;
  total?: number | null;
  seconds?: number | null;
}

export function ConfirmingStatus({ blocks, total, seconds }: ConfirmingStatusProps) {
  const target = total != null && blocks != null ? Math.max(total, blocks) : 0;
  const done = Math.max(0, target - (blocks ?? 0));
  return (
    <span className="inline-flex items-center gap-1 text-sm text-muted">
      <span className="tabular-nums">{COPY.confirmingCount(done, target)}</span>
      <ConfirmingHint blocks={target === 0 ? blocks : null} seconds={seconds} />
    </span>
  );
}

/** The blocks and time left, in an info tooltip beside a confirming state. */
export function ConfirmingHint({ blocks, seconds }: Omit<ConfirmingStatusProps, "total">) {
  const hint = COPY.confirmingHint(seconds, blocks);
  return hint ? (
    <Tooltip content={hint}>
      <IconButton label={hint} size="xs">
        <Info aria-hidden className="size-3.5" />
      </IconButton>
    </Tooltip>
  ) : null;
}
