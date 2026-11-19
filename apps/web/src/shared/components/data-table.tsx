import {
  cx,
  ROW_INTERACTIVE_CLASSES,
  Skeleton,
  TABLE_HEAD_CLASSES,
  TABLE_ROW_CLASSES,
} from "@forwend/ui-web";
import Link from "next/link";
import { Fragment, type ReactNode } from "react";
import { LineSkeleton } from "@/shared/components/rows-skeleton";
import { dayName } from "@/shared/lib/dates";

/** Panel width from which a column shows; below it, its fact lives in the phone row or detail page. */
const COLUMN_FROM = { md: "md", lg: "lg", xl: "xl" } as const;

// Container widths, not the screen's: the sidebar can collapse, so the panel's own width decides what fits.
const FROM_CLASSES: Record<keyof typeof COLUMN_FROM, string> = {
  md: "hidden @4xl:table-cell",
  lg: "hidden @5xl:table-cell",
  xl: "hidden @6xl:table-cell",
};

/** A cell's loading shape besides a plain bar: a round icon before a bar, or a status pill. */
const CELL_PLACEHOLDERS = { lead: "lead", pill: "pill" } as const;

export interface DataColumn<T> {
  key: string;
  header: string;
  cell: (row: T) => ReactNode;
  title?: (row: T) => string | null;
  align?: "end"; // right-aligned and never cut
  fit?: boolean; // never cut, left-aligned
  from?: keyof typeof COLUMN_FROM;
  className?: string;
  headerHidden?: boolean;
  placeholder?: keyof typeof CELL_PLACEHOLDERS;
}

interface PhoneRow {
  leading?: ReactNode;
  title: ReactNode;
  time?: ReactNode;
  detail?: ReactNode;
  value?: ReactNode;
  meta?: ReactNode;
}

export interface DataTableProps<T> {
  label: string;
  rows: readonly T[];
  rowKey: (row: T) => string;
  rowHref: (row: T) => string;
  rowLabel: (row: T) => string;
  columns: readonly DataColumn<T>[];
  phone: (row: T) => PhoneRow;
  day?: (row: T) => string;
  footer?: ReactNode;
}

const PHONE_ROW_CLASSES = "relative flex min-h-16 items-center gap-3 px-4 py-3 sm:px-5";

const DAY_HEADING_CLASSES =
  "border-b border-line px-4 pt-4 pb-1.5 text-xs font-medium text-muted sm:px-5";

const LINK_CLASSES =
  "absolute inset-0 outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus";

