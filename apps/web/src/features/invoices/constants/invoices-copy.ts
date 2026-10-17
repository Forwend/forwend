import {
  AMOUNT_ERRORS,
  type CUSTOM_EXPIRY,
  DUE_GRACE_DAYS,
  EXPIRY_BOUNDS_S,
  EXPIRY_CHOICES,
  INVOICE_EVENTS,
  INVOICE_EXCEPTIONS,
  INVOICE_FIELDS,
  INVOICE_LIMITS,
  INVOICE_PDFS,
  INVOICE_STEPS,
  LINE_LIMITS,
  SETTLEMENT_WAITS,
} from "@/features/invoices/constants/invoices";
import type {
  InvoiceEventKind,
  InvoiceExceptionKind,
  InvoicePdf,
  InvoiceStep,
  PayWith,
  Recheck,
  SettlementWaitKind,
} from "@/features/invoices/types/invoices";

const atMost = (n: number) =>
  `Use at most ${n.toLocaleString("en-US")} characters, with no hidden characters.`;

/** "about 19 min" or "under a minute": how long a payment has left to confirm. */
export const timeLeft = (seconds: number) =>
  seconds < 60 ? "under a minute" : `about ${Math.ceil(seconds / 60)} min`;

export const INVOICES_COPY = {
  invoices: "Invoices",
  newInvoice: "New invoice",
  emptyTitle: "No invoices yet",
  emptyText: "Create an invoice, then send its pay link to your client.",
  failed: "We could not load the invoices.",
  retry: "Try again",
  loadMore: "Show more",
  updateFailed: "We could not update the invoices.",
  search: "Search invoices",
  searchPlaceholder: "Number, client, title",
  columns: {
    invoice: "Invoice",
    client: "Client",
    due: "Due",
    status: "Status",
    amount: "Amount",
  },
  noClient: "No client",
  noDueDate: "No due date",
  due: (date: string) => `Due ${date}`,
  baseUnits: (token: string) => `base units of ${token}`,
} as const;

/** A personal profile's invoices are requests (PRODUCT.md): the list's words where they differ. */
export const REQUESTS_COPY = {
  ...INVOICES_COPY,
  invoices: "Requests",
  newInvoice: "New request",
  emptyTitle: "No requests yet",
  emptyText: "Request money, then send the pay link to whoever pays you.",
  failed: "We could not load the requests.",
  updateFailed: "We could not update the requests.",
  search: "Search requests",
  searchPlaceholder: "Number or note",
} as const;

