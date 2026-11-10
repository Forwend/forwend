import type { ClientKind } from "@/features/clients/types/clients";
import {
  AMOUNT_ERRORS,
  type CUSTOM_EXPIRY,
  EXPIRY_BOUNDS_S,
  EXPIRY_CHOICES,
  HISTORY_ACTORS,
  HISTORY_FIELDS,
  HISTORY_FILTERS,
  HISTORY_KINDS,
  INVOICE_FIELDS,
  INVOICE_LIMITS,
  INVOICE_PDFS,
  LINE_LIMITS,
  OWED_KINDS,
  REMINDER_STEPS,
  RETAINER_LEAD_DAYS,
  SETTLEMENT_WAITS,
  STEP_IDS,
} from "@/features/invoices/constants/invoices";
import type {
  HistoryActor,
  HistoryField,
  HistoryFilter,
  HistoryKind,
  InvoicePdf,
  OwedKind,
  PayWith,
  Recheck,
  ReminderStep,
  SettlementWaitKind,
} from "@/features/invoices/types/invoices";

const atMost = (n: number) =>
  `Use at most ${n.toLocaleString("en-US")} characters, with no hidden characters.`;

export const timeLeft = (seconds: number) =>
  seconds < 60 ? "under a minute" : `about ${Math.ceil(seconds / 60)} min`;

export const INVOICES_COPY = {
  // R-129, on New invoice when it replaces one.
  revise: {
    title: (number: string) => `This replaces ${number}`,
    body: (number: string) =>
      `Creating it cancels ${number}. Its pay link then shows the new invoice, with a new number, address and link.`,
    sent: (number: string, time: string) => `${number} was emailed to the client on ${time}.`,
    opened: (count: number, time: string) =>
      `Its pay link was opened ${count === 1 ? "once" : `${count.toLocaleString("en-US")} times`}, last on ${time}.`,
    held: "Money still sent to its old address is held for the payer, not paid to you.",
    tooLate: (number: string) =>
      `${number} can't be replaced now: money arrived, its checkout closed or it was already canceled.`,
    failed: "We could not load the invoice to replace.",
    retry: "Try again",
  },
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
    title: "Title",
    store: "Store",
    due: "Due",
    status: "Status",
    amount: "Amount",
    network: "Network",
  },
  noClient: "No client",
  noDueDate: "No due date",
  due: (date: string) => `Due ${date}`,
  // How far the due date is: said on hover over the date, and to screen readers once late (R-253).
  dueIn: (days: number) =>
    days === 0
      ? "today"
      : days > 0
        ? `in ${days === 1 ? "1 day" : `${days} days`}`
        : `${days === -1 ? "1 day" : `${-days} days`} late`,
  copyLink: (number: string) => `Copy the pay link of ${number}`,
  linkCopied: (number: string) => `Pay link of ${number} copied`,
  copyFailed: "Copy failed",
  actions: "Actions",
  // The strip over the list: the invoices that need the owner now.
  attention: {
    title: "Needs attention",
    count: (n: number) => (n === 1 ? "1 needs attention" : `${n} need attention`),
    leftIn: (n: number) => `left to pay in ${n === 1 ? "1 invoice" : `${n} invoices`}`,
    leftToPay: (total: string) => `${total} left to pay`,
    left: "left to pay",
    overdue: (late: string) => `Overdue, ${late}`,
    partlyPaid: "Partially paid",
    kinds: (overdue: number, partly: number) =>
      [overdue > 0 ? `${overdue} overdue` : null, partly > 0 ? `${partly} partially paid` : null]
        .filter(Boolean)
        .join(", "),
    dueDate: (date: string) => `due ${date}`,
  },
  baseUnits: (token: string) => `base units of ${token}`,
} as const;

/** A personal profile's invoices are requests (PRODUCT.md). */
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
  columns: { ...INVOICES_COPY.columns, invoice: "Request", title: "Note" },
} as const;

