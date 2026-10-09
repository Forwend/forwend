"use client";

import { Check, Copy } from "lucide-react";
import { useMemo } from "react";
import { highlight } from "sugar-high";
import { COPY_STATUS } from "../constants/copy";
import { useCopy } from "../hooks/use-copy";
import type { CodeBlockProps } from "../types/ui/display";

export function CodeBlock({ code, language, copyLabel = "Copy code" }: CodeBlockProps) {
  const [status, copy] = useCopy(code);
  const copied = status === COPY_STATUS.copied;
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
          aria-label={copied ? "Copied" : copyLabel}
          className="inline-flex items-center gap-1.5 rounded-sm px-1.5 py-1 hover:text-ink"
        >
          {copied ? (
            <Check aria-hidden className="size-[var(--fw-icon-sm)]" />
          ) : (
            <Copy aria-hidden className="size-[var(--fw-icon-sm)]" />
          )}
          {copied ? "Copied" : status === COPY_STATUS.failed ? "Copy failed" : "Copy"}
        </button>
      </div>
      <pre className="fw-code overflow-x-auto p-4 font-mono text-sm leading-relaxed">
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: sugar-high escapes the code text and only adds its own span markup */}
        <code dangerouslySetInnerHTML={{ __html: html }} />
      </pre>
    </div>
  );
}
