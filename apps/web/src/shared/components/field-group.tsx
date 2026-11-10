import { createContext, type ReactNode, use } from "react";

/** Inside a form that is already one card, a group is a titled section, not a panel of its own. */
export const FlatFieldGroups = createContext(false);

export interface FieldGroupProps {
  title: string;
  children: ReactNode;
  /** With a description the group splits: title and description on the left, the fields' panel on the right. */
  description?: string;
}

export function FieldGroup({ title, children, description }: FieldGroupProps) {
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
  if (description) {
    return (
      <fieldset className="grid min-w-0 gap-x-8 gap-y-3 border-t border-line pt-6 first-of-type:border-t-0 first-of-type:pt-0 lg:grid-cols-[14rem_minmax(0,1fr)]">
        <legend className="sr-only">{title}</legend>
        <div aria-hidden>
          <p className="text-base font-semibold text-ink">{title}</p>
          <p className="mt-1 text-sm text-muted">{description}</p>
        </div>
        <div className="fw-panel flex min-w-0 flex-col gap-5 p-4 sm:p-5">{children}</div>
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
