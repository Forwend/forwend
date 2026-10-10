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
        "flex h-9 min-w-0 items-center gap-2 rounded-md border border-line bg-surface px-3 text-sm focus-within:outline-2 focus-within:outline-focus",
        className,
      )}
    >
      <Search aria-hidden className="size-[var(--fw-icon-sm)] shrink-0 text-muted" />
      <span className="sr-only">{label}</span>
      <input
        type="search"
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
        placeholder={placeholder}
        className="min-w-0 flex-1 bg-transparent text-ink outline-none placeholder:text-subtle"
      />
    </label>
  );
}
