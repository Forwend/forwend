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
  // Radix opens tooltips on hover and focus, and closes them on the trigger's pointer leave and press. A tap fires
  // leave, then focus (which opens it), then click. So during a tap Radix's closes are ignored, and the click sets the
  // opposite of the state the tap began with; after the click a tap outside closes it as usual.
  const tapped = useRef(false);
  const openAtTap = useRef(false);
  return (
    <RadixTooltip.Root
      open={open}
      onOpenChange={(next) => {
        if (next || !tapped.current) setOpen(next);
      }}
    >
      <RadixTooltip.Trigger
        asChild
        onPointerDown={(event) => {
          tapped.current = event.pointerType === "touch";
          openAtTap.current = open;
        }}
        onClick={() => {
          if (!tapped.current) return;
          setOpen(!openAtTap.current);
          setTimeout(() => {
            tapped.current = false;
          });
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
