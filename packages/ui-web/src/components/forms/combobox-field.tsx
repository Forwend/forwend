"use client";

import { Check, ChevronDown, Search } from "lucide-react";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { cx } from "../../lib/cx";
import { FIELD_CONTROL_CLASSES, OPTION_ROW_CLASSES } from "./field-classes";

export interface ComboboxOption {
  value: string;
  label: string;
  /** A quieter second line, also searched, such as a client's email. */
  detail?: string;
  /** A small mark before the label, such as a token or network logo; the field shows the chosen one's too. */
  icon?: ReactNode;
}

export interface ComboboxFieldProps {
  label: string;
  options: readonly ComboboxOption[];
  value: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  searchLabel?: string;
  noResults?: string;
  hint?: string;
  error?: string;
  id?: string;
  className?: string;
}

const fold = (text: string) =>
  text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

// Best first: a label that starts with the words, then a word that does, then any match; ties keep list order.
function matching(options: readonly ComboboxOption[], words: string): ComboboxOption[] {
  const rank = (option: ComboboxOption) => {
    const label = fold(option.label);
    if (label.startsWith(words)) return 0;
    if (label.split(/[\s(-]+/).some((word) => word.startsWith(words))) return 1;
    return fold(`${option.label} ${option.detail ?? ""}`).includes(words) ? 2 : -1;
  };
  return options
    .map((option) => ({ option, rank: rank(option) }))
    .filter((match) => match.rank >= 0)
    .sort((a, b) => a.rank - b.rank)
    .map((match) => match.option);
}

// The list's tallest (max-h-72) and shortest heights, in px: at least three and a half rows stay in view.
const LIST_MAX = 288;
const LIST_MIN = 126;
// The search row and the list's padding, plus the gap to the field and a margin to whatever clips the panel.
const PANEL_EXTRA = 64;

/** Where the panel has room inside what clips it (a scrolling form or dialog body, or the window), and how tall its
 *  list can be there: below the field unless above has more room. */
function placement(field: HTMLElement): { up: boolean; list: number } {
  const box = field.getBoundingClientRect();
  let top = 0;
  let bottom = window.innerHeight;
  for (let el = field.parentElement; el; el = el.parentElement) {
    if (getComputedStyle(el).overflowY === "visible") continue;
    const clip = el.getBoundingClientRect();
    top = Math.max(top, clip.top);
    bottom = Math.min(bottom, clip.bottom);
  }
  const below = bottom - box.bottom;
  const above = box.top - top;
  const up = below < LIST_MAX + PANEL_EXTRA && above > below;
  return { up, list: Math.max(LIST_MIN, Math.min(LIST_MAX, (up ? above : below) - PANEL_EXTRA)) };
}

/** For a long list (countries, saved clients); a short list stays a SelectField. */
export function ComboboxField({
  label,
  options,
  value,
  onValueChange,
  placeholder = "Choose…",
  searchLabel = "Search",
  noResults = "Nothing matches",
  hint,
  error,
  id,
  className,
}: ComboboxFieldProps) {
  const autoId = useId();
  const fieldId = id ?? autoId;
  const listId = `${fieldId}-list`;
  const describedBy = error ? `${fieldId}-error` : hint ? `${fieldId}-hint` : undefined;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [place, setPlace] = useState({ up: false, list: LIST_MAX });
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const chosen = options.find((option) => option.value === value);
  const words = fold(query.trim());
  // Hovering a row changes only the active row: the list is ranked again only for new options or a new search.
  const shown = useMemo(() => (words ? matching(options, words) : options), [options, words]);
  const current = Math.min(active, shown.length - 1);

  const show = () => {
    setQuery("");
    setActive(Math.max(0, options.indexOf(chosen as ComboboxOption)));
    if (trigger.current) setPlace(placement(trigger.current));
    setOpen(true);
  };
  const close = (focus = true) => {
    setOpen(false);
    if (focus) trigger.current?.focus();
  };
  const pick = (option: ComboboxOption | undefined) => {
    if (!option) return;
    onValueChange(option.value);
    close();
  };

  // A press anywhere else closes the panel without taking focus back from what was pressed.
  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);

  useEffect(() => {
    if (open) document.getElementById(`${listId}-${current}`)?.scrollIntoView({ block: "nearest" });
  }, [open, current, listId]);

  const onTriggerKeyDown = (event: ReactKeyboardEvent) => {
    if (["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) {
      event.preventDefault();
      show();
    }
  };
  const onSearchKeyDown = (event: ReactKeyboardEvent) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((current + step + shown.length) % Math.max(shown.length, 1));
    } else if (event.key === "Enter") {
      event.preventDefault();
      pick(shown[current]);
    } else if (event.key === "Escape") {
      // Only the panel closes, not a dialog around the field.
      event.preventDefault();
      event.stopPropagation();
      close();
    } else if (event.key === "Tab") {
      // Focus goes back to the field first, so the browser moves on from it, not from a box that is gone.
      close();
    }
  };

  return (
    <div ref={root} className={cx("flex flex-col gap-1.5", className)}>
      <label id={`${fieldId}-label`} htmlFor={fieldId} className="text-sm font-medium text-ink">
        {label}
      </label>
      {/* The panel hangs from the field itself, above its hint or error. */}
      <div className="relative">
        <button
          ref={trigger}
          id={fieldId}
          type="button"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-labelledby={`${fieldId}-label ${fieldId}`}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          onClick={() => (open ? close() : show())}
          onKeyDown={onTriggerKeyDown}
          className={cx(
            FIELD_CONTROL_CLASSES,
            "group flex items-center justify-between gap-3 text-left",
            open && "border-field-focus ring-2 ring-field-ring",
          )}
        >
          <span className={cx("flex min-w-0 items-center gap-2", !chosen && "text-subtle")}>
            {chosen?.icon ? <span className="flex shrink-0">{chosen.icon}</span> : null}
            <span className="truncate">{chosen?.label ?? placeholder}</span>
          </span>
          <ChevronDown
            aria-hidden
            className={cx(
              "size-[var(--fw-icon-sm)] shrink-0 text-subtle transition-transform duration-[var(--fw-duration-fast)]",
              open && "rotate-180",
            )}
          />
        </button>
        {open ? (
          // A press inside the panel keeps the search box focused, so the keys keep working; a click still picks.
          // biome-ignore lint/a11y/noStaticElementInteractions: it only keeps focus where it is
          <div
            onMouseDown={(event) => {
              if (event.target !== search.current) event.preventDefault();
            }}
            data-side={place.up ? "top" : "bottom"}
            className={cx(
              "absolute inset-x-0 z-[var(--fw-z-overlay)] overflow-hidden rounded-md border border-line bg-surface text-ink shadow-lg motion-safe:animate-[fw-pop-in_var(--fw-duration-base)_var(--fw-ease-out)]",
              place.up
                ? "bottom-full mb-1.5 [--fw-pop-y:4px]"
                : "top-full mt-1.5 [--fw-pop-y:-4px]",
            )}
          >
            <div className="flex items-center gap-2.5 border-b border-line px-3.5">
              <Search aria-hidden className="size-[var(--fw-icon-sm)] shrink-0 text-subtle" />
              <input
                ref={search}
                // biome-ignore lint/a11y/noAutofocus: the panel opens to be searched; Escape returns focus to the field
                autoFocus
                role="combobox"
                aria-expanded
                aria-controls={listId}
                aria-autocomplete="list"
                aria-activedescendant={shown[current] ? `${listId}-${current}` : undefined}
                aria-label={`${searchLabel}: ${label}`}
                placeholder={searchLabel}
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setActive(0);
                }}
                onKeyDown={onSearchKeyDown}
                className="h-10 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-subtle pointer-coarse:h-11 pointer-coarse:text-base"
              />
            </div>
            {/* Always mounted: a live region added together with its text is often not read. */}
            <p
              role="status"
              className={shown.length ? "sr-only" : "px-3.5 py-6 text-center text-sm text-muted"}
            >
              {shown.length ? "" : noResults}
            </p>
            <div
              id={listId}
              role="listbox"
              aria-label={label}
              style={{ maxHeight: place.list }}
              className="overflow-y-auto overscroll-contain p-1 empty:hidden"
            >
              {shown.map((option, i) => (
                // biome-ignore lint/a11y/useKeyWithClickEvents: the search box owns the keyboard (arrow keys and Enter)
                <div
                  key={option.value}
                  id={`${listId}-${i}`}
                  role="option"
                  tabIndex={-1}
                  // As in the command menu, the row the keys are on is the selected one; the field's value has the check.
                  aria-selected={i === current}
                  data-chosen={option.value === value ? "" : undefined}
                  onClick={() => pick(option)}
                  onPointerMove={() => setActive(i)}
                  className={cx(
                    OPTION_ROW_CLASSES,
                    "aria-selected:bg-surface-2 data-[chosen]:font-medium",
                  )}
                >
                  {option.icon ? <span className="flex shrink-0">{option.icon}</span> : null}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{option.label}</span>
                    {option.detail ? (
                      <span className="block truncate text-xs font-normal text-muted">
                        {option.detail}
                      </span>
                    ) : null}
                  </span>
                  {option.value === value ? (
                    <Check aria-hidden className="size-[var(--fw-icon-sm)] shrink-0 text-accent" />
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
      {error ? (
        <p id={`${fieldId}-error`} role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : hint ? (
        <p id={`${fieldId}-hint`} className="text-sm text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
