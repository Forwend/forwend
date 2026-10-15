"use client";

import { Check, Copy } from "lucide-react";
import { COPY_STATUS, useCopy } from "../../hooks/use-copy";
import { Button } from "../buttons/button";

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

// The start and end stand out, the part look-alikes match, with everything between them in a quieter color (R-78). Wide
// screens show the whole address; phones show the ends with four more characters each and keep the middle for screen
// readers, selection and Copy. The parts are adjacent spans with nothing between them, so the text is the address.
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
        <p
          data-address
          className="min-w-0 flex-1 font-mono text-sm leading-6 break-all text-muted select-all"
        >
          <span className="font-semibold text-ink">{address.slice(0, START)}</span>
          <span>{address.slice(START, START + PHONE_EXTRA)}</span>
          <span className="max-sm:sr-only">
            {address.slice(START + PHONE_EXTRA, address.length - END - PHONE_EXTRA)}
          </span>
          <span className="max-sm:before:content-['…']">
            {address.slice(address.length - END - PHONE_EXTRA, address.length - END)}
          </span>
          <span className="font-semibold text-ink">{address.slice(address.length - END)}</span>
        </p>
        <Button size="sm" variant="secondary" onClick={copy} aria-label={text} className="shrink-0">
          {status === COPY_STATUS.copied ? (
            <Check aria-hidden className="size-[var(--fw-icon-sm)]" />
          ) : (
            <Copy aria-hidden className="size-[var(--fw-icon-sm)]" />
          )}
          {status === COPY_STATUS.copied ? copiedShort : copyShort}
        </Button>
      </div>
      <p role="status" className="sr-only">
        {status === COPY_STATUS.idle ? "" : text}
      </p>
    </div>
  );
}
