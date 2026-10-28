import {
  cx,
  ROW_INTERACTIVE_CLASSES,
  TABLE_HEAD_CLASSES,
  TABLE_ROW_CLASSES,
} from "@forwend/ui-web";
import Link from "next/link";
import type { ReactNode } from "react";

/** The panel width from which a column shows. Below it the column's fact lives in the phone row or the detail page. */
export const COLUMN_FROM = { md: "md", lg: "lg", xl: "xl" } as const;

// Container widths, not the screen's: the sidebar can collapse, so the panel's own width decides what fits.
const FROM_CLASSES: Record<keyof typeof COLUMN_FROM, string> = {
  md: "hidden @4xl:table-cell",
  lg: "hidden @5xl:table-cell",
  xl: "hidden @6xl:table-cell",
};

export interface DataColumn<T> {
  key: string;
  header: string;
  cell: (row: T) => ReactNode;
  align?: "end";
  from?: keyof typeof COLUMN_FROM;
  className?: string;
}

export interface PhoneRow {
  leading?: ReactNode;
  title: ReactNode;
  detail?: ReactNode;
  value?: ReactNode;
  meta?: ReactNode;
}

export interface DataTableProps<T> {
  /** Names the table for screen readers. */
  label: string;
  rows: readonly T[];
  rowKey: (row: T) => string;
  rowHref: (row: T) => string;
  /** The row link's accessible name: what opening it shows. */
  rowLabel: (row: T) => string;
  columns: readonly DataColumn<T>[];
  /** The same record as two short lines, for panels narrower than the table. */
  phone: (row: T) => PhoneRow;
  footer?: ReactNode;
  /** Rows stay in their two-line form at every width: a list with too little to fill columns. */
  stacked?: boolean;
}

const LINK_CLASSES =
  "absolute inset-0 outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus";

/** A list of records where each row opens one. Rows stay one line; anything secondary lives on the record's page. */
export function DataTable<T>({
  label,
  rows,
  rowKey,
  rowHref,
  rowLabel,
  columns,
  phone,
  footer,
  stacked = false,
}: DataTableProps<T>) {
  return (
    <div className="fw-panel @container overflow-hidden">
      <table className={cx("hidden w-full text-sm", !stacked && "@3xl:table")}>
        <caption className="sr-only">{label}</caption>
        <thead>
          <tr className={TABLE_HEAD_CLASSES}>
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                className={cx(
                  column.align === "end" && "text-right",
                  column.from && FROM_CLASSES[column.from],
                  column.className,
                )}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((row) => (
            <tr
              key={rowKey(row)}
              className={cx(
                "relative transition-colors duration-[var(--fw-duration-fast)]",
                TABLE_ROW_CLASSES,
                ROW_INTERACTIVE_CLASSES,
              )}
            >
              {columns.map((column, i) => (
                <td
                  key={column.key}
                  className={cx(
                    "max-w-0 truncate",
                    column.align === "end" && "text-right tabular-nums",
                    column.from && FROM_CLASSES[column.from],
                    column.className,
                  )}
                >
                  {i === 0 ? (
                    <Link href={rowHref(row)} aria-label={rowLabel(row)} className={LINK_CLASSES} />
                  ) : null}
                  {column.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <ul className={cx("divide-y divide-line", !stacked && "@3xl:hidden")}>
        {rows.map((row) => {
          const line = phone(row);
          return (
            // The two text lines are the link and its overlay covers the row, so a tap anywhere opens it while the
            // link's name stays its visible text (WCAG 2.5.3).
            <li
              key={rowKey(row)}
              className={cx(
                "relative flex min-h-15 items-center gap-3 px-4 py-2.5 sm:px-5",
                ROW_INTERACTIVE_CLASSES,
              )}
            >
              {line.leading}
              <Link
                href={rowHref(row)}
                className="min-w-0 flex-1 outline-none after:absolute after:inset-0 focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-focus"
              >
                <span className="block truncate text-sm font-medium text-ink">{line.title}</span>
                {line.detail ? (
                  <span className="block truncate text-xs text-muted">{line.detail}</span>
                ) : null}
              </Link>
              {line.value || line.meta ? (
                <span className="flex shrink-0 flex-col items-end gap-1 text-right">
                  {line.value ? (
                    <span className="text-sm text-ink tabular-nums">{line.value}</span>
                  ) : null}
                  {line.meta}
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>
      {footer ? <div className="border-t border-line px-4 py-3 sm:px-5">{footer}</div> : null}
    </div>
  );
}
