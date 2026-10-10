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
}

// The whole address stays visible: a shortened one is what address-poisoning look-alikes copy. Its start and end, the
// parts people compare with the sender's screen, are set darker.
export function ReceiveAddress({
  address,
  label = "Receive address",
  copyLabel = "Copy address",
  copiedLabel = "Address copied",
  failedLabel = "Copy failed: select the address above",
}: ReceiveAddressProps) {
  const [status, copy] = useCopy(address);
  const head = address.slice(0, 6);
  const middle = address.slice(6, -4);
  const tail = address.slice(-4);
  const text =
    status === COPY_STATUS.copied
      ? copiedLabel
      : status === COPY_STATUS.failed
        ? failedLabel
        : copyLabel;
  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-md border border-line bg-surface px-4 py-3">
        <p className="text-xs text-muted">{label}</p>
        <p className="mt-1 font-mono text-sm leading-6 break-all text-muted select-all">
          <span className="font-medium text-ink">{head}</span>
          {middle}
          <span className="font-medium text-ink">{tail}</span>
        </p>
      </div>
      <Button onClick={copy} className="h-11">
        {status === COPY_STATUS.copied ? (
          <Check aria-hidden className="size-[var(--fw-icon-md)]" />
        ) : (
          <Copy aria-hidden className="size-[var(--fw-icon-md)]" />
        )}
        {text}
      </Button>
      <p role="status" className="sr-only">
        {status === COPY_STATUS.idle ? "" : text}
      </p>
    </div>
  );
}
