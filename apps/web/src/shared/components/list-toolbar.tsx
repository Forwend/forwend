import type { ReactNode } from "react";

export interface ListToolbarProps {
  search: ReactNode;
  filter?: ReactNode;
  wideFilter?: boolean;
  actions?: ReactNode;
}

/** The search grows first, so the filter ends its row and wraps with the actions when it can't fit. */
export function ListToolbar({ search, filter, wideFilter, actions }: ListToolbarProps) {
  return (
    <div className="flex flex-wrap items-center gap-2 sm:gap-3">
      <div
        className={`flex min-w-0 flex-[1000_1_10rem] sm:max-w-sm ${wideFilter ? "max-sm:basis-full" : ""}`}
      >
        {search}
      </div>
      {filter ? (
        <div
          className={`flex min-w-0 flex-[1_0_auto] items-center gap-2 max-sm:justify-end sm:gap-3 ${wideFilter ? "max-sm:basis-full" : ""}`}
        >
          {filter}
          {/* No box of its own, so an action hidden at this width leaves no gap behind. */}
          <div className="contents [&>:first-child]:ml-auto">{actions}</div>
        </div>
      ) : (
        <div className="contents [&>:first-child]:ml-auto">{actions}</div>
      )}
    </div>
  );
}
