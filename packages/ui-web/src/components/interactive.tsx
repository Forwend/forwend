"use client";

import { DURATION_MS } from "@forwend/design-tokens";
import * as RadixAccordion from "@radix-ui/react-accordion";
import * as RadixTabs from "@radix-ui/react-tabs";
import * as RadixTooltip from "@radix-ui/react-tooltip";
import { Check, ChevronDown, Copy, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { highlight } from "sugar-high";
import { BUTTON_VARIANTS } from "../constants/button";
import { COPIED_LABEL_MS } from "../constants/timing";
import type {
  AccordionProps,
  CodeBlockProps,
  DialogProps,
  TabsProps,
  TooltipProps,
} from "../types/ui/display";
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
            className="inline-flex shrink-0 items-center justify-center gap-2 rounded-pill px-4 py-2 text-sm font-medium text-muted transition-colors duration-[var(--fw-duration-fast)] ease-out hover:text-ink data-[state=active]:bg-surface data-[state=active]:text-ink data-[state=active]:shadow-sm"
          >
            {item.icon}
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

// One item open at a time; opening another closes it. Height animates (instant under reduced motion).
export function Accordion({ items }: AccordionProps) {
  return (
    <RadixAccordion.Root
      type="single"
      collapsible
      className="divide-y divide-line border-y border-line"
    >
      {items.map((item) => (
        <RadixAccordion.Item key={item.question} value={item.question}>
          <RadixAccordion.Header>
            <RadixAccordion.Trigger className="group flex w-full items-center justify-between gap-6 py-5 text-left text-lg font-medium text-ink transition-colors duration-[var(--fw-duration-fast)] hover:text-accent">
              {item.question}
              <ChevronDown
                aria-hidden
                className="size-[var(--fw-icon-md)] shrink-0 text-subtle transition-transform duration-[var(--fw-duration-base)] ease-out group-data-[state=open]:rotate-180"
              />
            </RadixAccordion.Trigger>
          </RadixAccordion.Header>
          <RadixAccordion.Content className="overflow-hidden data-[state=closed]:animate-[fw-accordion-up_var(--fw-duration-base)_var(--fw-ease-out)] data-[state=open]:animate-[fw-accordion-down_var(--fw-duration-base)_var(--fw-ease-out)]">
            <div className="max-w-prose pb-6 text-muted">{item.answer}</div>
          </RadixAccordion.Content>
        </RadixAccordion.Item>
      ))}
    </RadixAccordion.Root>
  );
}

export function Tooltip({ content, children, side = "top" }: TooltipProps) {
  return (
    <RadixTooltip.Provider delayDuration={DURATION_MS.base}>
      <RadixTooltip.Root>
        <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
        <RadixTooltip.Portal>
          <RadixTooltip.Content
            side={side}
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
        className="m-auto w-[calc(100vw-(--spacing(8)))] max-w-lg rounded-lg border border-line bg-surface p-0 text-ink shadow-lg backdrop:bg-[color-mix(in_oklab,var(--fw-ink)_40%,transparent)] backdrop:backdrop-blur-glass"
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
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Clipboard blocked (permissions, insecure context): keep the "Copy" label, nothing copied.
      return;
    }
    setCopied(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), COPIED_LABEL_MS);
  };
  return [copied, copy];
}

export function CodeBlock({ code, language, copyLabel = "Copy code" }: CodeBlockProps) {
  const [copied, copy] = useCopy(code);
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
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="fw-code overflow-x-auto p-4 font-mono text-sm leading-relaxed">
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: sugar-high escapes the code text and only adds its own span markup */}
        <code dangerouslySetInnerHTML={{ __html: html }} />
      </pre>
    </div>
  );
}
