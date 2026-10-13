"use client";

import { Check, Copy } from "lucide-react";
import { useMemo } from "react";
import { highlight } from "sugar-high";
import { COPY_STATUS, useCopy } from "../../hooks/use-copy";

export interface CodeBlockProps {
  code: string;
  language: string;
  copyLabel?: string;
  copiedLabel?: string;
  failedLabel?: string;
}

export function CodeBlock({
  code,
  language,
  copyLabel = "Copy code",
  copiedLabel = "Copied",
  failedLabel = "Copy failed",
}: CodeBlockProps) {
  const [status, copy] = useCopy(code);
  const copied = status === COPY_STATUS.copied;
  const failed = status === COPY_STATUS.failed;
  const html = useMemo(() => highlight(code), [code]);
  return (
    <div
      data-theme="dark"
      className="overflow-hidden rounded-lg border border-line bg-sunken text-ink"
    >
      <div className="flex items-center justify-between border-b border-line px-4 py-2 text-xs text-subtle">
        <span className="font-mono">{language}</span>
        <button
          type="button"
          onClick={copy}
          className="relative inline-flex items-center gap-1.5 rounded-sm px-1.5 py-1 before:absolute before:-inset-2 hover:text-ink"
        >
          {copied ? (
            <Check aria-hidden className="size-[var(--fw-icon-sm)]" />
          ) : (
            <Copy aria-hidden className="size-[var(--fw-icon-sm)]" />
          )}
          {copied ? (
            copiedLabel
          ) : failed ? (
            failedLabel
          ) : (
            // Shows the original short "Copy"; screen readers hear what it copies.
            <>
              <span aria-hidden>Copy</span>
              <span className="sr-only">{copyLabel}</span>
            </>
          )}
        </button>
        <span role="status" className="sr-only">
          {copied ? copiedLabel : failed ? failedLabel : ""}
        </span>
      </div>
      {/* biome-ignore lint/a11y/useSemanticElements: a fieldset groups form controls; this names a scroll area */}
      <div
        role="group"
        // biome-ignore lint/a11y/noNoninteractiveTabindex: keyboard users scroll long lines sideways
        tabIndex={0}
        aria-label={`${language} code`}
        className="overflow-x-auto focus-visible:-outline-offset-2"
      >
        <pre className="fw-code p-4 font-mono text-sm leading-relaxed">
          {/* biome-ignore lint/security/noDangerouslySetInnerHtml: sugar-high escapes the code text and only adds its own span markup */}
          <code dangerouslySetInnerHTML={{ __html: html }} />
        </pre>
      </div>
    </div>
  );
}
