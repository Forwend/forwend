import { type ReactNode, useId } from "react";

/** A settings page's title: large on phones, as a phone's settings screen shows it. */
export const SETTINGS_TITLE = "text-2xl font-semibold tracking-tight text-ink lg:text-xl";
/** One row of a settings panel: what it is on the left, its value or control on the right. */
export const SETTINGS_ROW = "flex min-h-14 items-center gap-3 px-4 py-3 sm:px-5";

export interface SettingsGroupProps {
  /** A small title over the rows. */
  title?: string;
  /** One short line under the rows, only where a choice needs it. */
  note?: ReactNode;
  children: ReactNode;
}

/** A group of settings rows: a small title, the rows' panel, then at most one short note. */
export function SettingsGroup({ title, note, children }: SettingsGroupProps) {
  const id = useId();
  return (
    <section aria-labelledby={title ? id : undefined} className="flex min-w-0 flex-col gap-2">
      {title ? (
        <h2 id={id} className="px-1 text-sm font-medium text-muted">
          {title}
        </h2>
      ) : null}
      {children}
      {note ? <p className="px-1 text-sm text-muted">{note}</p> : null}
    </section>
  );
}
