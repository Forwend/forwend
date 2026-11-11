import type { z } from "zod";
import type { TokenBalance } from "@/features/balances/types/balances";
import type { ClientBody } from "@/features/clients/types/clients";
import type {
  AMOUNT_ERRORS,
  EXPIRY_CHOICES,
  HISTORY_ACTORS,
  HISTORY_CATEGORIES,
  HISTORY_FIELDS,
  HISTORY_FILTERS,
  HISTORY_KINDS,
  INVOICE_EVENTS,
  INVOICE_EXCEPTIONS,
  INVOICE_FIELDS,
  INVOICE_PDFS,
  INVOICE_STEPS,
  LINE_ERRORS,
  OWED_KINDS,
  PAY_WITH,
  RECORD_STEPS,
  REMINDER_STEPS,
  SETTLEMENT_WAITS,
} from "@/features/invoices/constants/invoices";
import type {
  agreedValueSchema,
  createInvoiceBodySchema,
  depositSchema,
  feeQuoteSchema,
  invoiceClientSchema,
  invoiceEventSchema,
  invoiceHistoryEventSchema,
  invoiceLineSchema,
  invoiceOptionSchema,
  invoiceRemindersSchema,
  invoiceRetainerSchema,
  invoiceSchema,
  invoiceSendSchema,
  invoiceSummarySchema,
  invoicesPageSchema,
  invoiceViewsSchema,
  owedListSchema,
  owedSchema,
  recheckSchema,
  revisionSchema,
  stoppedRemindersSchema,
} from "@/features/invoices/schemas/invoices";
import type { FeesPaidBy } from "@/features/profiles/types/profile";

export type PayWith = (typeof PAY_WITH)[keyof typeof PAY_WITH];
/** An option's amount and the fees in its terms (R-228). */
export interface FeeTerms {
  amount: string;
  networkFee: string;
  platformFee: string;
  feesPaidBy: FeesPaidBy;
}
/** Settlement pays the fees out of the amount; the owner receives net. */
export interface OptionFees {
  network: bigint;
  platform: bigint;
  total: bigint;
  net: bigint;
  clientPays: boolean;
}
export type InvoiceEventKind = (typeof INVOICE_EVENTS)[keyof typeof INVOICE_EVENTS];
export type OwedKind = (typeof OWED_KINDS)[keyof typeof OWED_KINDS];
export type ReminderStep = (typeof REMINDER_STEPS)[keyof typeof REMINDER_STEPS];
export type InvoiceReminders = z.infer<typeof invoiceRemindersSchema>;
export type InvoiceRetainer = z.infer<typeof invoiceRetainerSchema>;
export type StoppedReminders = z.infer<typeof stoppedRemindersSchema>;
export type Owed = z.infer<typeof owedSchema>;

export type OwedList = z.infer<typeof owedListSchema>;
export type InvoiceEvent = z.infer<typeof invoiceEventSchema>;
export type HistoryKind = (typeof HISTORY_KINDS)[keyof typeof HISTORY_KINDS];
export type HistoryActor = (typeof HISTORY_ACTORS)[keyof typeof HISTORY_ACTORS];
export type HistoryField = (typeof HISTORY_FIELDS)[keyof typeof HISTORY_FIELDS];
export type HistoryCategory = (typeof HISTORY_CATEGORIES)[keyof typeof HISTORY_CATEGORIES];
export type HistoryFilter = (typeof HISTORY_FILTERS)[keyof typeof HISTORY_FILTERS];
export type InvoiceHistoryEvent = z.infer<typeof invoiceHistoryEventSchema>;
export type InvoiceViews = z.infer<typeof invoiceViewsSchema>;
export type Revision = z.infer<typeof revisionSchema>;
export type InvoiceExceptionKind = (typeof INVOICE_EXCEPTIONS)[keyof typeof INVOICE_EXCEPTIONS];

export type RecordStepId = (typeof RECORD_STEPS)[keyof typeof RECORD_STEPS];

/** One step of the owner's record, from the facts the API gave. */
export interface RecordStep {
  id: RecordStepId;
  at: string | null;
  done: boolean;
  /** How often the pay page was opened, on the opened step. */
  count?: number;
}

/** Base units of the shown option: received before expiry, still left to pay, and arrived after it (held). */
export interface InvoiceException {
  kind: InvoiceExceptionKind | null;
  received: bigint;
  left: bigint;
  late: bigint;
}

export interface InvoiceStart {
  payWith: PayWith;
  picked: string;
  /** The price: what the client pays less any fees they paid on top. */
  amount: string;
  /** Who paid the fees of the invoice it starts from (D-122). */
  feesPaidBy?: FeesPaidBy;
  items: LineDraft[];
  title: string;
  note: string;
  returnUrl: string;
  reference: string;
  agreed: AgreedDraft | null;
  client: ClientBody;
  reminders: boolean;
  // A merchant invoice's store (R-134).
  storeId?: string;
}

export type ExpiryChoice = keyof typeof EXPIRY_CHOICES;
export type InvoiceField = (typeof INVOICE_FIELDS)[keyof typeof INVOICE_FIELDS];
export type AmountError = (typeof AMOUNT_ERRORS)[keyof typeof AMOUNT_ERRORS];
export type InvoiceStep = (typeof INVOICE_STEPS)[keyof typeof INVOICE_STEPS];
export type InvoicePdf = (typeof INVOICE_PDFS)[keyof typeof INVOICE_PDFS];

export type InvoiceToken = Pick<TokenBalance, "chainId" | "token" | "symbol" | "decimals">;

export type InvoiceClient = z.infer<typeof invoiceClientSchema>;

export type InvoiceLine = z.infer<typeof invoiceLineSchema>;

export type AgreedValue = z.infer<typeof agreedValueSchema>;

/** An agreed value as the form holds it (R-93): no currency yet is "". */
export interface AgreedDraft {
  currency: string;
  amount: string;
  date: string | null;
}

/** R-88. */
export interface LineDraft {
  id: string;
  description: string;
  quantity: string;
  price: string;
}

export type LineField = Exclude<keyof LineDraft, "id">;

export type LineError = (typeof LINE_ERRORS)[keyof typeof LINE_ERRORS];

export type Deposit = z.infer<typeof depositSchema>;

export type InvoiceSummary = z.infer<typeof invoiceSummarySchema>;
export type SettlementWaitKind = (typeof SETTLEMENT_WAITS)[keyof typeof SETTLEMENT_WAITS];

export type InvoiceOption = z.infer<typeof invoiceOptionSchema>;

export type Invoice = z.infer<typeof invoiceSchema>;
export type FeeQuote = z.infer<typeof feeQuoteSchema>;

export type InvoiceSend = z.infer<typeof invoiceSendSchema>;

export type Recheck = z.infer<typeof recheckSchema>;

export type InvoicesPage = z.infer<typeof invoicesPageSchema>;

export type CreateInvoiceBody = z.infer<typeof createInvoiceBodySchema>;
