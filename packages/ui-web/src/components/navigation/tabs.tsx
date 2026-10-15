"use client";

import * as RadixTabs from "@radix-ui/react-tabs";
import type { ReactNode } from "react";

export interface TabItem {
  value: string;
  label: string;
  content: ReactNode;
  icon?: ReactNode;
}

export interface TabsProps {
  items: readonly TabItem[];
  label: string;
  defaultValue?: string;
}

export function Tabs({ items, label, defaultValue }: TabsProps) {
  return (
    <RadixTabs.Root defaultValue={defaultValue ?? items[0]?.value}>
      <RadixTabs.List
        aria-label={label}
        className="grid w-full grid-cols-2 gap-0.5 rounded-md border border-line bg-surface-2 p-0.5 sm:inline-flex sm:w-auto"
      >
        {items.map((item) => (
          <RadixTabs.Trigger
            key={item.value}
            value={item.value}
            className="relative inline-flex shrink-0 items-center justify-center gap-2 rounded-sm px-3.5 py-1.5 text-sm font-medium text-muted transition-colors duration-[var(--fw-duration-fast)] ease-out before:absolute before:inset-x-0 before:-inset-y-1 hover:text-ink data-[state=active]:bg-surface data-[state=active]:text-ink data-[state=active]:shadow-[0_0_0_1px_var(--fw-line)]"
          >
            {item.icon}
            {item.label}
          </RadixTabs.Trigger>
        ))}
      </RadixTabs.List>
      {items.map((item) => (
        <RadixTabs.Content key={item.value} value={item.value} className="mt-6">
          {item.content}
        </RadixTabs.Content>
      ))}
    </RadixTabs.Root>
  );
}
