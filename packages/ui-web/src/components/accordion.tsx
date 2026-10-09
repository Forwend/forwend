"use client";

import * as RadixAccordion from "@radix-ui/react-accordion";
import { ChevronDown } from "lucide-react";
import type { AccordionProps } from "../types/ui/display";

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