export const NEW_INVOICE_COPY = {
  stepsLabel: "Invoice steps",
  stepLabels: {
    [STEP_IDS.customer]: "Customer",
    [STEP_IDS.items]: "Items",
    [STEP_IDS.details]: "Details",
    [STEP_IDS.review]: "Review",
  },
  reviewGroup: "Review",
  // The review's rows: what the client is asked for and what the owner gets, each with a way back to its step.
  review: {
    items: "Items",
    itemsValue: (n: number, total: string) => `${n === 1 ? "1 item" : `${n} items`} · ${total}`,
    clientPays: "Client pays",
    closes: "Checkout closes",
    // A preset counts from the moment the invoice is created; a custom close is a day.
    afterCreated: (span: string) => `${span} after it is created`,
    youReceive: "You receive",
    afterFee: (receives: string, fee: string, platform: boolean) =>
      `${receives} after the ${fee} ${platform ? "fees" : "network fee"}`,
    afterCreate: "Next you get the pay link to share.",
    afterCreateEmail: (email: string) => `Next you get the pay link to share or email to ${email}.`,
  },
  edit: "Edit",
  editStep: (term: string) => `Edit ${term.toLowerCase()}`,
  back: "Back",
  continueTo: (step: string) => `Continue to ${step}`,
  stepOf: (n: number, of: number) => `Step ${n} of ${of}`,
  missingClient: "Enter a customer name or email",
  title: "New invoice",
  intro: "The client pays this exact amount by link.",
  noTokens:
    "No networks are enabled yet, so there is nothing to bill in. You can't create an invoice yet.",
  tokensFailed: "We could not load the assets you can bill in.",
  amountGroup: "Items",
  payWithLabel: "How the client pays",
  payWith: { any: "Client chooses", fixed: "One token" } satisfies Record<PayWith, string>,
  // R-56: the least a new payment asks. Which tokens and networks the client can use shows in the preview.
  minimumHint: (unit: string) => `Min 1 ${unit}`,
  tokenLabel: "Network and token",
  searchTokens: "Search tokens",
  noTokenMatch: "No token matches",
  amountLabel: "Amount",
  amountUsdLabel: "Amount in USD",
  amountErrors: {
    [AMOUNT_ERRORS.format]: "Enter an amount with digits and a point, like 1250.50.",
    [AMOUNT_ERRORS.decimals]: (symbol: string, decimals: number) =>
      `${symbol} has ${decimals} decimals: use at most ${decimals} digits after the point.`,
    [AMOUNT_ERRORS.zero]: "Enter an amount above 0.",
    [AMOUNT_ERRORS.min]: (symbol: string) => `Enter at least 1.00 ${symbol}.`,
  },
  titleLabel: "Title (optional)",
  titlePlaceholder: "Website, October",
  referenceLabel: "PO or reference (optional)",
  referenceHint: "Your client's purchase order number.",
  noteLabel: "Note to the client (optional)",
  detailsGroup: "Details",
  moreOptions: "More options",
  returnLabel: "Return link (optional)",
  returnHint: "The client sees Back to it after paying.",
  returnError: "Enter an https link, like https://example.com/thanks.",
  // R-134: a merchant invoice's store.
  storeLabel: "Store",
  returnOrigins: (origins: string) => `A link that starts with ${origins}.`,
  returnNoOrigins: "Add your site to this store under Stores first.",
  returnOriginError: "Use a link that starts with one of this store's allowed origins.",
  agreed: {
    add: "Add agreed value",
    addHint: "A price in another currency, for reference only.",
    group: "Agreed value",
    hint: "The price you agreed with the client in another currency. It shows on the invoice and its PDF; the client still pays the amount above.",
    currency: "Agreed in",
    noCurrency: "Choose a currency",
    searchCurrencies: "Search currencies",
    amount: "Agreed amount",
    date: "Agreed on",
    remove: "Remove agreed value",
    errors: {
      currency: "Choose a currency.",
      amount: (digits: number) =>
        digits === 0
          ? "Enter a whole amount above 0."
          : `Enter an amount above 0 with up to ${digits} decimals.`,
      date: "Pick the day you agreed it.",
    },
  },
  billingNeeded: {
    title: "Add your billing details first",
    text: "Every invoice shows who bills the client: your name, address, country and email. EU, UK and US invoices need them.",
    action: "Add billing details",
  },
  datesGroup: "Dates",
  supplyLabel: "Supply date (optional)",
  supplyHint: "When the work was done, if not today.",
  supplyClear: "Clear supply date",
  dueLabel: "Due date (optional)",
  // Payment reminders (R-97): on at once when the invoice is made.
  remindersLabel: "Send payment reminders",
  remindersHint: "Emails the client around the due date until it is paid.",
  // R-99.
  repeatLabel: "Repeat every month",
  repeatHint: `A new invoice each month, emailed ${RETAINER_LEAD_DAYS} days before it is due.`,
  repeatEndLabel: "Last due date (optional)",
  repeatEndHint: "Empty repeats until you stop it.",
  repeatEndClear: "Clear last due date",
  dueClear: "Clear due date",
  expiryLabel: "Checkout closes after",
  followsDue: (day: string) => `Open until ${day}, so a late payment still reaches you.`,
  // D-80: a close before the due date plus the grace days holds a late payment for the client.
  closesEarly: (day: string) =>
    `Closes before ${day}: a payment after that is held for the client.`,
  closesAtLimit: (day: string) =>
    `At most ${EXPIRY_BOUNDS_S.max / EXPIRY_CHOICES.day} days, so it closes before ${day}: later payments are held.`,
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
  client: "Customer",
  clientKind: "Who are you billing?",
  clientKinds: { business: "A business", person: "A person" } satisfies Record<ClientKind, string>,
  clientLegalName: "Legal name",
  clientPersonName: "Full name",
  clientLegalNameHint: "As it should read on the invoice.",
  clientEmail: "Email",
  clientAddress: "Address",
  clientCountry: "Country",
  noCountry: "No country",
  clientTaxId: "Tax or VAT ID",
  savedClient: "Saved client",
  savedClientPlaceholder: "Fill in from a saved client",
  searchClients: "Search clients",
  clientsFailed: "We could not search your clients. Type again to retry.",
  searchCountries: "Search countries",
  items: {
    add: "Add item",
    item: (n: number) => `Item ${n}`,
    description: "Item",
    descriptionPlaceholder: "What is this item?",
    quantity: "Qty",
    // The visible label first, then which item: each row's fields share their visible labels.
    quantityOf: (n: number) => `Qty, item ${n}`,
    price: (unit: string) => `Price (${unit})`,
    priceOf: (unit: string, n: number) => `Price (${unit}), item ${n}`,
    amount: "Amount",
    amountIn: (unit: string) => `Amount (${unit})`,
    remove: (n: number) => `Remove item ${n}`,
    removeShort: "Remove",
    errors: {
      description: `Say what this item is, in at most ${LINE_LIMITS.description} characters.`,
      quantity: "Enter a quantity above 0, with up to 2 decimals.",
      price: (unit: string, decimals: number) =>
        `Enter a price in ${unit}, with up to ${decimals} decimals.`,
      exact: (unit: string) => `Qty × price needs more decimals than ${unit} has.`,
      zero: "Give at least one item a price.",
      min: (unit: string) => `The items must add up to at least 1.00 ${unit}.`,
    },
  },
  create: "Create invoice",
  cancel: "Cancel",
  fieldErrors: {
    [INVOICE_FIELDS.amount]: "Enter at least 1.00 in an amount the token can hold.",
    [INVOICE_FIELDS.title]: atMost(INVOICE_LIMITS.title),
    [INVOICE_FIELDS.agreedCurrency]: "Choose a currency from the list.",
    [INVOICE_FIELDS.agreedAmount]: "Enter an amount above 0 that this currency can hold.",
    [INVOICE_FIELDS.agreedDate]: "Pick the day you agreed it.",
    [INVOICE_FIELDS.reference]: `Use at most ${INVOICE_LIMITS.reference} characters on one line, with no hidden characters.`,
    [INVOICE_FIELDS.note]: atMost(INVOICE_LIMITS.note),
    [INVOICE_FIELDS.dueDate]: "Enter a date, or leave it empty.",
    [INVOICE_FIELDS.supplyDate]: "Enter a date, or leave it empty.",
    [INVOICE_FIELDS.clientName]: atMost(INVOICE_LIMITS.clientName),
    [INVOICE_FIELDS.clientEmail]: "Enter an email like name@example.com.",
    [INVOICE_FIELDS.clientAddress]: atMost(INVOICE_LIMITS.clientAddress),
    [INVOICE_FIELDS.clientCountry]: "Choose a country.",
    [INVOICE_FIELDS.clientTaxId]: atMost(INVOICE_LIMITS.clientTaxId),
    [INVOICE_FIELDS.senderName]: `${atMost(INVOICE_LIMITS.senderName)} The name can't be Forwend.`,
    [INVOICE_FIELDS.amountUsd]: "Enter at least 1.00 in an amount every accepted token can hold.",
    [INVOICE_FIELDS.expiresIn]: "Pick a time from 15 minutes to 365 days from now.",
    [INVOICE_FIELDS.returnUrl]: "Enter an https link, like https://example.com/thanks.",
    [INVOICE_FIELDS.memo]: atMost(INVOICE_LIMITS.memo),
    [INVOICE_FIELDS.lines]:
      "We could not save these items. Check each item's text, quantity and price.",
    [INVOICE_FIELDS.reminders]: "Reminders need a due date and a client email.",
    [INVOICE_FIELDS.repeat]: "Repeating needs a due date and a client email.",
    [INVOICE_FIELDS.repeatEndDate]: "Pick a day on or after the due date.",
  },
  failed: "We could not create the invoice. Try again.",
  invalid: "We could not create the invoice with these values. Check them and try again.",
  preview: {
    title: "Preview",
    // Which of the three things the client sees is drawn.
    show: "What to preview",
    zoomOut: "Zoom out",
    zoomIn: "Zoom in",
    fit: "Fit page",
    fitShort: "Fit",
    percent: (n: number) => `${n}%`,
    pages: (n: number) => (n === 1 ? "Page 1 of 1" : `${n} pages`),
    live: "Updates as you type",
    backTo: (step: string) => `Back to ${step}, where you left it`,
    draft: "Draft",
    waiting: "Waiting for payment",
    amountDue: "Amount due",
    total: "Total",
    issued: "Issued",
    supply: "Supply date",
    due: "Due date",
    closes: "Payment window",
    network: "Network",
    payerPicks: "The payer picks",
    noItem: "Item",
    noDue: "No due date",
    on: (network: string) => `on ${network}`,
    any: "in one of the available options",
    payAny: (amount: string) => `Pay ${amount} in one of the available options.`,
    payPick: "Scan the code or open the link, then pick the token and network.",
    payExact: (amount: string, network: string, chainId: number) =>
      `Send exactly ${amount} on ${network} (chain ID ${chainId}).`,
    payContract: (symbol: string, contract: string) => `${symbol} contract ${contract}`,
    emailSubject: (kind: string, from: string) => `${kind} from ${from}`,
    emailLead: (from: string, amount: string) =>
      `${from} sent you an invoice for ${amount}. You pay it in stablecoins on the payment page.`,
    someone: "Someone",
  },
} as const;

