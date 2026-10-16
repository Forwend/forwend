import type { ReactNode } from "react";

export interface ListToolbarProps {
  search: ReactNode;
  /** Left out on a list with search alone (Clients), so the search reaches the row's end on phones. */
  filter?: ReactNode;
  actions?: ReactNode;
}

/**
 * A list's search, its filter and actions: the search on the left with the filter beside it, the actions at the row's
 * end. The search takes the free room first (grow 1000 to 1, up to its cap from small screens up), so beside it on a
 * phone the filter ends the row; the group gets what is left, which carries the actions to the end. When a phone has
 * no room for the filter beside the search, the filter and actions take the next row together, still at its end.
 */
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
        // Without a filter there is no group: an action hidden at this width then takes no room and leaves no gap.
        <div className="contents [&>:first-child]:ml-auto">{actions}</div>
      )}
    </div>
  );
}
