"use client";

import { DURATION_MS } from "@forwend/design-tokens";
import * as RadixTooltip from "@radix-ui/react-tooltip";
import { type ReactNode, useRef, useState } from "react";

export interface TooltipProps {
  content: string;
  children: ReactNode;
  side?: "top" | "right" | "bottom" | "left";
}

export interface TooltipProviderProps {
  children: ReactNode;
}

// Mounted once around the app, so after one tooltip opens the next one opens at once while the pointer moves along.
export function TooltipProvider({ children }: TooltipProviderProps) {
  return (
    <RadixTooltip.Provider delayDuration={DURATION_MS.base} skipDelayDuration={DURATION_MS.slow}>
      {children}
    </RadixTooltip.Provider>
  );
}

export function Tooltip({ content, children, side = "top" }: TooltipProps) {
  const [open, setOpen] = useState(false);
  // Radix opens tooltips on hover and focus only, and closes them on every press of the trigger. A tap opens this one,
  // so touch users can read it too; a second tap or a tap outside closes it.
  const tapped = useRef(false);
  return (
    <RadixTooltip.Root
      open={open}
      onOpenChange={(next) => {
        if (next || !tapped.current) setOpen(next);
        tapped.current = false;
      }}
    >
      <RadixTooltip.Trigger
        asChild
        onPointerDown={(event) => {
          tapped.current = event.pointerType === "touch";
        }}
        onClick={() => {
          if (tapped.current) setOpen(true);
        }}
      >
        {children}
      </RadixTooltip.Trigger>
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
  );
}
