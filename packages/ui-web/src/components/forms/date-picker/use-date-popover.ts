import {
  type CSSProperties,
  type KeyboardEvent,
  type RefObject,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

const GAP = 6;
const UNPLACED: CSSProperties = { position: "fixed", top: 0, left: 0, opacity: 0 };
const EDGE = 8;

/** A date field's popover; closing it gives focus back to the trigger. */
export function useDatePopover() {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const popover = useRef<HTMLDivElement>(null);
  const position = usePopoverPosition(trigger, popover, open);

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);

  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape" && open) {
      // Only the calendar closes: a native dialog or sheet around it would close on Escape too.
      event.preventDefault();
      event.stopPropagation();
      close();
    }
  };
  const toggle = () => setOpen((o) => !o);
  return { open, toggle, close, onKeyDown, root, trigger, popover, position };
}

/** Fixed under the trigger, so a scrolling dialog never clips it; above when there is no room below. */
function usePopoverPosition(
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
