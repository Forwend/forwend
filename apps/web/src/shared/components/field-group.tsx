import type { ReactNode } from "react";

export interface FieldGroupProps {
  title: string;
  children: ReactNode;
}

/** A titled group of form fields: a panel with its title ruled off (New invoice, a client's form). */
export function FieldGroup({ title, children }: FieldGroupProps) {
  return (
    <fieldset className="fw-panel flex min-w-0 flex-col sm:rounded-lg">
      <legend className="sr-only">{title}</legend>
      <p aria-hidden className="fw-panel-head text-base font-semibold text-ink">
        {title}
      </p>
      <div className="flex flex-col gap-5 p-4 sm:p-5">{children}</div>
    </fieldset>
  );
}
