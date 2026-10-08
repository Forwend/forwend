"use client";

import * as RadixTabs from "@radix-ui/react-tabs";
import * as RadixTooltip from "@radix-ui/react-tooltip";
import { Check, Copy, X } from "lucide-react";
import { useRef, useState } from "react";
import { BUTTON_VARIANTS } from "../constants/button";
import type { CodeBlockProps, DialogProps, TabsProps, TooltipProps } from "../types/ui/display";
import { Button } from "./button";

export function Tabs({ items, label, defaultValue }: TabsProps) {
  return (
    <RadixTabs.Root defaultValue={defaultValue ?? items[0]?.value}>
      <RadixTabs.List
        aria-label={label}
        className="grid w-full grid-cols-2 gap-1 rounded-lg border border-line bg-surface-2 p-1 sm:inline-flex sm:w-auto sm:rounded-pill"
      >
        {items.map((item) => (
          <RadixTabs.Trigger
            key={item.value}
            value={item.value}
            className="shrink-0 rounded-pill px-4 py-2 text-sm font-medium text-muted transition-colors duration-[var(--fw-duration-fast)] ease-out hover:text-ink data-[state=active]:bg-surface data-[state=active]:text-ink data-[state=active]:shadow-sm"
          >
            {item.label}
          </RadixTabs.Trigger>
        ))}
      </RadixTabs.List>
      {items.map((item) => (
        <RadixTabs.Content
          key={item.value}
          value={item.value}
          className="mt-6 focus-visible:outline-none"
        >
          {item.content}
        </RadixTabs.Content>
      ))}
    </RadixTabs.Root>
  );
}

export function Tooltip({ content, children }: TooltipProps) {
  return (
    <RadixTooltip.Provider delayDuration={200}>
      <RadixTooltip.Root>
        <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
        <RadixTooltip.Portal>
          <RadixTooltip.Content
            sideOffset={6}
            className="z-[var(--fw-z-overlay)] max-w-xs rounded-md bg-primary px-3 py-1.5 text-xs text-on-primary shadow-md"
          >
            {content}
            <RadixTooltip.Arrow className="fill-[var(--fw-primary)]" />
          </RadixTooltip.Content>
        </RadixTooltip.Portal>
      </RadixTooltip.Root>
    </RadixTooltip.Provider>
  );
}

export function Dialog({ triggerLabel, title, children, closeLabel = "Close" }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  return (
    <>
      <Button variant={BUTTON_VARIANTS.secondary} onClick={() => ref.current?.showModal()}>
        {triggerLabel}
      </Button>
      <dialog
        ref={ref}
        aria-label={title}
        className="m-auto w-[min(32rem,calc(100vw-2rem))] rounded-xl border border-line bg-surface p-0 text-ink shadow-lg backdrop:bg-[color-mix(in_oklab,var(--fw-ink)_40%,transparent)] backdrop:backdrop-blur-sm"
      >
        <div className="flex items-start justify-between gap-4 border-b border-line px-6 py-4">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button
            type="button"
            aria-label={closeLabel}
            onClick={() => ref.current?.close()}
            className="rounded-pill p-1 text-muted hover:bg-surface-2 hover:text-ink"
          >
            <X aria-hidden className="size-[var(--fw-icon-md)]" />
          </button>
        </div>
        <div className="px-6 py-5 text-muted">{children}</div>
      </dialog>
    </>
  );
}

export function useCopy(text: string): [boolean, () => Promise<void>] {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };
  return [copied, copy];
}

export function CodeBlock({ code, language, copyLabel = "Copy code" }: CodeBlockProps) {
  const [copied, copy] = useCopy(code);
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
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="overflow-x-auto p-4 font-mono text-sm leading-relaxed">
        <code>{code}</code>
      </pre>
    </div>
  );
}
