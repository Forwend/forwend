"use client";

import { Search, X } from "lucide-react";
import { useRef } from "react";
import { cx } from "../../lib/cx";
import { IconButton } from "../buttons/icon-button";

export interface SearchFieldProps {
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}

export function SearchField({
  label,
  value,
  onValueChange,
  placeholder,
  className,
}: SearchFieldProps) {
  const input = useRef<HTMLInputElement>(null);
  // The clear button sits outside the label, so it stays out of the field's accessible name.
  return (
    <div
      className={cx(
        "flex h-10 min-w-0 items-center rounded-md border border-transparent bg-surface-2 pr-1 transition-[border-color,box-shadow] duration-[var(--fw-duration-fast)] ease-out focus-within:border-field-focus focus-within:ring-2 focus-within:ring-field-ring pointer-coarse:h-11",
        className,
      )}
    >
      <label className="flex h-full min-w-0 flex-1 cursor-text items-center gap-2 pl-3.5">
        <Search aria-hidden className="size-[var(--fw-icon-sm)] shrink-0 text-muted" />
        <span className="sr-only">{label}</span>
        <input
          ref={input}
          type="search"
          value={value}
          onChange={(event) => onValueChange(event.target.value)}
          placeholder={placeholder}
          className="h-full min-w-0 flex-1 bg-transparent text-base text-ink outline-none placeholder:text-subtle sm:text-sm pointer-coarse:text-base [&::-webkit-search-cancel-button]:appearance-none"
        />
      </label>
      {value ? (
        <IconButton
          label="Clear search"
          onClick={() => {
            onValueChange("");
            input.current?.focus();
          }}
          className="shrink-0"
        >
          <X aria-hidden className="size-[var(--fw-icon-sm)]" />
        </IconButton>
      ) : null}
    </div>
  );
}