export const NEW_REQUEST_COPY = {
  ...NEW_INVOICE_COPY,
  title: "Request money",
  intro: "The payer pays this exact amount by link.",
  noTokens: "No networks are enabled yet, so there is nothing to request in.",
  tokensFailed: "We could not load the assets you can request in.",
  noteLabel: "Note to the payer (optional)",
  // A request has no items: its first step asks only for the amount.
  stepLabels: { ...NEW_INVOICE_COPY.stepLabels, [STEP_IDS.items]: "Amount" },
  amountGroup: "Amount",
  payWithLabel: "How the payer pays",
  payWith: { any: "Payer chooses", fixed: "One token" } satisfies Record<PayWith, string>,
  returnHint: "The payer sees Back to it after paying.",
  senderLabel: "Your name (shown to the payer)",
  senderMissing: "Enter the name the payer will see.",
  create: "Create request",
  preview: {
    ...NEW_INVOICE_COPY.preview,
    emailLead: (from: string, amount: string) =>
      `${from} asked you for ${amount}. You pay it in stablecoins on the payment page.`,
  },
  failed: "We could not create the request. Try again.",
  invalid: "We could not create the request with these values. Check them and try again.",
} as const;

export const INVOICE_COPY = {
  allItems: (n: number) => `Show all ${n} items`,
  reconciliationNeeded: "We could not verify this payment. Contact support before sending more.",
  verificationPending: "Confirming payment.",
  recordedReturns: (amount: string, network: string) =>
    `Recorded returns: ${amount} on ${network}.`,
  latestReturn: "Latest return transaction",
  back: "Invoices",
  testnet: "Testnet",
  clientChooses: (n: number) => `The client picks one of ${n} tokens and networks`,
  heldOn: (symbol: string, network: string) => `Held for the payer · ${symbol} on ${network}`,
  partlyPaid: "Partially paid",
  viewPayment: "View payment",
  paymentLink: "Payment link",
  openLink: "Open link",
  receivedOf: (received: string, total: string) => `Received ${received} of ${total}`,
  notFound: "No invoice has this link.",
  failed: "We could not load this invoice.",
  amount: "Amount",
  total: "Total",
  billedTo: (name: string) => `Billed to ${name}`,
  dueOn: (date: string) => `Due ${date}`,
  progress: "Payment progress",
  confirmingCount: (done: number, total: number) =>
    total > 0
      ? `Confirming (${done.toLocaleString("en-US")}/${total.toLocaleString("en-US")})`
      : "Confirming",
  confirmingHint: (seconds?: number | null, blocks?: number | null) => {
    const left = seconds != null ? timeLeft(seconds) : null;
    const estimate = left ? `${left[0]?.toUpperCase()}${left.slice(1)} left` : null;
    return [blocks != null ? `${blocks.toLocaleString("en-US")} blocks remaining` : null, estimate]
      .filter(Boolean)
      .join(" · ");
  },
  // Why a paid invoice's money still waits (R-54); `at` is a short local time.
  settling: {
    [SETTLEMENT_WAITS.signing]: () => "Sending to your wallet",
    [SETTLEMENT_WAITS.finalizing]: (network: string, seconds: number) =>
      `Sending to your wallet · waiting for ${network} to finalize, ${timeLeft(seconds)} left`,
    [SETTLEMENT_WAITS.retrying]: (_network: string, _seconds: number, at: string) =>
      `Sending to your wallet · trying again at ${at}`,
    [SETTLEMENT_WAITS.dailyLimit]: (_network: string, _seconds: number, at: string) =>
      `Paused: your profile's settlements for today are used up. Next try at ${at}`,
    [SETTLEMENT_WAITS.refused]: () =>
      "Stopped for a manual check. The money stays at the invoice's address until Forwend resolves it",
  } satisfies Record<SettlementWaitKind, (network: string, seconds: number, at: string) => string>,
  checkStatus: "Check status",
  // What Check status found (R-55).
  recheck: (r: Recheck, network: string, money: (units: bigint) => string) => {
    const missing = BigInt(r.onChain) - BigInt(r.recorded);
    if (r.rescanning && missing > 0n) return `Found ${money(missing)}. Recording it now.`;
    if (r.rescanning) return `Looking on ${network} again.`;
    // A full look ran minutes ago and found no transfer for it: money that moved without a Transfer log.
    if (missing > 0n) return `${money(missing)} has no recorded transfer yet.`;
    if (BigInt(r.onChain) === 0n && BigInt(r.recorded) === 0n) return `Nothing on ${network} yet.`;
    return "Up to date";
  },
  recheckFailed: "Can't reach the network. Try again in a moment.",
  recheckUnreadable: (networks: string) => `${networks} did not answer.`,
  recheckTooSoon: "Checked recently.",
  nextCheck: (left: string) => `Next check in ${left}`,
  // R-69.
  depositPreview: "Showing selected transactions. Totals include all transfers.",
  noun: { invoice: "invoice", request: "request" },
  testMode: "Test mode",
  newInvoice: "New invoice",
  newRequest: "New request",
  copy: "Copy link",
  copied: "Link copied",
  copyFailed: "Copy failed: select the link",
  details: "Details",
  items: "Items",
  summary: "Summary",
  itemsTotal: "Total",
  subtotal: "Subtotal",
  networkFee: "Network fee",
  platformFee: "Platform fee",
  youReceive: "You receive",
  received: "Received",
  stillDue: "Still due",
  timeline: "Timeline",
  timelineSteps: {
    created: "Created",
    sent: "Emailed to the client",
    opened: "Pay page opened",
    paid: "Paid",
    wallet: "In your wallet",
    closed: "Checkout closed",
    canceled: "Canceled",
  },
  opened: (n: number) => (n === 1 ? "Once" : `${n} times`),
  openedChip: "Opened",
  dueDate: "Due date",
  supplyDate: "Supply date",
  store: "Store",
  reference: "Reference",
  agreedValue: "Agreed value",
  agreedOn: (value: string, date: string) => `${value} on ${date}`,
  duplicate: "Duplicate",
  revise: "Revise",
  replacedBy: "Replaced by",
  replaces: "Replaces",
  expires: "Checkout closes",
  closed: "Checkout closed",
  created: "Created",
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
  memo: "Your memo",
  // R-127.
  edit: {
    trigger: "Edit",
    title: (number: string) => `Edit ${number}`,
    memo: "Memo",
    memoHint: "Only you see it: never the client, the pay page or the PDFs.",
    clientEmail: "Client email",
    returnUrl: "Return link",
    returnHint: "Your site's https link. The payer sees Back to it after paying.",
    anyTime: "Any time",
    beforePayment: "Before payment",
    beforePaymentHint: "The payer sees these changes under Updates on the pay page.",
    locked: "Payment arrived or the checkout closed, so these can't change now.",
    reference: "Reference",
    note: "Note",
    dueDate: "Due date",
    dueHint: (closes: string) => `On or before ${closes}, when the checkout closes.`,
    clearDue: "Clear the due date",
    cancel: "Cancel",
    save: "Save changes",
    saved: (number: string) => `${number} saved`,
    failed: "We could not save it. Try again.",
  },
  // Cancel before any money (R-79, D-79).
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
  // R-130.
  reopen: {
    trigger: "Reopen checkout",
    title: (number: string) => `Reopen ${number}?`,
    body: (until: string, noun: string) =>
      `The checkout opens again until ${until}, at the same address. The money held for the payer counts toward this ${noun}, up to its amount. It reopens only once.`,
    keep: "Keep closed",
    confirm: "Reopen",
    done: (number: string, until: string) => `${number} reopened until ${until}`,
    failed: "We could not reopen it. Try again.",
    tooLate: "It can't be reopened anymore.",
  },
  noIssuer: "None on this invoice.",
  // R-94.
  send: {
    action: "Send to client",
    noEmail: "No client email on this invoice, so it can't be emailed. Share the pay link instead.",
    again: (time: string) => `You can send it again after ${time}.`,
    sent: (time: string) => `Emailed · ${time}`,
    sending: (email: string | null) => (email ? `Sending to ${email}…` : "Sending…"),
    failed: (time: string) => `Could not email · asked ${time}`,
    done: (number: string, email: string) => `${number} is on its way to ${email}`,
    closed: "It can't be sent: the invoice can no longer be paid.",
    limited: "You can't send more emails right now. Try again later.",
    error: "We could not send it. Try again.",
  },
  // R-96.
  reminders: {
    toggle: "Payment reminders",
    hint: "Emails the client 3 days before the due date, on it and 7 days after, until it is paid.",
    needsDue: "Reminders need a due date, so they are off for this invoice.",
    stopped: (time: string) => `The client stopped reminders on ${time}.`,
    steps: {
      [REMINDER_STEPS.before]: "Reminder before the due date",
      [REMINDER_STEPS.due]: "Reminder on the due date",
      [REMINDER_STEPS.after]: "Reminder after the due date",
    } satisfies Record<ReminderStep, string>,
    sent: (time: string) => `emailed ${time}`,
    sending: "sending…",
    failed: "could not be sent",
    saved: (on: boolean) => (on ? "Payment reminders on" : "Payment reminders off"),
    conflict: "Reminders can't be turned on for this invoice now.",
    error: "We could not save it. Try again.",
  },
  // R-99.
  repeat: {
    title: "Repeats every month",
    next: (due: string, on: string) => `Next invoice due ${due}, emailed to the client on ${on}.`,
    last: (day: string) => ` No invoice is due after ${day}.`,
    ended: (day: string) => `No more invoices are made: none is due after ${day}.`,
    stopped: (time: string) => `Stopped on ${time}. Invoices already made stay.`,
    stop: "Stop repeating",
    stopTitle: "Stop repeating?",
    stopBody:
      "No more invoices are made or emailed. Invoices already made stay, and the client can still pay them.",
    keep: "Keep repeating",
    done: "Stopped repeating",
    error: "We could not stop it. Try again.",
  },
  // R-239: a payment through NEAR Intents.
  paidThrough: "Paid through NEAR Intents",
  paidThroughValue: (amount: string, chain: string) => `${amount} on ${chain}`,
  // R-124.
  history: {
    title: "History",
    filter: "Show",
    filters: {
      [HISTORY_FILTERS.all]: "All",
      [HISTORY_FILTERS.payment]: "Payments",
      [HISTORY_FILTERS.change]: "Changes",
      [HISTORY_FILTERS.email]: "Emails",
    } satisfies Record<HistoryFilter, string>,
    columns: { event: "Event", by: "By", details: "Details", time: "Time" },
    none: "Nothing here yet.",
    noDetails: "—",
    actors: {
      [HISTORY_ACTORS.owner]: "You",
      [HISTORY_ACTORS.payer]: "Payer",
      [HISTORY_ACTORS.system]: "Forwend",
    } satisfies Record<HistoryActor, string>,
    kinds: {
      [HISTORY_KINDS.created]: "Created",
      [HISTORY_KINDS.canceled]: "Canceled",
      [HISTORY_KINDS.payerEmail]: "Receipt email added",
      [HISTORY_KINDS.optionChosen]: "Token chosen",
      [HISTORY_KINDS.optionPicked]: "Token picked",
      [HISTORY_KINDS.open]: "Payment dropped",
      [HISTORY_KINDS.detected]: "Payment detected",
      [HISTORY_KINDS.partiallyPaid]: "Partially paid",
      [HISTORY_KINDS.paid]: "Paid",
      [HISTORY_KINDS.expired]: "Closed unpaid",
      [HISTORY_KINDS.expiredPartiallyPaid]: "Closed, partially paid",
      [HISTORY_KINDS.held]: "Money held",
      [HISTORY_KINDS.settlementQueued]: "Wallet transfer queued",
      [HISTORY_KINDS.settled]: "In wallet",
      [HISTORY_KINDS.refunded]: "Funds returned",
      // Support returns held money by hand (PLAN 11.10.3); the refund itself is Funds returned.
      [HISTORY_KINDS.returnQueued]: "Return queued",
      [HISTORY_KINDS.returnReleased]: "Return released",
      [HISTORY_KINDS.receiverSettled]: "Funds moved to wallet",
      [HISTORY_KINDS.checkoutCloseChanged]: "Checkout close updated",
      [HISTORY_KINDS.remindersOn]: "Reminders on",
      [HISTORY_KINDS.remindersOff]: "Reminders off",
      [HISTORY_KINDS.remindersStopped]: "Reminders stopped",
      [HISTORY_KINDS.repeatStopped]: "Repeat stopped",
      [HISTORY_KINDS.invoiceEmailed]: "Invoice emailed",
      [HISTORY_KINDS.invoiceEmailFailed]: "Invoice email failed",
      [HISTORY_KINDS.reminderEmailed]: "Reminder emailed",
      [HISTORY_KINDS.reminderEmailFailed]: "Reminder email failed",
      [HISTORY_KINDS.receiptEmailed]: "Receipt emailed",
      [HISTORY_KINDS.receiptEmailFailed]: "Receipt email failed",
      [HISTORY_KINDS.edited]: "Edited",
      [HISTORY_KINDS.replaced]: "Replaced",
      [HISTORY_KINDS.reopened]: "Reopened",
      [HISTORY_KINDS.numbered]: "Number given",
      [HISTORY_KINDS.crossChainDeposit]: "Seen on another chain",
      [HISTORY_KINDS.crossChainConverted]: "Converted by NEAR Intents",
      [HISTORY_KINDS.crossChainRefunded]: "Returned by NEAR Intents",
      [HISTORY_KINDS.crossChainFailed]: "NEAR Intents conversion failed",
    } satisfies Record<HistoryKind, string>,
    fields: {
      [HISTORY_FIELDS.memo]: "Memo",
      [HISTORY_FIELDS.clientEmail]: "Client email",
      [HISTORY_FIELDS.returnUrl]: "Return link",
      [HISTORY_FIELDS.reference]: "Reference",
      [HISTORY_FIELDS.note]: "Note",
      [HISTORY_FIELDS.dueDate]: "Due date",
    } satisfies Record<HistoryField, string>,
    // An edited due date: its old and new day, or none.
    moved: (field: string, from: string, to: string) => `${field}: ${from} → ${to}`,
    noDate: "none",
    // R-129: the other invoice of a Revise.
    replacedBy: (number: string) => `By ${number}`,
    replaces: (number: string) => `Replaces ${number}`,
    // R-130: when the reopened checkout closes.
    closeChanged: (until: string) => `Closes ${until}`,
    reopenedUntil: (close: string) => `Until ${close}`,
    // Details a kind's label leaves out.
    dropped: "No longer on the chain",
    toClient: "To the client",
    toPayer: "To the payer",
    stoppedByLink: "From the reminder email's stop link",
    steps: {
      [REMINDER_STEPS.before]: "3 days before the due date",
      [REMINDER_STEPS.due]: "On the due date",
      [REMINDER_STEPS.after]: "7 days after the due date",
    } satisfies Record<ReminderStep, string>,
    heldFor: (money: string, network: string) => `${money} for the payer · ${network}`,
    // R-125.
    notOpened: "No pay link opens counted yet.",
    opened: (count: number) =>
      count === 1
        ? "Pay link opened once"
        : `Pay link opened ${count.toLocaleString("en-US")} times`,
    first: "first",
    last: "last",
  },
} as const;

