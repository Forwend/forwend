"use client";

import { Check, Copy } from "lucide-react";
import { COPY_STATUS, useCopy } from "../../hooks/use-copy";
import { Button } from "../buttons/button";
import { SwapLabel } from "../buttons/swap-label";

export interface ReceiveAddressProps {
  address: string;
  label?: string;
  copyLabel?: string;
  copiedLabel?: string;
  failedLabel?: string;
  /** The button's own words; its accessible name is the full copy label. */
  copyShort?: string;
  copiedShort?: string;
}

// The start and end stand out, the part look-alikes match, with everything between them in a quieter color (R-78). A
// wide field shows the whole address; a narrow one (a phone, a modal) shows the ends with four more characters each and
// keeps the middle for screen readers, selection and Copy. The parts are adjacent spans with nothing between them, so
// the text is the address. Both the choice and the size follow the width the text has (its own container), not the
// screen, so it never wraps: 42 characters need 21rem to stay at least 0.75rem, 19 fill less (Geist Mono is 0.6em a
// character).
const START = 6;
const END = 4;
const PHONE_EXTRA = 4;
export function ReceiveAddress({
  address,
  label = "Receive address",
  copyLabel = "Copy address",
  copiedLabel = "Address copied",
  failedLabel = "Copy failed: select the address",
  copyShort = "Copy",
  copiedShort = "Copied",
}: ReceiveAddressProps) {
  const [status, copy] = useCopy(address);
  const text =
    status === COPY_STATUS.copied
      ? copiedLabel
      : status === COPY_STATUS.failed
        ? failedLabel
        : copyLabel;
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-xs text-muted">{label}</p>
      <div className="flex items-center gap-2 rounded-md border border-line-strong bg-surface py-1.5 pr-1.5 pl-3">
        <div className="@container min-w-0 flex-1">
          <p
            data-address
            className="font-mono text-[length:clamp(0.875rem,calc(100cqi/12),1.0625rem)] leading-6 break-all text-muted select-all @min-[21rem]:text-[length:clamp(0.75rem,calc(100cqi/25.5),1rem)]"
          >
            <span className="font-medium text-ink">{address.slice(0, START)}</span>
            <span>{address.slice(START, START + PHONE_EXTRA)}</span>
            <span className="@max-[21rem]:sr-only">
              {address.slice(START + PHONE_EXTRA, address.length - END - PHONE_EXTRA)}
            </span>
            <span className="@max-[21rem]:before:content-['…']">
              {address.slice(address.length - END - PHONE_EXTRA, address.length - END)}
            </span>
            <span className="font-medium text-ink">{address.slice(address.length - END)}</span>
          </p>
        </div>
        <Button size="sm" variant="secondary" onClick={copy} aria-label={text} className="shrink-0">
          {status === COPY_STATUS.copied ? (
            <Check aria-hidden className="size-[var(--fw-icon-sm)]" />
          ) : (
            <Copy aria-hidden className="size-[var(--fw-icon-sm)]" />
          )}
          <SwapLabel
            labels={[copyShort, copiedShort]}
            active={status === COPY_STATUS.copied ? copiedShort : copyShort}
          />
        </Button>
      </div>
      <p role="status" className="sr-only">
        {status === COPY_STATUS.idle ? "" : text}
      </p>
    </div>
  );
}
