import { type CSSProperties, type RefObject, useLayoutEffect, useState } from "react";

const GAP = 6;
const UNPLACED: CSSProperties = { position: "fixed", top: 0, left: 0, opacity: 0 };
const EDGE = 8;

/**
 * Places a popover under its trigger by the viewport, so a scrolling dialog or panel never clips it: fixed, it
 * leaves their overflow (a dialog has no transform). Near the right edge it moves left; with no room below, it opens
 * above. It follows scrolling and resizing while open.
 */
export function usePopoverPosition(
  trigger: RefObject<HTMLElement | null>,
  popover: RefObject<HTMLElement | null>,
  open: boolean,
): CSSProperties {
  // Transparent, not hidden, until placed: the calendar inside takes focus as it opens, and a hidden one can't.
  const [style, setStyle] = useState<CSSProperties>(UNPLACED);
  useLayoutEffect(() => {
    if (!open) {
      setStyle(UNPLACED);
      return;
    }
    const place = () => {
      const anchor = trigger.current?.getBoundingClientRect();
      const box = popover.current?.getBoundingClientRect();
      if (!anchor || !box) return;
      const left = Math.max(EDGE, Math.min(anchor.left, window.innerWidth - box.width - EDGE));
      const below = anchor.bottom + GAP;
      const top =
        below + box.height <= window.innerHeight - EDGE
          ? below
          : Math.max(EDGE, anchor.top - GAP - box.height);
      setStyle({ position: "fixed", top, left });
    };
    place();
    window.addEventListener("resize", place);
    // Capture: a scroll inside a dialog or panel moves the trigger too.
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, trigger, popover]);
  return style;
}
