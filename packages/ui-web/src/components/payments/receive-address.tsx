"use client";

import { Check, Copy } from "lucide-react";
import { Fragment } from "react";
import { COPY_STATUS, useCopy } from "../../hooks/use-copy";
import { cx } from "../../lib/cx";
import { Button } from "../buttons/button";

export interface ReceiveAddressProps {
  address: string;
  label?: string;
  copyLabel?: string;
  copiedLabel?: string;
  failedLabel?: string;
}

// The whole address stays visible: a shortened one is what address-poisoning look-alikes copy. It reads in groups of 4
// so the payer can compare all of it, not only the ends a look-alike matches (R-78); the start and end stay darker.
// The groups are inline spans with no text between them and <wbr> break points, so selecting, copying and screen
// readers still get the one address.
export function ReceiveAddress({
  address,
  label = "Receive address",
  copyLabel = "Copy address",
  copiedLabel = "Address copied",
  failedLabel = "Copy failed: select the address above",
}: ReceiveAddressProps) {
  const [status, copy] = useCopy(address);
  const groups = [address.slice(0, 6), ...(address.slice(6).match(/.{1,4}/g) ?? [])];
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
        <p data-address className="mt-1 font-mono text-sm leading-6 text-muted select-all">
          {groups.map((group, i) => (
            <Fragment key={group + String(i)}>
              {i > 0 ? <wbr /> : null}
              <span
                className={cx(
                  i < groups.length - 1 && "mr-1.5",
                  (i === 0 || i === groups.length - 1) && "font-medium text-ink",
                )}
              >
                {group}
              </span>
            </Fragment>
          ))}
        </p>
      </div>
      <Button onClick={copy} className="h-auto min-h-11 whitespace-normal py-2 text-center">
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
