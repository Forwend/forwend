"use client";

import { Button, buttonClasses, COPY_STATUS, useCopy } from "@forwend/ui-web";
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

/** A value shown as code on its own row, with a Copy button that says when it copied and, for an address, Open. */
export function CopyValue({ label, value, hint, copyLabel, open }: CopyValueProps) {
  const [status, copy] = useCopy(value);
  const said =
    status === COPY_STATUS.copied ? COPY.copied : status === COPY_STATUS.failed ? COPY.failed : "";
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <p className="text-sm font-medium text-ink">{label}</p>
      {/* The value has its own row, so a long address is never squeezed beside the buttons. */}
      <code
        className="block min-w-0 truncate rounded-md bg-surface-2 px-3 py-2 font-mono text-sm text-ink"
        title={value}
      >
        {value}
      </code>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="secondary" onClick={() => void copy()}>
          {status === COPY_STATUS.copied ? (
            <Check aria-hidden className="size-[var(--fw-icon-sm)]" />
          ) : (
            <Copy aria-hidden className="size-[var(--fw-icon-sm)]" />
          )}
          <span aria-hidden>{said || COPY.copy}</span>
          <span className="sr-only">{copyLabel}</span>
        </Button>
        {open ? (
          <a
            href={value}
            target="_blank"
            rel="noopener noreferrer"
            className={buttonClasses({ variant: "secondary", size: "sm" })}
          >
            <ExternalLink aria-hidden className="size-[var(--fw-icon-sm)]" />
            <span aria-hidden>{open.label}</span>
            <span className="sr-only">{open.name}</span>
          </a>
        ) : null}
      </div>
      <p className="text-sm text-muted">{hint}</p>
      <p role="status" className="sr-only">
        {said}
      </p>
    </div>
  );
}
