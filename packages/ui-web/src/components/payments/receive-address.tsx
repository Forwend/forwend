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

// The whole address stays visible: a shortened one is what address-poisoning look-alikes copy (R-78). It is one plain
// string, as wallets show it, so selecting it by hand gives exactly the address; Copy sits in the same field.
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
          className="min-w-0 flex-1 font-mono text-sm leading-6 break-all text-ink select-all"
        >
          {address}
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
