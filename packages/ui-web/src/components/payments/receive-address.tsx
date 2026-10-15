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

// The start and end stand out, the part look-alikes match, with everything between them in a quieter color (R-78).
// The whole address always shows, on one line: a shortened one is what address-poisoning look-alikes copy. Its size
// follows the width it has (its own container; 42 characters of Geist Mono at 0.6em need 25.5 times the size), so a
// narrow field (a phone, a modal) moves Copy under it to give it the full width. Only below about 10px a character
// would it wrap. The parts are adjacent spans with nothing between them, so the text, a selection and Copy are the
// address.
const START = 6;
const END = 4;
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
    <div className="@container/address flex flex-col gap-1.5">
      <p className="text-xs text-muted">{label}</p>
      <div className="flex flex-col gap-2 rounded-md border border-line-strong bg-surface p-2 @min-[26rem]/address:flex-row @min-[26rem]/address:items-center @min-[26rem]/address:py-1.5 @min-[26rem]/address:pr-1.5 @min-[26rem]/address:pl-3">
        <div className="@container min-w-0 flex-1 px-1 @min-[26rem]/address:px-0">
          <p
            data-address
            className="font-mono text-[length:clamp(0.625rem,calc(100cqi/25.5),1rem)] leading-6 break-all text-muted select-all"
          >
            <span className="font-medium text-ink">{address.slice(0, START)}</span>
            <span>{address.slice(START, address.length - END)}</span>
            <span className="font-medium text-ink">{address.slice(address.length - END)}</span>
          </p>
        </div>
        <Button
          size="sm"
          variant="secondary"
          onClick={copy}
          aria-label={text}
          className="w-full shrink-0 @min-[26rem]/address:w-auto"
        >
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