export const NEW_INVOICE_COPY = {
  title: "New invoice",
  intro: "The client pays the exact amount. You get a link to send them.",
  noTokens:
    "No networks are enabled yet, so there is nothing to bill in. You can't create an invoice yet.",
  tokensFailed: "We could not load the networks and tokens you can bill in.",
  amountGroup: "Amount",
  payWithLabel: "How the client pays",
  payWith: { any: "Client chooses", fixed: "One token" } satisfies Record<PayWith, string>,
  payWithAnyHint: (symbols: string, networks: number) =>
    `The client pays it in ${symbols}, on any of ${networks} networks, 1 USD each.`,
  tokenLabel: "Network and token",
  amountLabel: "Amount",
  amountUsdLabel: "Amount in USD",
  amountHint: (symbol: string, network: string, decimals: number) =>
    `In ${symbol} on ${network}, up to ${decimals} decimals.`,
  amountErrors: {
    [AMOUNT_ERRORS.format]: "Enter an amount with digits and a point, like 1250.50.",
    [AMOUNT_ERRORS.decimals]: (symbol: string, decimals: number) =>
      `${symbol} has ${decimals} decimals: use at most ${decimals} digits after the point.`,
    [AMOUNT_ERRORS.zero]: "Enter an amount above 0.",
  },
  titleLabel: "Title (optional)",
  titlePlaceholder: "Website, October",
  noteLabel: "Note to the client (optional)",
  detailsGroup: "Details",
  returnLabel: "Return link (optional)",
  returnHint: "Your site's https link. The client sees Back to it after paying.",
  returnError: "Enter an https link, like https://example.com/thanks.",
  datesGroup: "Dates",
  dueLabel: "Due date (optional)",
  dueHint: `Shown to the client. Picking one sets the checkout to close ${DUE_GRACE_DAYS} days after it.`,
  dueClear: "Clear due date",
  expiryLabel: "Checkout closes after",
  expiryHint: "After this the pay link takes no more payments.",
  followsDue: (day: string) => `Open until ${day}, so a client who pays late still pays you.`,
  closesEarly: (day: string) =>
    `This closes before ${day}, ${DUE_GRACE_DAYS} days after the due date. A client who pays after the checkout closes sends money that is held for them, not paid to you.`,
  closesAtLimit: (day: string) =>
    `A checkout stays open at most ${EXPIRY_BOUNDS_S.max / EXPIRY_CHOICES.day} days, so this one closes before ${day}, ${DUE_GRACE_DAYS} days after the due date. A client who pays after it closes sends money that is held for them, not paid to you.`,
  expiry: {
    hour: "1 hour",
    day: "1 day",
    week: "7 days",
    month: "30 days",
    custom: "Custom",
  } satisfies Record<keyof typeof EXPIRY_CHOICES | typeof CUSTOM_EXPIRY, string>,
  closesOn: "Closes on",
  closesAt: "At",
  customError: "Pick a time from 15 minutes to 365 days from now.",
  client: "Client (optional)",
  clientName: "Name",
  clientEmail: "Email",
  clientAddress: "Address",
  clientCountry: "Country",
  noCountry: "No country",
  clientTaxId: "Tax or VAT ID",
  savedClient: "Saved client",
  savedClientPlaceholder: "Fill in from a saved client",
  searchClients: "Search clients",
  searchCountries: "Search countries",
  items: {
    add: "Add item",
    item: (n: number) => `Item ${n}`,
    description: "Item",
    quantity: "Qty",
    // The visible label first, then which item: each row's fields share their visible labels.
    quantityOf: (n: number) => `Qty, item ${n}`,
    price: (unit: string) => `Price (${unit})`,
    priceOf: (unit: string, n: number) => `Price (${unit}), item ${n}`,
    amount: "Amount",
    remove: (n: number) => `Remove item ${n}`,
    total: "Total",
    errors: {
      description: `Say what this item is, in at most ${LINE_LIMITS.description} characters.`,
      quantity: "Enter a quantity above 0, with up to 2 decimals.",
      price: (unit: string, decimals: number) =>
        `Enter a price in ${unit}, with up to ${decimals} decimals.`,
      exact: (unit: string) => `Qty × price needs more decimals than ${unit} has.`,
      zero: "Give at least one item a price.",
    },
  },
  create: "Create invoice",
  cancel: "Cancel",
  fieldErrors: {
    [INVOICE_FIELDS.amount]: "Enter an amount above 0 that the token can hold.",
    [INVOICE_FIELDS.title]: atMost(INVOICE_LIMITS.title),
    [INVOICE_FIELDS.note]: atMost(INVOICE_LIMITS.note),
    [INVOICE_FIELDS.dueDate]: "Enter a date, or leave it empty.",
    [INVOICE_FIELDS.clientName]: atMost(INVOICE_LIMITS.clientName),
    [INVOICE_FIELDS.clientEmail]: "Enter an email like name@example.com.",
    [INVOICE_FIELDS.clientAddress]: atMost(INVOICE_LIMITS.clientAddress),
    [INVOICE_FIELDS.clientCountry]: "Choose a country.",
    [INVOICE_FIELDS.clientTaxId]: atMost(INVOICE_LIMITS.clientTaxId),
    [INVOICE_FIELDS.senderName]: `${atMost(INVOICE_LIMITS.senderName)} The name can't be Forwend.`,
    [INVOICE_FIELDS.amountUsd]: "Enter an amount above 0 that every accepted token can hold.",
    [INVOICE_FIELDS.expiresIn]: "Pick a time from 15 minutes to 365 days from now.",
    [INVOICE_FIELDS.returnUrl]: "Enter an https link, like https://example.com/thanks.",
    [INVOICE_FIELDS.lines]:
      "We could not save these items. Check each item's text, quantity and price.",
  },
  failed: "We could not create the invoice. Try again.",
  invalid: "We could not create the invoice with these values. Check them and try again.",
  preview: {
    title: "Preview",
    untitled: "Invoice",
    on: (network: string) => `on ${network}`,
    any: (symbols: string, networks: number) => `in ${symbols} on any of ${networks} networks`,
    client: "Billed to",
    noClient: "No client",
    due: "Due",
    noDue: "No due date",
    closes: "Checkout closes after",
  },
} as const;

