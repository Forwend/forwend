import { STORE_LIMITS } from "@/features/stores/constants/stores";

/** R-134. */
export const STORES_COPY = {
  title: "Stores",
  add: "Add store",
  newTitle: "New store",
  editTitle: "Edit store",
  intro:
    "Each invoice records the store it is for. A store sets how long its checkout stays open and which sites a return link may go to.",
  columns: {
    store: "Store",
    projectId: "Project ID",
    closes: "Checkout closes after",
    origins: "Allowed origins",
  },
  originCount: (count: number) => (count === 1 ? "1 origin" : `${count} origins`),
  noOrigins: "None",
  failed: "We could not load your stores.",
  retry: "Try again",
  gone: "This store is not in your list anymore.",
  backToList: "Back to stores",
  storeGroup: "Store",
  checkoutGroup: "Checkout",
  name: "Store name",
  projectId: "Project ID",
  projectIdHint: "Public. It names this store in the developer tools and gives no access.",
  copy: "Copy",
  copyLabel: "Copy project ID",
  copied: "Copied",
  copyFailed: "Copy failed",
  closesAfter: "Checkout closes after",
  closesAfterHint: "New invoices start with this. You can change it on each invoice.",
  origins: "Allowed origins (optional)",
  originsHint:
    "One per line, like https://shop.example.com. A return link on this store's invoices must start with one of them.",
  save: "Save store",
  cancel: "Cancel",
  saved: (name: string) => `${name} saved`,
  errors: {
    required: "Fill in this field.",
    failed: "We could not save the store. Check the details and try again.",
    tooMany: `Use at most ${STORE_LIMITS.origins} origins.`,
    invalid: {
      name: `Use at most ${STORE_LIMITS.name} characters on one line, with no hidden characters. It can't name Forwend.`,
      defaultExpiresIn: "Choose when the checkout closes.",
      allowedOrigins: `Use https origins only, like https://shop.example.com, without a path. At most ${STORE_LIMITS.origins}.`,
    },
  },
} as const;
