"use client";

import { Check, Copy } from "lucide-react";
import { COPY_STATUS, useCopy } from "../../hooks/use-copy";
import { IconButton } from "../buttons/icon-button";

export interface ReceiveAddressProps {
  address: string;
  label?: string;
  copyLabel?: string;
  copiedLabel?: string;
  failedLabel?: string;
}

// The start and end stand out, the part look-alikes match, with everything between them in a quieter color (R-78).
// The whole address always shows, on one line: a shortened one is what address-poisoning look-alikes copy. Its size
// follows the width it has (its own container): 42 characters of Geist Mono at 0.6em are 25.2 times the size, and
// where the browser draws each character on a whole pixel (Chromium on Linux) each can grow by half a pixel, so 21px
// stay free. A narrow field gives the address its full width and puts the copy icon beside the label. The adjacent
// spans keep the text, a selection and Copy exactly equal to the address.
const START = 6;
const END = 4;
export function ReceiveAddress({
  address,
  label = "Receive address",
  copyLabel = "Copy address",
  copiedLabel = "Address copied",
  failedLabel = "Copy failed: select the address",
}: ReceiveAddressProps) {
  const [status, copy] = useCopy(address);
  const text =
    status === COPY_STATUS.copied
      ? copiedLabel
      : status === COPY_STATUS.failed
        ? failedLabel
        : copyLabel;
  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 rounded-md border border-field bg-surface px-3 pt-1 pb-3">
      <p className="text-xs text-muted">{label}</p>
      <IconButton label={text} title={text} onClick={copy}>
        {status === COPY_STATUS.copied ? (
          <Check aria-hidden className="size-[var(--fw-icon-sm)] text-success" />
        ) : (
          <Copy aria-hidden className="size-[var(--fw-icon-sm)]" />
        )}
      </IconButton>
      <div className="@container col-span-2 min-w-0">
        <p
          data-address
          className="font-mono text-[length:clamp(0.625rem,calc((100cqi_-_21px)/25.2),1rem)] leading-6 break-all text-muted select-all"
        >
          <span className="font-medium text-ink">{address.slice(0, START)}</span>
          <span>{address.slice(START, address.length - END)}</span>
          <span className="font-medium text-ink">{address.slice(address.length - END)}</span>
        </p>
      </div>
      <p role="status" className="sr-only">
        {status === COPY_STATUS.idle ? "" : text}
      </p>
    </div>
  );
}
