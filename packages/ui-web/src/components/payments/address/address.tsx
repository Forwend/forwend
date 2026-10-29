"use client";

import { AlertTriangle, Check, Copy, ExternalLink } from "lucide-react";
import { useId } from "react";
import { COPY_STATUS, useCopy } from "../../../hooks/use-copy";
import { cx } from "../../../lib/cx";
import { shortAddress } from "./short-address";

export interface AddressProps {
  address: string;
  explorerHref?: string;
  copyLabel?: string;
  copiedLabel?: string;
  failedLabel?: string;
  explorerLabel?: string;
}

export function Address({
  address,
  explorerHref,
  copyLabel = "Copy address",
  copiedLabel = "Address copied",
  failedLabel = "Copy failed: select the address instead",
  explorerLabel = "View on block explorer (opens in new tab)",
}: AddressProps) {
  const [status, copy] = useCopy(address);
  const fullId = useId();
  const copied = status === COPY_STATUS.copied;
  const failed = status === COPY_STATUS.failed;
  return (
    <span className="inline-flex max-w-full items-center gap-1 rounded-md border border-line bg-surface py-1 pr-1 pl-3 text-sm">
      <span
        className={cx("min-w-0 font-mono text-ink", failed && "break-all select-all")}
        title={address}
      >
        {failed ? address : shortAddress(address)}
      </span>
      <span id={fullId} className="sr-only">
        {address}
      </span>
      <button
        type="button"
        onClick={copy}
        aria-label={copied ? copiedLabel : failed ? failedLabel : copyLabel}
        aria-describedby={fullId}
        className="relative shrink-0 rounded-pill p-1.5 text-muted before:absolute before:-inset-x-0.5 before:-inset-y-2 hover:bg-surface-2 hover:text-ink"
      >
        {copied ? (
          <Check aria-hidden className="size-[var(--fw-icon-sm)] text-success" />
        ) : failed ? (
          <AlertTriangle aria-hidden className="size-[var(--fw-icon-sm)] text-danger" />
        ) : (
          <Copy aria-hidden className="size-[var(--fw-icon-sm)]" />
        )}
      </button>
      {explorerHref ? (
        <a
          href={explorerHref}
          target="_blank"
          rel="noreferrer noopener"
          aria-label={explorerLabel}
          className="relative shrink-0 rounded-pill p-1.5 text-muted before:absolute before:-inset-x-0.5 before:-inset-y-2 hover:bg-surface-2 hover:text-ink"
        >
          <ExternalLink aria-hidden className="size-[var(--fw-icon-sm)]" />
        </a>
      ) : null}
      <span role="status" className="sr-only">
        {copied ? copiedLabel : failed ? failedLabel : ""}
      </span>
    </span>
  );
}