/** A list of records where each row opens one; rows stay one line. */
export function DataTable<T>({
  label,
  rows,
  rowKey,
  rowHref,
  rowLabel,
  columns,
  phone,
  day,
  footer,
}: DataTableProps<T>) {
  const now = new Date();
  const days: { name: string | null; rows: T[] }[] = [];
  for (const row of rows) {
    const name = day ? dayName(day(row), now) : null;
    const last = days.at(-1);
    if (last && last.name === name) last.rows.push(row);
    else days.push({ name, rows: [row] });
  }
  return (
    <div className="fw-panel @container overflow-hidden">
      <table className="hidden w-full text-sm @3xl:table">
        <caption className="sr-only">{label}</caption>
        <DataTableHead columns={columns} />
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
                  title={column.title?.(row) ?? undefined}
                  className={cx(
                    column.align === "end"
                      ? "text-right whitespace-nowrap tabular-nums"
                      : column.fit
                        ? "w-px whitespace-nowrap"
                        : "max-w-0 truncate",
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
      <div className="@3xl:hidden">
        {days.map((group) => (
          <Fragment key={rowKey(group.rows[0] as T)}>
            {group.name ? (
              <p aria-hidden className={DAY_HEADING_CLASSES}>
                {group.name}
              </p>
            ) : null}
            <ul aria-label={group.name ?? undefined} className="divide-y divide-line">
              {group.rows.map((row) => {
                const line = phone(row);
                return (
                  // The lines are the link and its overlay covers the row, so a tap anywhere opens it while the
                  // link's name stays its visible text (WCAG 2.5.3).
                  <li key={rowKey(row)} className={cx(PHONE_ROW_CLASSES, ROW_INTERACTIVE_CLASSES)}>
                    {line.leading}
                    <Link
                      href={rowHref(row)}
                      className="flex min-w-0 flex-1 flex-col gap-0.5 outline-none after:absolute after:inset-0 focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-focus"
                    >
                      <span className="flex min-h-5.5 min-w-0 items-center gap-2">
                        <span className="min-w-0 truncate text-sm font-medium text-ink">
                          {line.title}
                        </span>
                        {line.time ? (
                          <span className="min-w-0 truncate text-xs text-subtle tabular-nums">
                            {line.time}
                          </span>
                        ) : null}
                        {line.value ? (
                          <span className="ml-auto shrink-0 text-sm text-ink tabular-nums">
                            {line.value}
                          </span>
                        ) : null}
                      </span>
                      {line.detail || line.meta ? (
                        <span className="flex min-h-5 min-w-0 items-center gap-2 text-xs text-muted">
                          {line.detail ? (
                            <span className="min-w-0 truncate">{line.detail}</span>
                          ) : null}
                          {line.meta ? (
                            <span className="ml-auto flex shrink-0">{line.meta}</span>
                          ) : null}
                        </span>
                      ) : null}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </Fragment>
        ))}
      </div>
      {footer ? <div className="border-t border-line px-4 py-3 sm:px-5">{footer}</div> : null}
    </div>
  );
}

function DataTableHead<T>({ columns }: { columns: readonly DataColumn<T>[] }) {
  return (
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
            {column.headerHidden ? <span className="sr-only">{column.header}</span> : column.header}
          </th>
        ))}
      </tr>
    </thead>
  );
}

export interface DataTableSkeletonProps<T> {
  count: number;
  className?: string;
  columns?: readonly DataColumn<T>[];
  leading?: boolean;
  days?: boolean;
  status?: boolean;
}

/** DataTable's loading form, shaped so loaded rows replace it without moving. */
export function DataTableSkeleton<T>({
  count,
  className,
  columns,
  leading,
  days,
  status,
}: DataTableSkeletonProps<T>) {
  const rows = Array.from({ length: count }, (_, i) => i);
  return (
    <div aria-hidden className={cx("@container overflow-hidden", className)}>
      <table className="hidden w-full text-sm @3xl:table">
        {columns ? (
          <DataTableHead columns={columns} />
        ) : (
          <thead>
            <tr className={TABLE_HEAD_CLASSES}>
              <th className="w-2/5">
                <Skeleton className="h-3 w-16" />
              </th>
              <th />
              <th />
            </tr>
          </thead>
        )}
        <tbody className="divide-y divide-line">
          {rows.map((i) => (
            <tr key={i} className={TABLE_ROW_CLASSES}>
              {columns ? (
                columns.map((column) => (
                  <td
                    key={column.key}
                    className={cx(
                      column.align !== "end" && !column.fit && "max-w-0",
                      column.from && FROM_CLASSES[column.from],
                      column.className,
                    )}
                  >
                    {column.headerHidden ? null : (
                      <CellPlaceholder column={column} odd={i % 2 === 1} />
                    )}
                  </td>
                ))
              ) : (
                <>
                  <td>
                    <Skeleton className="h-4 w-3/5" />
                  </td>
                  <td>
                    <Skeleton className="h-4 w-2/5" />
                  </td>
                  <td>
                    <Skeleton className="ml-auto h-4 w-16" />
                  </td>
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="@3xl:hidden">
        {days ? (
          <div className={DAY_HEADING_CLASSES}>
            <LineSkeleton className="w-16" />
          </div>
        ) : null}
        <ul className="divide-y divide-line">
          {rows.map((i) => (
            <li key={i} className={PHONE_ROW_CLASSES}>
              {leading ? <Skeleton className="size-9 shrink-0 rounded-pill" /> : null}
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="flex min-h-5.5 items-center justify-between gap-2">
                  <Skeleton className={cx("h-3", i % 2 ? "w-28" : "w-33")} />
                  <Skeleton className="h-3 w-20" />
                </span>
                <span className="flex min-h-5 items-center justify-between gap-2">
                  <Skeleton className="h-2.5 w-26" />
                  {status ? <Skeleton className="h-6 w-20" /> : null}
                </span>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function CellPlaceholder<T>({ column, odd }: { column: DataColumn<T>; odd: boolean }) {
  if (column.placeholder === CELL_PLACEHOLDERS.lead)
    return (
      <span className="flex items-center gap-3">
        <Skeleton className="size-7 shrink-0 rounded-pill" />
        <Skeleton className={cx("h-3 max-w-full", odd ? "w-26" : "w-31")} />
      </span>
    );
  if (column.placeholder === CELL_PLACEHOLDERS.pill)
    return <Skeleton className={cx("h-6", odd ? "w-16" : "w-24")} />;
  return (
    <Skeleton
      className={cx(
        "h-3 max-w-full",
        column.align === "end" ? "ml-auto w-22" : odd ? "w-16" : "w-24",
      )}
    />
  );
}
