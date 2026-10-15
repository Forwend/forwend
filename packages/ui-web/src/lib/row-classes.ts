/** A list or table row that opens something: the same hover and press everywhere (R-64). */
export const ROW_INTERACTIVE_CLASSES =
  "hover:bg-[color-mix(in_oklab,var(--fw-surface-2)_50%,transparent)] active:bg-surface-2";

/** A table's header row: a quiet band over the rows, small labels, the same side padding as the cells. */
export const TABLE_HEAD_CLASSES =
  "border-b border-line text-left text-xs text-muted [&>th]:h-10 [&>th]:px-3 [&>th]:font-medium [&>th]:whitespace-nowrap [&>th:first-child]:pl-5 [&>th:last-child]:pr-5";

/** A table's body row: one height for every row, cells centered on it, the head's side padding. */
export const TABLE_ROW_CLASSES =
  "[&>td]:h-15 [&>td]:px-3 [&>td]:py-2.5 [&>td]:align-middle [&>td:first-child]:pl-5 [&>td:last-child]:pr-5";
