"use client";

import { Check, Copy } from "lucide-react";
import { COPY_STATUS, useCopy } from "../../hooks/use-copy";
import { IconButton } from "../buttons/icon-button";

export interface ReceiveAddressProps {
  address: string;
  label?: string;
}

// Never shortened: look-alikes copy the ends. 25.2 = 42 chars at 0.6em; 21px spare for Chromium's rounding.
const START = 6;
const END = 4;
export function ReceiveAddress({ address, label = "Receive address" }: ReceiveAddressProps) {
  const [status, copy] = useCopy(address);
  const text =
    status === COPY_STATUS.copied
      ? "Address copied"
      : status === COPY_STATUS.failed
        ? "Copy failed: select the address"
        : "Copy address";
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
