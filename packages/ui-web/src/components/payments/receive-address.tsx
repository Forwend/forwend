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

// The full address in groups of four, so it can be read and checked against the sender's screen (a shortened one is
// what address-poisoning look-alikes copy), with a copy button that says what happened.
export function ReceiveAddress({
  address,
  label = "Receive address",
  copyLabel = "Copy address",
  copiedLabel = "Address copied",
  failedLabel = "Copy failed: select the address above",
}: ReceiveAddressProps) {
  const [status, copy] = useCopy(address);
  const hex = address.startsWith("0x") ? address.slice(2) : address;
  const groups = hex.match(/.{1,4}/g) ?? [];
  const text =
    status === COPY_STATUS.copied
      ? copiedLabel
      : status === COPY_STATUS.failed
        ? failedLabel
        : copyLabel;
  return (
    <div className="flex flex-col gap-3">
      <p className="sr-only">{label}</p>
      {/* Lines break only between groups. */}
      <p className="font-mono text-sm leading-relaxed text-ink select-all">
        {groups.map((g, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed positions within one address
          <span key={i} className="mr-[0.6ch] inline-block whitespace-nowrap">
            {i === 0 && hex !== address ? <span className="text-muted">0x</span> : null}
            {g}
          </span>
        ))}
      </p>
      <Button variant="secondary" onClick={copy} className="h-11">
        {status === COPY_STATUS.copied ? (
          <Check aria-hidden className="size-[var(--fw-icon-md)] text-success" />
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
