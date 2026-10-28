// One option row for the select, the search select and the select menu: compact for a pointer, 44px for a thumb.
export const OPTION_ROW_CLASSES =
  "flex min-h-9 cursor-pointer items-center justify-between gap-3 rounded-sm px-2.5 py-1.5 text-sm outline-none select-none pointer-coarse:min-h-11 pointer-coarse:text-base";

export const FIELD_CONTROL_CLASSES =
  "h-10 w-full rounded-md border border-field bg-surface px-3 text-sm text-ink pointer-coarse:h-11 transition-[border-color,box-shadow] duration-[var(--fw-duration-fast)] ease-out placeholder:text-subtle focus-visible:border-field-focus focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-field-ring disabled:cursor-not-allowed disabled:border-line disabled:text-subtle disabled:shadow-none aria-[invalid=true]:border-danger";
