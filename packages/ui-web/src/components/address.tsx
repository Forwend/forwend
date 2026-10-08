"use client";

import { Check, Copy, ExternalLink } from "lucide-react";
import { shortAddress } from "../lib/address";
import type { AddressProps } from "../types/payments/display";
import { useCopy } from "./interactive";

export function Address({
  address,
  explorerHref,
  copyLabel = "Copy address",
  copiedLabel = "Address copied",
}: AddressProps) {
  const [copied, copy] = useCopy(address);
  return (
    <span className="inline-flex items-center gap-1 rounded-pill border border-line bg-surface py-1 pr-1 pl-3 text-sm">
      <span className="font-mono text-ink" title={address}>
        {shortAddress(address)}
      </span>
      <button
        type="button"
        onClick={copy}
        aria-label={copied ? copiedLabel : copyLabel}
        className="rounded-pill p-1.5 text-muted hover:bg-surface-2 hover:text-ink"
      >
        {copied ? (
          <Check aria-hidden className="size-[var(--fw-icon-sm)] text-success" />
        ) : (
          <Copy aria-hidden className="size-[var(--fw-icon-sm)]" />
        )}
      </button>
      {explorerHref ? (
        <a
          href={explorerHref}
          target="_blank"
          rel="noreferrer noopener"
          aria-label="View on block explorer"
          className="rounded-pill p-1.5 text-muted hover:bg-surface-2 hover:text-ink"
        >
          <ExternalLink aria-hidden className="size-[var(--fw-icon-sm)]" />
        </a>
      ) : null}
    </span>
  );
}
