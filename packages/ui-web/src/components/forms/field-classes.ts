// One option row for the select, the search select and the select menu: compact for a pointer, 44px for a thumb.
export const OPTION_ROW_CLASSES =
  "flex min-h-9 cursor-pointer items-center justify-between gap-3 rounded-sm px-2.5 py-1.5 text-sm outline-none select-none pointer-coarse:min-h-11 pointer-coarse:text-base";

// A field with a control inside it (end): the frame takes the field's look and focus ring, and the input inside is bare.
export const FIELD_FRAME_CLASSES =
  "flex h-10 w-full min-w-0 items-center rounded-md border border-field bg-surface pr-1 pointer-coarse:h-11 transition-[border-color,box-shadow] duration-[var(--fw-duration-fast)] ease-out focus-within:border-field-focus focus-within:ring-2 focus-within:ring-field-ring has-[[aria-invalid=true]]:border-danger";

export const FIELD_BARE_INPUT_CLASSES =
  "h-full min-w-0 flex-1 bg-transparent px-3 text-sm text-ink outline-none placeholder:text-subtle pointer-coarse:text-base";

export const FIELD_CONTROL_CLASSES =
  "h-10 w-full rounded-md border border-field bg-surface px-3 text-sm text-ink pointer-coarse:h-11 transition-[border-color,box-shadow] duration-[var(--fw-duration-fast)] ease-out placeholder:text-subtle focus-visible:border-field-focus focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-field-ring disabled:cursor-not-allowed disabled:border-line disabled:bg-surface-2 disabled:text-subtle disabled:shadow-none aria-[invalid=true]:border-danger";
