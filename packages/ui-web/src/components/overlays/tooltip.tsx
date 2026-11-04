"use client";

import { DURATION_MS } from "@forwend/design-tokens";
import * as RadixTooltip from "@radix-ui/react-tooltip";
import { type ReactNode, useCallback, useRef, useState } from "react";

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
  // A tap fires pointer leave, then focus (which opens it), then click; so during a tap Radix's closes are ignored,
  // and the click sets the opposite of the state the tap began with.
  const tapped = useRef(false);
  const openAtTap = useRef(false);
  const focused = useRef(false);
  // Inside a modal <dialog> everything outside it is hidden behind it, so the hint opens in the dialog, as SelectField.
  const [dialog, setDialog] = useState<HTMLDialogElement | null>(null);
  const trigger = useCallback(
    (el: HTMLButtonElement | null) => setDialog(el?.closest("dialog") ?? null),
    [],
  );
  return (
    <RadixTooltip.Root
      open={open}
      onOpenChange={(next) => {
        // Bringing a keyboard-focused trigger into view must not dismiss its hint.
        if (next || (!tapped.current && !focused.current)) setOpen(next);
      }}
    >
      <RadixTooltip.Trigger
        ref={trigger}
        asChild
        onFocus={() => {
          focused.current = !tapped.current;
        }}
        onBlur={() => {
          focused.current = false;
          setOpen(false);
        }}
        onPointerDown={(event) => {
          focused.current = false;
          tapped.current = event.pointerType === "touch";
          openAtTap.current = open;
        }}
        // A touch that turns into a scroll ends with no click: it was not a tap.
        onPointerCancel={() => {
          tapped.current = false;
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
      <RadixTooltip.Portal container={dialog}>
        <RadixTooltip.Content
          onEscapeKeyDown={() => {
            focused.current = false;
            setOpen(false);
          }}
          onPointerDownOutside={() => {
            focused.current = false;
          }}
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
