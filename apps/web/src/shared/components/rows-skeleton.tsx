import { Skeleton } from "@forwend/ui-web";

/** Rows before a list knows how many it has. */
export const SKELETON_ROWS = 5;

export interface RowsSkeletonProps {
  count: number;
  className?: string;
}

/** Shaped like the real rows, so the page does not jump when they arrive. */
export function RowsSkeleton({ count, className = "" }: RowsSkeletonProps) {
  return (
    <ul aria-hidden className={`divide-y divide-line ${className}`}>
      {Array.from({ length: count }, (_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: placeholder rows have nothing else to tell them apart
        <li key={i} className="flex items-center gap-3 px-4 py-3">
          <Skeleton className="size-10 shrink-0" />
          <span className="flex min-w-0 flex-1 flex-col gap-2">
            <Skeleton className="h-4 w-2/5" />
            <Skeleton className="h-3 w-1/4" />
          </span>
          <span className="flex shrink-0 flex-col items-end gap-1">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-5 w-16" />
          </span>
        </li>
      ))}
    </ul>
  );
}
