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

// The whole address shows on one line, its ends standing out (R-78): a shortened one is what look-alikes copy.
// 42 characters at 0.6em are 25.2 times the size; 21px stay free for Chromium on Linux rounding each one up.
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
          {/* Adjacent spans: the text, a selection and Copy stay exactly the address. */}
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
