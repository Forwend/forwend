"use client";

import { X } from "lucide-react";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { cx } from "../../lib/cx";
import { TONE_DOT_CLASSES, TONES, type Tone } from "../../lib/tone";

export const TOAST_MS = 5_000;
const MAX_TOASTS = 3;

export interface ToastProps {
  tone?: Tone;
  title: string;
  description?: string;
  onClose?: () => void;
  closeLabel?: string;
}

export function Toast({
  tone = TONES.neutral,
  title,
  description,
  onClose,
  closeLabel = "Close",
}: ToastProps) {
  return (
    <div className="flex w-full max-w-sm items-start gap-3 rounded-lg border border-line bg-surface p-4 shadow-lg">
      <span
        aria-hidden
        className={cx("mt-1.5 size-2 shrink-0 rounded-pill", TONE_DOT_CLASSES[tone])}
      />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-ink">{title}</span>
        {description ? (
          <span className="mt-0.5 block text-sm text-muted">{description}</span>
        ) : null}
      </span>
      {onClose ? (
        <button
          type="button"
          aria-label={closeLabel}
          onClick={onClose}
          className="relative -my-2 -mr-2 grid size-9 shrink-0 place-items-center rounded-pill text-muted outline-none before:absolute before:-inset-1 hover:bg-surface-2 hover:text-ink focus-visible:outline-2 focus-visible:outline-focus"
        >
          <X aria-hidden className="size-[var(--fw-icon-sm)]" />
        </button>
      ) : null}
    </div>
  );
}

export type ToastMessage = Pick<ToastProps, "tone" | "title" | "description">;

const ShowToast = createContext<((toast: ToastMessage) => void) | null>(null);

export function useToast() {
  const show = useContext(ShowToast);
  if (!show) throw new Error("useToast is used outside a ToastProvider");
  return show;
}

export interface ToastProviderProps {
  children: ReactNode;
  label?: string;
  closeLabel?: string;
  className?: string;
}

export function ToastProvider({
  children,
  label = "Notifications",
  closeLabel = "Close notification",
  className,
}: ToastProviderProps) {
  const [toasts, setToasts] = useState<(ToastMessage & { id: number })[]>([]);
  const lastId = useRef(0);
  const show = useCallback((toast: ToastMessage) => {
    lastId.current += 1;
    const id = lastId.current;
    setToasts((shown) => [...shown, { ...toast, id }].slice(-MAX_TOASTS));
  }, []);
  const close = useCallback(
    (id: number) => setToasts((shown) => shown.filter((toast) => toast.id !== id)),
    [],
  );

  return (
    <ShowToast.Provider value={show}>
      {children}
      <section
        aria-label={label}
        className={cx(
          "pointer-events-none fixed inset-x-4 bottom-4 z-[var(--fw-z-toast)] sm:left-auto sm:w-sm lg:top-4 lg:bottom-auto",
          className,
        )}
      >
        <ol aria-live="polite" className="flex flex-col gap-2">
          {toasts.map(({ id, ...toast }) => (
            <TimedToast key={id} id={id} toast={toast} onClose={close} closeLabel={closeLabel} />
          ))}
        </ol>
      </section>
    </ShowToast.Provider>
  );
}

function TimedToast({
  id,
  toast,
  onClose,
  closeLabel,
}: {
  id: number;
  toast: ToastMessage;
  onClose: (id: number) => void;
  closeLabel: string;
}) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [closing, setClosing] = useState(false);
  const left = useRef(TOAST_MS);

  // A toast must not run out while the tab is in the background and nobody can read it.
  useEffect(() => {
    const onVisibility = () => setHidden(document.hidden);
    onVisibility();
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  useEffect(() => {
    if (hovered || focused || hidden || closing) return;
    const started = Date.now();
    const timer = setTimeout(() => setClosing(true), left.current);
    return () => {
      clearTimeout(timer);
      left.current -= Date.now() - started;
    };
  }, [hovered, focused, hidden, closing]);

  // The exit is a keyframe so animationend always fires; the reduced-motion rule shortens it to an instant.
  return (
    <li
      data-closing={closing || undefined}
      onAnimationEnd={closing ? () => onClose(id) : undefined}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      className="pointer-events-auto motion-safe:animate-[fw-pop-in_var(--fw-duration-base)_var(--fw-ease-out)] data-closing:animate-[fw-pop-out_var(--fw-duration-fast)_var(--fw-ease-out)_forwards] lg:[--fw-pop-y:-4px]"
    >
      <Toast {...toast} onClose={() => setClosing(true)} closeLabel={closeLabel} />
    </li>
  );
}
