"use client";

import { COPY_STATUS, IconButton, useCopy } from "@forwend/ui-web";
import { Check, Copy } from "lucide-react";
import { STORES_COPY as COPY } from "@/features/stores/constants/stores-copy";
import { COPY_VALUE_COPY } from "@/shared/constants/copy-value-copy";

export interface ProjectIdProps {
  storeId: string;
}

/** The store's project ID (D-31) inline in a line of text, with a copy icon that says when it copied. */
export function ProjectId({ storeId }: ProjectIdProps) {
  const [status, copy] = useCopy(storeId);
  const said =
    status === COPY_STATUS.copied
      ? COPY_VALUE_COPY.copied
      : status === COPY_STATUS.failed
        ? COPY_VALUE_COPY.failed
        : "";
  return (
    <span className="inline-flex min-w-0 max-w-full items-center gap-1.5">
      <span className="shrink-0">{COPY.projectId}</span>
      <code className="min-w-0 truncate font-mono text-xs text-ink" title={storeId}>
        {storeId}
      </code>
      <IconButton
        label={COPY.copyLabel}
        title={COPY.copyLabel}
        size="xs"
        onClick={() => void copy()}
      >
        {status === COPY_STATUS.copied ? (
          <Check aria-hidden className="size-[var(--fw-icon-sm)]" />
        ) : (
          <Copy aria-hidden className="size-[var(--fw-icon-sm)]" />
        )}
      </IconButton>
      <span role="status" className="sr-only">
        {said}
      </span>
    </span>
  );
}
