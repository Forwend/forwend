"use client";

import { ChevronDown } from "lucide-react";
import { type ReactNode, useId, useState } from "react";

/** A closed panel for what most visits don't need: transactions, technical details. */
export function Disclosure({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <section className="fw-panel">
      <h2 className="text-sm font-medium text-ink">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={id}
          onClick={() => setOpen((value) => !value)}
          className="flex min-h-12 w-full items-center justify-between gap-3 px-4 text-left outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus sm:px-5"
        >
          {title}
          <ChevronDown
            aria-hidden
            className={`size-[var(--fw-icon-sm)] text-muted transition-transform duration-[var(--fw-duration-fast)] ${open ? "rotate-180" : ""}`}
          />
        </button>
      </h2>
      {open ? (
        <div id={id} className="border-t border-line px-4 py-3 sm:px-5">
          {children}
        </div>
      ) : null}
    </section>
  );
}
