/** The owner's invoice page layout, shared by the page, its panels and its loading skeleton. */

export const PANEL_TITLE = "fw-panel-head text-base font-semibold text-ink";
export const ICON = "size-[var(--fw-icon-sm)]";

// Phones: Back and More, then a large title. Desktop: the number, then Edit and More.
export const HEADER =
  "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-3 lg:items-start lg:gap-y-5";
export const HEADER_MORE = "col-start-2 row-start-1";
export const HEADER_TITLE =
  "col-span-2 flex min-w-0 items-start gap-3 lg:col-span-1 lg:row-start-1";
export const TITLE = "break-words text-2xl font-semibold tracking-tight text-ink";
export const TILE =
  "grid size-11 shrink-0 place-items-center rounded-md border border-line bg-surface-2 text-muted max-lg:hidden [&_svg]:size-[var(--fw-icon-md)]";

// The figure on the left, its breakdown beside it from large screens.
export const AMOUNT_BODY =
  "grid gap-5 p-4 sm:p-6 lg:grid-cols-[minmax(0,1fr)_minmax(15rem,19rem)] lg:items-end";
export const PHONE_ROW =
  "flex min-h-12 items-center justify-between gap-3 border-t border-line px-4 text-sm font-medium sm:px-6 lg:hidden";

// Phones read the panels in ORDER; large screens put the client and details in a side column.
export const GRID =
  "@container flex flex-col gap-4 lg:grid lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start lg:gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]";
export const MAIN_COLUMN = "contents lg:flex lg:min-w-0 lg:flex-col lg:gap-6";
export const SIDE_COLUMN = "contents lg:flex lg:min-w-0 lg:flex-col lg:gap-6";
export const ORDER = {
  client: "order-1 lg:order-none",
  items: "order-2 lg:order-none",
  details: "order-3 lg:order-none",
  history: "order-4 lg:order-none",
} as const;

/** The page's actions on phones: a bar above the tab bar, within thumb reach. */
export const PHONE_ACTION_BAR =
  "max-lg:fixed max-lg:inset-x-0 max-lg:bottom-[calc(4.75rem+env(safe-area-inset-bottom,0px))] max-lg:z-[var(--fw-z-nav)] max-lg:flex max-lg:gap-2 max-lg:border-t max-lg:border-line max-lg:bg-[color-mix(in_oklab,var(--fw-bg)_88%,transparent)] max-lg:fw-safe-x max-lg:py-3 max-lg:backdrop-blur-md max-lg:[--fw-pop-y:0.5rem] max-lg:motion-safe:animate-[fw-pop-in_var(--fw-duration-base)_var(--fw-ease-out)]";
