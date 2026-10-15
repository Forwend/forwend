import { Search } from "lucide-react";
import { cx } from "../../lib/cx";

export interface SearchFieldProps {
  /** The accessible name; the placeholder shows what it searches. */
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}

/** A compact search box for filtering a list or table in a toolbar. */
export function SearchField({
  label,
  value,
  onValueChange,
  placeholder,
  className,
}: SearchFieldProps) {
  return (
    <label
      className={cx(
        "relative flex h-9 min-w-0 items-center gap-2 rounded-md border border-line bg-surface px-3 text-sm transition-[border-color,box-shadow] duration-[var(--fw-duration-fast)] ease-out before:absolute before:inset-x-0 before:-inset-y-1 focus-within:border-ink focus-within:ring-2 focus-within:ring-[color-mix(in_oklab,var(--fw-ink)_12%,transparent)]",
        className,
      )}
    >
      <Search aria-hidden className="size-[var(--fw-icon-sm)] shrink-0 text-muted" />
      <span className="sr-only">{label}</span>
      {/* relative lifts the input above the label's hit-area pseudo, so a click still places the caret. */}
      <input
        type="search"
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
        placeholder={placeholder}
        className="relative min-w-0 flex-1 bg-transparent text-base text-ink outline-none placeholder:text-subtle sm:text-sm"
      />
    </label>
  );
}
