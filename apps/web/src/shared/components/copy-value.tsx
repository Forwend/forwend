"use client";

import { Button, COPY_STATUS, useCopy } from "@forwend/ui-web";
import { Check, Copy } from "lucide-react";
import { COPY_VALUE_COPY as COPY } from "@/shared/constants/copy-value-copy";

export interface CopyValueProps {
  label: string;
  value: string;
  hint: string;
  /** The button's name for screen readers, which says what it copies. */
  copyLabel: string;
}

/** A value shown in full, as code, with a Copy button that says when it copied. */
export function CopyValue({ label, value, hint, copyLabel }: CopyValueProps) {
  const [status, copy] = useCopy(value);
  const said =
    status === COPY_STATUS.copied ? COPY.copied : status === COPY_STATUS.failed ? COPY.failed : "";
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <p className="text-sm font-medium text-ink">{label}</p>
      <div className="flex min-w-0 items-center gap-2">
        <code className="min-w-0 truncate font-mono text-sm text-ink" title={value}>
          {value}
        </code>
        <Button size="sm" variant="secondary" onClick={() => void copy()}>
          {status === COPY_STATUS.copied ? (
            <Check aria-hidden className="size-[var(--fw-icon-sm)]" />
          ) : (
            <Copy aria-hidden className="size-[var(--fw-icon-sm)]" />
          )}
          <span aria-hidden>{said || COPY.copy}</span>
          <span className="sr-only">{copyLabel}</span>
        </Button>
      </div>
      <p className="text-sm text-muted">{hint}</p>
      <p role="status" className="sr-only">
        {said}
      </p>
    </div>
  );
}
