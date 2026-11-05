import { Check } from "lucide-react";
import type { ComponentType, ReactNode } from "react";
import { useId } from "react";
import { cx } from "../../lib/cx";

export interface ChoiceCardProps {
  type: "radio" | "checkbox";
  name: string;
  value: string;
  checked: boolean;
  onChange: () => void;
  icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  title: string;
  hint?: ReactNode;
  /** A short label in the icon's row, such as what the choice sets up. */
  tag?: ReactNode;
}

/** The mark fills when chosen, so the choice is never shown by border color alone. */
export function ChoiceCard({
  type,
  name,
  value,
  checked,
  onChange,
  icon: Icon,
  title,
  hint,
  tag,
}: ChoiceCardProps) {
  const id = useId();
  return (
    <label className="group relative flex cursor-pointer flex-col items-start gap-1 rounded-lg border border-line-strong bg-surface p-4 text-ink transition-[border-color,background-color,box-shadow] duration-[var(--fw-duration-fast)] hover:bg-surface-2 has-checked:border-ink has-checked:shadow-sm has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-focus sm:p-5">
      <input
        type={type}
        name={name}
        value={value}
        checked={checked}
        onChange={onChange}
        aria-labelledby={`${id}-title`}
        aria-describedby={hint ? `${id}-hint` : undefined}
        className="sr-only"
      />
      <span
        aria-hidden
        className={cx(
          "absolute top-4 right-4 grid size-5 place-items-center border border-line-strong text-on-primary transition-colors duration-[var(--fw-duration-fast)] group-has-checked:border-primary group-has-checked:bg-primary sm:top-5 sm:right-5",
          type === "radio" ? "rounded-pill" : "rounded-sm",
        )}
      >
        <Check className="size-3.5 scale-50 opacity-0 transition-[opacity,scale] duration-[var(--fw-duration-fast)] ease-[var(--fw-ease-out)] group-has-checked:scale-100 group-has-checked:opacity-100" />
      </span>
      <span className="mb-2 flex w-full items-center gap-2 pr-8">
        <Icon aria-hidden className="size-[var(--fw-icon-lg)] shrink-0 text-accent" />
        {tag ? <span className="ml-auto min-w-0">{tag}</span> : null}
      </span>
      <span id={`${id}-title`} className="pr-8 font-medium">
        {title}
      </span>
      {hint ? (
        <span id={`${id}-hint`} className="flex flex-col gap-2 text-sm text-muted">
          {hint}
        </span>
      ) : null}
    </label>
  );
}
