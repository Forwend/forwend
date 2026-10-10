"use client";

import { DURATION_MS } from "@forwend/design-tokens";
import * as RadixTooltip from "@radix-ui/react-tooltip";
import type { ReactNode } from "react";

export interface TooltipProps {
  content: string;
  children: ReactNode;
  side?: "top" | "right" | "bottom" | "left";
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