export const NEW_REQUEST_COPY = {
  ...NEW_INVOICE_COPY,
  title: "Request money",
  intro: "The payer pays the exact amount. You get a link to send them.",
  noTokens: "No networks are enabled yet, so there is nothing to request in.",
  tokensFailed: "We could not load the networks and tokens you can request in.",
  noteLabel: "Note to the payer (optional)",
  payWithLabel: "How the payer pays",
  payWith: { any: "Payer chooses", fixed: "One token" } satisfies Record<PayWith, string>,
  payWithAnyHint: (symbols: string, networks: number) =>
    `The payer pays it in ${symbols}, on any of ${networks} networks, 1 USD each.`,
  returnHint: "Your site's https link. The payer sees Back to it after paying.",
  senderLabel: "Your name (shown to the payer)",
  senderMissing: "Enter the name the payer will see.",
  create: "Create request",
  preview: {
    ...NEW_INVOICE_COPY.preview,
    untitled: "Money request",
    client: "Shown as",
    noClient: "No name yet",
  },
  failed: "We could not create the request. Try again.",
  invalid: "We could not create the request with these values. Check them and try again.",
} as const;

export const INVOICE_COPY = {
  back: "Invoices",
  clientChooses: (n: number) => `The client picks one of ${n} tokens and networks`,
  heldOn: (symbol: string, network: string) => `Held for the payer · ${symbol} on ${network}`,
  partlyPaid: "Partially paid",
  receivedOf: (received: string, total: string) => `Received ${received} of ${total}`,
  notFound: "No invoice has this link.",
  failed: "We could not load this invoice.",
  otherProfile: "This invoice belongs to another profile. Switch to that profile to see it.",
  retry: "Try again",
  amount: "Amount",
  progress: "Payment progress",
  steps: {
    [INVOICE_STEPS.waiting]: "Waiting",
    [INVOICE_STEPS.detected]: "Detected",
    [INVOICE_STEPS.confirming]: "Confirming",
    [INVOICE_STEPS.paid]: "Paid",
    [INVOICE_STEPS.settled]: "Settled",
  } satisfies Record<InvoiceStep, string>,
  confirmingCount: (done: number, total: number) =>
    total > 0
      ? `${done.toLocaleString("en-US")} / ${total.toLocaleString("en-US")} blocks confirmed`
      : "Waiting for confirmation",
  confirmingHint: (seconds: number) => {
    const left = timeLeft(seconds);
    return `${left[0]?.toUpperCase()}${left.slice(1)} left`;
  },
  confirmed: "Confirmed",
  // Read out to screen readers as blocks pass.
  confirming: (done: number, total: number, seconds: number) =>
    total > 0
      ? `Confirming (${done.toLocaleString("en-US")}/${total.toLocaleString("en-US")}) · ${timeLeft(seconds)} left`
      : `Confirming · ${timeLeft(seconds)} left`,
  // Why a paid invoice's money still waits (R-54); `at` is a short local time.
  settling: {
    [SETTLEMENT_WAITS.signing]: () => "Sending to your wallet",
    [SETTLEMENT_WAITS.finalizing]: (network: string, seconds: number) =>
      `Sending to your wallet · waiting for ${network} to finalize, ${timeLeft(seconds)} left`,
    [SETTLEMENT_WAITS.retrying]: (_network: string, _seconds: number, at: string) =>
      `Sending to your wallet · trying again at ${at}`,
    [SETTLEMENT_WAITS.dailyLimit]: (_network: string, _seconds: number, at: string) =>
      `Paused: today's settlements that Forwend pays the network fee for are used up. Next try at ${at}`,
    [SETTLEMENT_WAITS.refused]: () =>
      "Stopped for a manual check. The money stays at the invoice's address until Forwend resolves it",
  } satisfies Record<SettlementWaitKind, (network: string, seconds: number, at: string) => string>,
  checkStatus: "Check status",
  // What Check status found (R-55); `money` formats base units with the token's symbol.
  recheck: (r: Recheck, network: string, money: (units: bigint) => string) => {
    const missing = BigInt(r.onChain) - BigInt(r.recorded);
    if (r.rescanning && missing > 0n) return `Found ${money(missing)}. Recording it now.`;
    if (r.rescanning) return `Looking on ${network} again.`;
    // A full look ran minutes ago and found no transfer for it, such as Arc's native USDC.
    if (missing > 0n) return `${money(missing)} has no recorded transfer yet.`;
    if (BigInt(r.onChain) === 0n && BigInt(r.recorded) === 0n) return `Nothing on ${network} yet.`;
    return "Up to date";
  },
  recheckFailed: "Can't reach the network. Try again in a moment.",
  recheckUnreadable: (networks: string) => `${networks} did not answer.`,
  recheckTooSoon: "Checked recently.",
  nextCheck: (left: string) => `Next check in ${left}`,
  // Every transaction of the invoice: payments in, the settlement to the wallet, later refunds (R-69).
  deposits: "Transactions",
  payment: "Payment",
  to: "To",
  late: "After the checkout closed",
  // What happened and what to do, under the status (R-77). Amounts arrive formatted with their symbol; `noun` is
  // invoice or request.
  next: {
    // Only said when money came: with nothing sent, Details' Canceled on row says it.
    [INVOICE_EXCEPTIONS.canceled]: ({ held, noun }) =>
      `${held} arrived after the ${noun} was canceled and is held for the payer.`,
    [INVOICE_EXCEPTIONS.closedUnpaid]: ({ noun }) =>
      `The checkout closed with nothing paid. A closed ${noun} can't take money again.`,
    [INVOICE_EXCEPTIONS.closedPartial]: ({ held, left, noun }) =>
      `${held} is held for the payer. To collect the remaining ${left}, send a new ${noun}.`,
  } satisfies Record<
    InvoiceExceptionKind,
    (v: { left: string; held: string; noun: string }) => string
  >,
  lateHeld: (late: string) =>
    `${late} arrived after the checkout closed and is held for the payer.`,
  noun: { invoice: "invoice", request: "request" },
  newInvoice: "New invoice",
  newRequest: "New request",
  newForRest: (noun: string) => `New ${noun} for the rest`,
  from: "From",
  copy: "Copy link",
  copied: "Link copied",
  copyFailed: "Copy failed: select the link",
  details: "Details",
  items: "Items",
  itemsTotal: "Total",
  dueDate: "Due date",
  expires: "Checkout closes",
  closed: "Checkout closed",
  created: "Created",
  settlement: "Settlement",
  note: "Note",
  pdfs: "Documents",
  pdf: {
    [INVOICE_PDFS.invoice]: "Invoice PDF",
    [INVOICE_PDFS.receipt]: "Receipt PDF",
  } satisfies Record<InvoicePdf, string>,
  client: "Billed to",
  noClient: "No client details.",
  clientFailed: "We could not load the client details.",
  issuer: "From",
  taxId: "Tax ID",
  addBillingDetails: "Add billing details",
  openPayPage: "Open pay page",
  inNewTab: "in a new tab",
  canceledOn: "Canceled on",
  // The bell's lines (R-81); the amount follows each.
  events: {
    [INVOICE_EVENTS.paid]: (number: string) => `${number} paid`,
    [INVOICE_EVENTS.settled]: (number: string) => `${number} in your wallet`,
    [INVOICE_EVENTS.held]: (number: string) => `${number} held for the payer`,
  } satisfies Record<InvoiceEventKind, (number: string) => string>,
  // Cancel before any money (R-79, D-79): the confirm dialog and its outcome.
  moreActions: "More actions",
  cancel: {
    trigger: (noun: string) => `Cancel ${noun}`,
    title: (number: string) => `Cancel ${number}?`,
    body: "The pay link stops taking payments. Money sent after this is held for the payer. This can't be undone.",
    keep: (noun: string) => `Keep ${noun}`,
    confirm: (noun: string) => `Cancel ${noun}`,
    done: (number: string) => `${number} canceled`,
    failed: "We could not cancel it. Try again.",
    tooLate: "It can't be canceled anymore: money was seen or the checkout closed.",
  },
  noIssuer: "None on this invoice.",
} as const;
