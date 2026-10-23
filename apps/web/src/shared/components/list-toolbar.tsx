import type { ReactNode } from "react";

export interface ListToolbarProps {
  search: ReactNode;
  /** Left out on a list with search alone (Clients), so the search reaches the row's end on phones. */
  filter?: ReactNode;
  actions?: ReactNode;
}

/** The search takes the free room first (grow 1000 to 1), so on a phone the filter ends its row; when it can't fit,
 * the filter and actions wrap to the next row together, still at its end. */
export function ListToolbar({ search, filter, actions }: ListToolbarProps) {
  return (
    <div className="flex flex-wrap items-center gap-2 sm:gap-3">
      <div className="flex min-w-0 flex-[1000_1_10rem] sm:max-w-sm">{search}</div>
      {filter ? (
        <div className="flex min-w-0 flex-[1_0_auto] items-center gap-2 max-sm:justify-end sm:gap-3">
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
