import { createContext, type ReactNode, use } from "react";

/** Inside a form that is already one card, a group is a titled section, not a panel of its own. */
export const FlatFieldGroups = createContext(false);

export interface FieldGroupProps {
  title: string;
  children: ReactNode;
}

export function FieldGroup({ title, children }: FieldGroupProps) {
  if (use(FlatFieldGroups)) {
    return (
      <fieldset className="flex min-w-0 flex-col gap-5">
        <legend className="sr-only">{title}</legend>
        <p aria-hidden className="text-base font-semibold text-ink">
          {title}
        </p>
        {children}
      </fieldset>
    );
  }
  return (
    <fieldset className="fw-panel flex min-w-0 flex-col">
      <legend className="sr-only">{title}</legend>
      <p aria-hidden className="fw-panel-head text-base font-semibold text-ink">
        {title}
      </p>
      <div className="flex flex-col gap-5 p-4 sm:p-5">{children}</div>
    </fieldset>
  );
}
