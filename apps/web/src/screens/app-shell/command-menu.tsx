"use client";

import { CornerDownLeft, Search } from "lucide-react";
import {
  Fragment,
  type KeyboardEvent as ReactKeyboardEvent,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { COMMAND_COPY } from "@/screens/app-shell/constants/command-menu-copy";
import { useCommands } from "@/screens/app-shell/hooks/use-commands";

export interface CommandMenuProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CommandMenu({ open, onOpenChange }: CommandMenuProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const listId = useId();
  const close = () => onOpenChange(false);
  const { commands, searching } = useCommands(open, close);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // Browser autofill sends keydown events with no key.
      if (event.key?.toLowerCase() === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        onOpenChange(!ref.current?.open);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onOpenChange]);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      setQuery("");
      setIndex(0);
      dialog.showModal();
    }
    if (!open && dialog.open) dialog.close();
  }, [open]);

  const words = query.trim().toLowerCase();
  const shown = commands.filter((c) =>
    `${c.label} ${c.detail ?? ""} ${c.keywords ?? ""}`.toLowerCase().includes(words),
  );
  const current = Math.min(index, shown.length - 1);

  const onKeyDown = (event: ReactKeyboardEvent) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setIndex((current + step + shown.length) % Math.max(shown.length, 1));
    } else if (event.key === "Enter") {
      event.preventDefault();
      shown[current]?.run();
    }
  };

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: the click only catches the backdrop; Escape is the keyboard way out
    <dialog
      ref={ref}
      aria-label={COMMAND_COPY.title}
      onClose={close}
      onClick={(event) => {
        if (event.target === ref.current) close();
      }}
      className="mx-auto mt-[12dvh] w-[calc(100vw-2rem)] max-w-xl overflow-hidden rounded-lg border border-line bg-surface p-0 text-ink shadow-lg backdrop:bg-[var(--fw-scrim)]"
    >
      <div className="flex items-center gap-3 border-b border-line px-4">
        <Search aria-hidden className="size-[var(--fw-icon-md)] shrink-0 text-muted" />
        <input
          role="combobox"
          aria-expanded
          aria-controls={listId}
          aria-activedescendant={shown[current] ? `${listId}-${current}` : undefined}
          aria-label={COMMAND_COPY.placeholder}
          placeholder={COMMAND_COPY.placeholder}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setIndex(0);
          }}
          onKeyDown={onKeyDown}
          className="h-14 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-subtle"
        />
        <kbd className="rounded-sm border border-line bg-surface-2 px-1.5 font-mono text-2xs text-muted">
          Esc
        </kbd>
      </div>
      {/* Always mounted: a live region added together with its text is often not read. */}
      <p
        role="status"
        className={shown.length ? "sr-only" : "px-3 py-8 text-center text-sm text-muted"}
      >
        {shown.length ? "" : searching ? COMMAND_COPY.searching : COMMAND_COPY.noResults}
      </p>
      <div
        id={listId}
        role="listbox"
        aria-label={COMMAND_COPY.title}
        className="max-h-[50dvh] overflow-y-auto overscroll-contain p-2 empty:hidden"
      >
        {shown.map((c, i) => (
          <Fragment key={c.id}>
            {c.group !== shown[i - 1]?.group ? (
              <p aria-hidden className="px-3 pt-2 pb-1 text-xs font-medium text-subtle">
                {c.group}
              </p>
            ) : null}
            {/* biome-ignore lint/a11y/useKeyWithClickEvents: the input owns the keyboard (arrow keys and Enter) */}
            <div
              id={`${listId}-${i}`}
              role="option"
              tabIndex={-1}
              aria-selected={i === current}
              onClick={c.run}
              onPointerMove={() => setIndex(i)}
              className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md px-3 text-sm aria-selected:bg-surface-2"
            >
              <c.icon aria-hidden className="size-[var(--fw-icon-sm)] shrink-0 text-muted" />
              <span className="min-w-0 flex-1">
                <span className="block truncate">{c.label}</span>
                {c.detail ? (
                  <span className="block truncate font-mono text-xs text-muted">{c.detail}</span>
                ) : null}
              </span>
              {i === current ? (
                <span className="flex items-center gap-1 text-xs text-subtle">
                  <CornerDownLeft aria-hidden className="size-[var(--fw-icon-sm)]" />
                  {COMMAND_COPY.hint}
                </span>
              ) : null}
            </div>
          </Fragment>
        ))}
      </div>
    </dialog>
  );
}
