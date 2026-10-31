"use client";

import { COPY_STATUS, IconButton, iconButtonClasses, useCopy } from "@forwend/ui-web";
import { Check, Copy, ExternalLink } from "lucide-react";
import { COPY_VALUE_COPY as COPY } from "@/shared/constants/copy-value-copy";

export interface CopyValueProps {
  label: string;
  value: string;
  hint: string;
  /** The button's name for screen readers, which says what it copies. */
  copyLabel: string;
  /** A value that is an address: Open shows it in a new tab, named for screen readers. */
  open?: { label: string; name: string };
}

/** A read-only value in a field as tall as an input, with Copy (and Open, for an address) at its end. */
export function CopyValue({ label, value, hint, copyLabel, open }: CopyValueProps) {
  const [status, copy] = useCopy(value);
  const said =
    status === COPY_STATUS.copied ? COPY.copied : status === COPY_STATUS.failed ? COPY.failed : "";
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <p className="text-sm font-medium text-ink">{label}</p>
      <div className="flex h-10 min-w-0 items-center gap-0.5 rounded-md border border-line bg-surface-2 pr-1 pl-3 pointer-coarse:h-11">
        <code className="min-w-0 flex-1 truncate font-mono text-sm text-ink" title={value}>
          {value}
        </code>
        {open ? (
          <a
            href={value}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={open.name}
            title={open.label}
            className={iconButtonClasses()}
          >
            <ExternalLink aria-hidden className="size-[var(--fw-icon-sm)]" />
          </a>
        ) : null}
        <IconButton label={copyLabel} title={said || COPY.copy} onClick={() => void copy()}>
          {status === COPY_STATUS.copied ? (
            <Check aria-hidden className="size-[var(--fw-icon-sm)] text-success" />
          ) : (
            <Copy aria-hidden className="size-[var(--fw-icon-sm)]" />
          )}
        </IconButton>
      </div>
      <p className="text-sm text-muted">{hint}</p>
      <p role="status" className="sr-only">
        {said}
      </p>
    </div>
  );
}
