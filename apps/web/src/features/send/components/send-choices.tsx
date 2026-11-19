import { RowButton } from "@forwend/ui-web";
import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";

export interface ChoicesProps {
  title: string;
  /** The list keeps its name for screen readers where the sheet's title already shows it. */
  titleHidden?: boolean;
  children: ReactNode;
}

export function Choices({ title, titleHidden = false, children }: ChoicesProps) {
  return (
    <section aria-label={title} className="flex flex-col gap-2">
      {titleHidden ? null : <h3 className="text-sm font-medium text-muted">{title}</h3>}
      <ul className="flex flex-col gap-1">{children}</ul>
    </section>
  );
}

export interface ChoiceProps {
  icon: ReactNode;
  label?: string;
  note?: string;
  disabled?: boolean;
  onClick: () => void;
}

export function Choice({ icon, label, note, disabled, onClick }: ChoiceProps) {
  return (
    <li>
      <RowButton onClick={onClick} disabled={disabled}>
        <span className="min-w-0 shrink-0">{icon}</span>
        {label ? (
          <span className="min-w-0 flex-1 truncate text-sm font-medium">{label}</span>
        ) : null}
        <span className={label ? "text-xs text-muted" : "ml-auto text-xs text-muted tabular-nums"}>
          {note}
        </span>
        {disabled ? null : (
          <ChevronRight aria-hidden className="size-[var(--fw-icon-sm)] shrink-0 text-muted" />
        )}
      </RowButton>
    </li>
  );
}
