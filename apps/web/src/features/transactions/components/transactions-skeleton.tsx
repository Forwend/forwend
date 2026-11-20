import { Skeleton, TABLE_ROW_CLASSES } from "@forwend/ui-web";
import { TransactionsTableHead } from "@/features/transactions/components/transactions-desktop-table";

export interface TransactionsSkeletonProps {
  count: number;
  preview: boolean;
}

export function TransactionsSkeleton({ count, preview }: TransactionsSkeletonProps) {
  const rows = Array.from({ length: count }, (_, i) => i);
  return (
    <div aria-hidden className={`@container overflow-hidden ${preview ? "" : "fw-panel"}`}>
      <table className="hidden w-full text-sm @3xl:table">
        <TransactionsTableHead preview={preview} />
        <tbody className="divide-y divide-line">
          {rows.map((i) => (
            <tr key={i} className={TABLE_ROW_CLASSES}>
              <td>
                <span className="flex items-center gap-3">
                  <Skeleton className="size-7 shrink-0 rounded-pill" />
                  <Skeleton className={`h-3 ${i % 2 ? "w-26" : "w-31"}`} />
                </span>
              </td>
              {preview ? null : (
                <td>
                  <Skeleton className={`h-3 ${i % 2 ? "w-16" : "w-29"}`} />
                </td>
              )}
              <td className="hidden @5xl:table-cell">
                <Skeleton className="h-3 w-16" />
              </td>
              <td>
                <Skeleton className="h-3 w-27" />
              </td>
              <td>
                <span className="flex items-center gap-1.5 px-2.5">
                  <Skeleton className="size-1.5 rounded-pill" />
                  <Skeleton className="h-2.5 w-14" />
                </span>
              </td>
              <td>
                <Skeleton className="ml-auto h-3 w-18" />
              </td>
              <td>
                <Skeleton className="ml-auto h-3 w-22" />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="@3xl:hidden">
        <p className="border-b border-line px-4 pt-4 pb-1.5 sm:px-5">
          <Skeleton className="h-2.5 w-16" />
        </p>
        <ul className="divide-y divide-line">
          {rows.map((i) => (
            <li key={i} className="flex items-start gap-3 px-4 py-3 sm:px-5">
              <Skeleton className="mt-0.5 size-9 shrink-0 rounded-pill" />
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="flex min-h-5.5 items-center justify-between gap-2">
                  <Skeleton className="h-3 w-33" />
                  <Skeleton className="h-3 w-20" />
                </span>
                <span className="flex min-h-5 items-center justify-between gap-2">
                  <Skeleton className="h-2.5 w-26" />
                  <Skeleton className="h-2.5 w-22" />
                </span>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
