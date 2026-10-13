import type { z } from "zod";
import type { TokenBalance } from "@/features/balances/types/balances";
import type {
  AMOUNT_ERRORS,
  EXPIRY_CHOICES,
  INVOICE_FIELDS,
  INVOICE_PDFS,
  INVOICE_STEPS,
  PAY_WITH,
  SETTLEMENT_WAITS,
} from "@/features/invoices/constants/invoices";
import type {
  createInvoiceBodySchema,
  depositSchema,
  invoiceClientSchema,
  invoiceIssuerSchema,
  invoiceOptionSchema,
  invoiceSchema,
  invoiceSummarySchema,
  invoicesPageSchema,
  recheckSchema,
  settlementWaitSchema,
} from "@/features/invoices/schemas/invoices";

export type PayWith = (typeof PAY_WITH)[keyof typeof PAY_WITH];

export type ExpiryChoice = keyof typeof EXPIRY_CHOICES;
export type InvoiceField = (typeof INVOICE_FIELDS)[keyof typeof INVOICE_FIELDS];
export type AmountError = (typeof AMOUNT_ERRORS)[keyof typeof AMOUNT_ERRORS];
export type InvoiceStep = (typeof INVOICE_STEPS)[keyof typeof INVOICE_STEPS];
export type InvoicePdf = (typeof INVOICE_PDFS)[keyof typeof INVOICE_PDFS];

/** An enabled token, as GET /v1/profiles/{id}/balances lists it. */
export type InvoiceToken = Pick<TokenBalance, "chainId" | "token" | "symbol" | "decimals">;

export type InvoiceClient = z.infer<typeof invoiceClientSchema>;

export type InvoiceIssuer = z.infer<typeof invoiceIssuerSchema>;

export type Deposit = z.infer<typeof depositSchema>;

export type InvoiceSummary = z.infer<typeof invoiceSummarySchema>;
export type SettlementWaitKind = (typeof SETTLEMENT_WAITS)[keyof typeof SETTLEMENT_WAITS];

export type SettlementWait = z.infer<typeof settlementWaitSchema>;

export type InvoiceOption = z.infer<typeof invoiceOptionSchema>;

export type Invoice = z.infer<typeof invoiceSchema>;

export type Recheck = z.infer<typeof recheckSchema>;

export type InvoicesPage = z.infer<typeof invoicesPageSchema>;

export type CreateInvoiceBody = z.infer<typeof createInvoiceBodySchema>;
