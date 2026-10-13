import {
  AMOUNT_ERRORS,
  type EXPIRY_CHOICES,
  INVOICE_FIELDS,
  INVOICE_LIMITS,
  INVOICE_PDFS,
  INVOICE_STEPS,
  type InvoicePdf,
  type InvoiceStep,
  type Recheck,
  SETTLEMENT_WAITS,
  type SettlementWaitKind,
} from "@/features/invoices/invoices";

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
  search: "Search invoices",
  searchPlaceholder: "Number, client, title",
  noMatch: "No invoices match.",
  columns: {
    invoice: "Invoice",
    client: "Client",
    due: "Due",
    status: "Status",
    amount: "Amount",
  },
  personal: "Invoices are for freelancer and merchant profiles. Switch to one to bill a client.",
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
  search: "Search requests",
  searchPlaceholder: "Number or note",
  noMatch: "No requests match.",
} as const;

export const NEW_INVOICE_COPY = {
  title: "New invoice",
  intro: "The client pays the exact amount on the network you choose. You get a link to send them.",
  noTokens:
    "No networks are enabled yet, so there is nothing to bill in. You can't create an invoice yet.",
  tokensFailed: "We could not load the networks and tokens you can bill in.",
  tokenLabel: "Network and token",
  amountLabel: "Amount",
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
  dueLabel: "Due date (optional)",
  dueHint: "Shown to the client. Payment stays open until the checkout closes.",
  expiryLabel: "Checkout closes after",
  expiryHint: "After this the pay link takes no more payments.",
  expiry: {
    hour: "1 hour",
    day: "1 day",
    week: "7 days",
    month: "30 days",
  } satisfies Record<keyof typeof EXPIRY_CHOICES, string>,
  client: "Client (optional)",
  clientName: "Name",
  clientEmail: "Email",
  clientAddress: "Address",
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
    [INVOICE_FIELDS.senderName]: `${atMost(INVOICE_LIMITS.senderName)} The name can't be Forwend.`,
  },
  failed: "We could not create the invoice. Try again.",
  invalid: "We could not create the invoice with these values. Check them and try again.",
} as const;

export const NEW_REQUEST_COPY = {
  ...NEW_INVOICE_COPY,
  title: "Request money",
  noTokens: "No networks are enabled yet, so there is nothing to request in.",
  tokensFailed: "We could not load the networks and tokens you can request in.",
  noteLabel: "Note to the payer (optional)",
  senderLabel: "Your name (shown to the payer)",
  senderMissing: "Enter the name the payer will see.",
  create: "Create request",
  failed: "We could not create the request. Try again.",
  invalid: "We could not create the request with these values. Check them and try again.",
  created: "Request created",
  view: "View request",
  shareHint: "Send this link to the payer. They pay without an account.",
} as const;

export const INVOICE_COPY = {
  back: "Invoices",
  notFound: "No invoice has this link.",
  failed: "We could not load this invoice.",
  otherProfile: "This invoice belongs to another profile. Switch to that profile to see it.",
  retry: "Try again",
  amount: "Amount",
  progress: "Payment progress",
  steps: {
    [INVOICE_STEPS.detected]: "Detected",
    [INVOICE_STEPS.confirming]: "Confirming",
    [INVOICE_STEPS.paid]: "Paid",
    [INVOICE_STEPS.settled]: "Settled",
  } satisfies Record<InvoiceStep, string>,
  confirming: (seconds: number) => `Confirming · ${timeLeft(seconds)} left`,
  blocks: (blocks: number) =>
    blocks === 1 ? "1 block" : `${blocks.toLocaleString("en-US")} blocks`,
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
    if (r.rescanning && missing > 0n)
      return `Found ${money(missing)} that is not recorded yet. Recording it now; this page updates by itself.`;
    if (r.rescanning) return `Looking at ${network} again; this page updates by itself.`;
    // A full look ran minutes ago and found no transfer for it, such as Arc's native USDC.
    if (missing > 0n)
      return `${money(missing)} at the address has no recorded transfer. A full check ran a few minutes ago; check again later.`;
    if (BigInt(r.onChain) === 0n && BigInt(r.recorded) === 0n)
      return `Nothing has arrived on ${network} yet. A payment shows once the network finalizes it.`;
    return "Up to date: every payment at the address is recorded.";
  },
  recheckFailed: "We could not reach the network. Try again in a moment.",
  recheckTooSoon: "This invoice was just checked. Try again in a few seconds.",
  deposits: "Payments received",
  late: "After the checkout closed",
  from: "From",
  share: "Pay link",
  shareHint: "Send this link to your client. They pay without an account.",
  copy: "Copy link",
  copied: "Link copied",
  copyFailed: "Copy failed: select the link above",
  details: "Details",
  dueDate: "Due date",
  expires: "Checkout closes",
  created: "Created",
  settlement: "Settlement transaction",
  note: "Note",
  pdfs: "Documents",
  pdf: {
    [INVOICE_PDFS.invoice]: "Invoice PDF",
    [INVOICE_PDFS.receipt]: "Receipt PDF",
  } satisfies Record<InvoicePdf, string>,
  none: "None",
  client: "Client",
  noClient: "No client details.",
  clientFailed: "We could not load the client details.",
  issuer: "From",
  taxId: "Tax ID",
  noIssuer:
    "No billing details: the profile had none when this invoice was made, so the client sees no sender name or address.",
} as const;