// R-96.
export const STOP_REMINDERS_COPY = {
  title: "Stop payment reminders?",
  body: "You will get no more payment reminders for this invoice. The invoice and its payment page stay as they are.",
  action: "Stop reminders",
  doneTitle: "Reminders stopped",
  // Before the invoice number, kept on one line, and after it.
  doneFor: "You will get no more payment reminders for",
  doneFrom: (from: string | null) => (from ? ` from ${from}.` : "."),
  notFound:
    "This link does not stop any reminders. Check that you opened the whole link from the email.",
  failed: "We could not stop them. Try again.",
} as const;

// R-95, D-114: what customers still owe. Money held for a payer is theirs, so it never shows here.
export const OWED_COPY = {
  title: "Unpaid",
  description: "Not paid in full yet, most urgent first.",
  totalLabel: "Left to pay",
  kinds: {
    [OWED_KINDS.overdue]: (days: number) => (days === 1 ? "1 day late" : `${days} days late`),
    [OWED_KINDS.partlyPaid]: () => "Partially paid",
    [OWED_KINDS.held]: () => "Held for the payer",
  } satisfies Record<OwedKind, (days: number) => string>,
  left: "left to pay",
  none: "Nothing unpaid right now.",
  failed: "We could not load unpaid payments.",
  retry: "Try again",
  showAll: (n: number) => `Show all ${n}`,
  checkout: "Checkout",
  more: (n: number) => (n === 1 ? "1 more is unpaid." : `${n} more are unpaid.`),
  inPayments: "Open Payments",
} as const;

/** R-227: the fees a new invoice or link would carry, before it is saved. */
export const FEES_FORM_COPY = {
  clientPays: "Add the network fee to what your client pays",
  subtotal: "Subtotal",
  networkFee: "Network fee",
  fees: "Network and platform fees",
  clientTotal: "Your client pays",
  youReceive: "You receive",
  // The invoice form's totals: the fee is one of their lines, with who pays it beside it.
  whoPays: "Who pays the network fee",
  paidBy: { owner: "You pay it", client: "Client pays it" },
  clientPaysTotal: "Client pays",
  feeAdded: (fee: string) => `+ ${fee}`,
  feeTaken: (fee: string) => `− ${fee}`,
  pricing: "Pricing the network fee…",
  failed: "The network fee can't be priced right now. Try again in a moment.",
} as const;
