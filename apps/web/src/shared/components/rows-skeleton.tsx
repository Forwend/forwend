import { Skeleton } from "@forwend/ui-web";
import type { ReactNode } from "react";

/** Rows before a list knows how many it has. */
export const SKELETON_ROWS = 5;

export interface RowsSkeletonProps {
  count: number;
  /** One row's parts, drawn with placeholders in the real row's text sizes, so each row keeps its height. */
  children: ReactNode;
}

/** An overview card's rows while they load (Latest payments, Unpaid): the list's frame around each card's row. */
export function RowsSkeleton({ count, children }: RowsSkeletonProps) {
  return (
    <ul aria-hidden className="-mx-4 divide-y divide-line border-t border-line sm:-mx-5">
      {Array.from({ length: count }, (_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: placeholder rows have nothing else to tell them apart
        <li key={i} className="flex min-h-14 items-center gap-3 px-4 py-2.5 sm:px-5">
          {children}
        </li>
      ))}
    </ul>
  );
}

/** A placeholder for one line of text: as tall as that line in the given text size. */
export function LineSkeleton({ size = "", className }: { size?: string; className: string }) {
  return (
    // Padding, not margins: a margin would collapse through the wrapper and shorten the line.
    <span className={`block py-[0.15lh] ${size}`}>
      <Skeleton className={`h-[0.7lh] ${className}`} />
    </span>
  );
}
