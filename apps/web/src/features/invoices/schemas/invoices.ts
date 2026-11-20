import { z } from "zod";
import { clientBodySchema } from "@/features/clients/schemas/clients";
import {
  DOCUMENT_KINDS,
  PAY_TOKEN_PATTERN,
  PAYMENT_PURPOSES,
  RECONCILIATION_STATES,
  SETTLEMENT_WAITS,
} from "@/features/invoices/constants/invoices";
import type {
  HistoryActor,
  HistoryField,
  HistoryKind,
  InvoiceEventKind,
  OwedKind,
  ReminderStep,
} from "@/features/invoices/types/invoices";
import { FEES_PAID_BY } from "@/features/profiles/constants/profile";
import { storeBrandSchema } from "@/features/stores/schemas/stores";
import {
  apiDate,
  apiTime,
  baseUnits,
  count,
  evmAddress,
  hash32,
  openEnum,
  pageOf,
  usdAmount,
} from "@/shared/schemas/api";
import type { CrossChainStatus } from "@/shared/types/chains";
import type {
  ApiDepositStatus,
  ApiPaymentStatus,
  ApiSettlementStatus,
} from "@/shared/types/payment-state";

export const optionFeesShape = {
  networkFee: baseUnits,
  platformFee: baseUnits,
  feesPaidBy: z.enum(FEES_PAID_BY),
};

export const invoiceClientSchema = z.object({
  name: z.string().nullable(),
  email: z.string().nullable(),
  address: z.string().nullable(),
  country: z.string().nullable(),
  taxId: z.string().nullable(),
});

/** The profile's billing details as they were when the invoice was made. */
export const invoiceIssuerSchema = z.object({
  name: z.string(),
  address: z.string(),
  country: z.string(),
  taxId: z.string().nullable(),
  email: z.string(),
});

export const depositSchema = z.object({
  txHash: hash32,
  logIndex: count,
  from: evmAddress,
  amount: baseUnits,
  blockNumber: count,
  blockTime: apiTime,
  status: openEnum<ApiDepositStatus>(),
  late: z.boolean(), // after the close: held for the payer
  paid: baseUnits.nullable(), // booked to the owner; null until booked
  blocksLeft: count,
  blocksTotal: count,
  secondsLeft: count,
});

/** A price agreed in fiat; amount is in the currency's minor units. */
export const agreedValueSchema = z.object({
  currency: z.string(),
  amount: baseUnits,
  decimals: count,
  date: apiDate,
});

export const invoiceSummarySchema = z.object({
  purpose: z.enum(PAYMENT_PURPOSES),
  documentKind: z.enum(DOCUMENT_KINDS),
  linkId: z.guid().optional(),
  invoiceId: hash32,
  payToken: z.string().regex(PAY_TOKEN_PATTERN).nullable(), // null before pay links existed
  optionId: hash32,
  optionLocked: z.boolean(),
  pickedOptionId: hash32.nullable().optional(),
  optionCount: z.number().int().positive(),
  confirming: z.boolean(),
  closed: z.boolean(), // before paymentStatus catches up
  number: z.number().int().positive().nullable(), // null on a link invoice before money
  title: z.string().nullable(),
  note: z.string().nullable(),
  dueDate: apiDate.nullable(), // shown only; payment closes at closesAt
  supplyDate: apiDate.nullable(),
  reference: z.string().nullable(),
  agreedValue: agreedValueSchema.nullable(),
  client: invoiceClientSchema.optional(),
  store: z.object({ storeId: z.guid(), name: z.string() }).optional(),
  brand: storeBrandSchema.nullish(),
  issuer: invoiceIssuerSchema.nullable(),
  senderName: z.string().nullable(),
  returnUrl: z.string().nullable(),
  chainId: count,
  livemode: z.boolean(), // false on a testnet
  token: evmAddress,
  amount: baseUnits,
  ...optionFeesShape,
  recipient: evmAddress,
  factory: evmAddress,
  receiveAddress: evmAddress,
  expiresAt: apiTime, // the terms'; checkout closes at closesAt
  closesAt: apiTime,
  settleDeadline: apiTime,
  paymentStatus: openEnum<ApiPaymentStatus>(),
  settlementStatus: openEnum<ApiSettlementStatus>(),
  state: z.string().optional(),
  wallet: z.string().optional(),
  settlementTxHash: hash32.nullable(),
  createdAt: apiTime,
});

const settlementWaitSchema = z.object({
  kind: z.enum(SETTLEMENT_WAITS),
  until: apiTime.nullable(), // retrying, dailyLimit
  secondsLeft: count.nullable(), // finalizing
});

export const paymentAmountsSchema = z.object({
  reconciliationStatus: z.enum(RECONCILIATION_STATES).optional(),
  receiver: z.string().regex(/^-?\d+$/),
  payable: z.string().regex(/^-?\d+$/),
  held: z.string().regex(/^-?\d+$/),
  settled: baseUnits,
  fees: baseUnits.optional(),
  refunded: baseUnits,
  observedRefunded: baseUnits,
  lastReturnTxHash: hash32.nullable(),
  unreconciled: z.boolean(),
  hasPolicyException: z.boolean().optional(),
});

const depositSummarySchema = z.object({
  count,
  onTimeAmount: baseUnits,
  lateAmount: baseUnits,
  pendingAmount: baseUnits,
});

export const invoiceOptionSchema = z.object({
  amounts: paymentAmountsSchema.optional(),
  closesAt: apiTime.optional(),
  optionId: hash32,
  chainId: count,
  network: z.string(),
  token: evmAddress,
  symbol: z.string(),
  decimals: count,
  amount: baseUnits,
  ...optionFeesShape,
  receiveAddress: evmAddress,
  deposits: z.array(depositSchema),
  depositSummary: depositSummarySchema.optional(),
});

/** In base units of the option whose id is the invoice's; quantity has 2 decimals. */
export const invoiceLineSchema = z.object({
  description: z.string(),
  quantity: z.string(),
  unitPrice: baseUnits,
  amount: baseUnits,
});

/** sentAt and failedAt stay null while the email waits. */
export const invoiceSendSchema = z.object({
  requestedAt: apiTime,
  sentAt: apiTime.nullable(),
  failedAt: apiTime.nullable(),
});

export const invoiceRemindersSchema = z.object({
  on: z.boolean(),
  stoppedAt: apiTime.nullable(),
  emails: z.array(invoiceSendSchema.extend({ step: openEnum<ReminderStep>() })),
});

/** The next dates are null once the retainer ended or stopped. */
export const invoiceRetainerSchema = z.object({
  endDate: apiDate.nullable(),
  nextDueDate: apiDate.nullable(),
  nextOn: apiDate.nullable(),
  stoppedAt: apiTime.nullable(),
});

/** The other invoice of a Revise. */
export const revisionSchema = z.object({
  invoiceId: hash32,
  number: z.number().int().positive(),
  payToken: z.string().regex(PAY_TOKEN_PATTERN).nullable(),
});

/** Fields from optionId on are null when the row has none. */
export const invoiceHistoryEventSchema = z.object({
  id: count,
  kind: openEnum<HistoryKind>(),
  actor: openEnum<HistoryActor>(),
  at: apiTime,
  optionId: hash32.nullable(),
  amount: baseUnits.nullable(),
  txHash: hash32.nullable(),
  step: openEnum<ReminderStep>().nullable(),
  field: openEnum<HistoryField>().nullable(),
  from: apiDate.nullable(),
  to: z.union([apiDate, evmAddress]).nullable(), // a new due date, or a return's address
  until: apiTime.nullable(),
  related: revisionSchema.nullable(),
});

const invoiceUpdateSchema = z.object({
  at: apiTime,
  field: openEnum<HistoryField>(),
  from: apiDate.nullable(),
  to: apiDate.nullable(),
});

/** Pay page loads; both times are null before the first. */
export const invoiceViewsSchema = z.object({
  count,
  firstAt: apiTime.nullable(),
  lastAt: apiTime.nullable(),
});

export const payerEmailSchema = z.object({ email: z.string() });

export const stoppedRemindersSchema = z.object({
  number: z.number().int().positive(),
  from: z.string().nullable(),
});

/** A payment through NEAR Intents. */
const crossChainTxSchema = z.object({ hash: z.string(), explorerUrl: z.string() });
export const crossChainSchema = z.object({
  quoteId: z.string(),
  assetId: z.string(),
  blockchain: z.string(),
  symbol: z.string(),
  decimals: count,
  depositAddress: z.string(),
  refundTo: z.string(),
  amountIn: baseUnits,
  minAmountIn: baseUnits,
  amountOut: baseUnits,
  status: openEnum<CrossChainStatus>(),
  deposited: baseUnits.nullable(),
  delivered: baseUnits.nullable(),
  refunded: baseUnits.nullable(),
  refundReason: z.string().nullable(),
  originTxs: z.array(crossChainTxSchema),
  destinationTxs: z.array(crossChainTxSchema),
  shownUntil: apiTime,
  deadline: apiTime,
  createdAt: apiTime,
  depositSeenAt: apiTime.nullable(),
  convertedAt: apiTime.nullable(),
  signed: z.unknown(), // checked again before the address shows
});

/** From replaces on, the fields come only in the owner's reads. */
export const invoiceSchema = invoiceSummarySchema.extend({
  amounts: paymentAmountsSchema.optional(),
  options: z.array(invoiceOptionSchema),
  paidAt: apiTime.nullable(),
  settledAt: apiTime.nullable(),
  canceledAt: apiTime.nullable(),
  deposits: z.array(depositSchema),
  depositSummary: depositSummarySchema.optional(),
  nextCheckAt: apiTime.nullable(),
  lines: z.array(invoiceLineSchema),
  updates: z.array(invoiceUpdateSchema),
  replacedBy: revisionSchema.nullable(),
  crossChain: crossChainSchema.nullable().optional(),
  crossChainOn: z.boolean().optional(),
  replaces: revisionSchema.nullable().optional(),
  settlementWait: settlementWaitSchema.nullable().optional(),
  sends: z.array(invoiceSendSchema).optional(),
  reminders: invoiceRemindersSchema.optional(),
  retainer: invoiceRetainerSchema.nullable().optional(),
  history: z.array(invoiceHistoryEventSchema).optional(),
  views: invoiceViewsSchema.optional(),
  memo: z.string().nullable().optional(),
  reopenUntil: apiTime.nullable().optional(),
});

/** What Check status found. */
export const recheckSchema = z.object({
  onChain: baseUnits,
  recorded: baseUnits,
  rescanning: z.boolean(),
  nextCheckAt: apiTime,
  unreadable: z.array(count), // chains whose network didn't answer
});

export const invoicesPageSchema = pageOf(invoiceSummarySchema);

/** Each option's fees for a price, before the invoice is made. */
export const feeQuoteSchema = z.object({
  feesPaidBy: z.enum(FEES_PAID_BY),
  options: z.array(
    z.object({
      chainId: count,
      token: evmAddress,
      decimals: count,
      price: baseUnits,
      networkFee: baseUnits,
      platformFee: baseUnits,
    }),
  ),
});

/** One token: chainId, token and amount; the payer chooses: amountUsd alone. */
export const createInvoiceBodySchema = z.object({
  replaces: hash32.optional(),
  feesPaidBy: z.enum(FEES_PAID_BY).optional(), // left out: the profile's
  storeId: z.guid().optional(),
  chainId: count.optional(),
  token: evmAddress.optional(),
  amount: baseUnits.optional(),
  amountUsd: usdAmount.optional(),
  returnUrl: z.string(),
  expiresIn: z.number().int().positive(),
  title: z.string(),
  note: z.string(),
  dueDate: z.string(),
  supplyDate: z.string(),
  reference: z.string(),
  agreedValue: z.object({ currency: z.string(), amount: z.string(), date: z.string() }).optional(),
  reminders: z.literal(true).optional(),
  repeat: z.object({ endDate: z.string().optional() }).optional(),
  senderName: z.string(),
  client: clientBodySchema,
  lines: z
    .array(z.object({ description: z.string(), quantity: z.string(), unitPrice: z.string() }))
    .optional(),
});

/** amount: net of fees when settled, the newly held part when held. */
export const invoiceEventSchema = z.object({
  id: z.number().int(),
  kind: openEnum<InvoiceEventKind>(),
  invoiceId: hash32,
  number: z.number().int().positive().nullable(),
  purpose: z.enum(PAYMENT_PURPOSES).optional(),
  documentKind: z.enum(DOCUMENT_KINDS).optional(),
  title: z.string().nullable().optional(),
  chainId: count,
  token: evmAddress,
  symbol: z.string(),
  decimals: count,
  amount: baseUnits,
  at: apiTime,
});

export const invoiceEventsSchema = z.object({ items: z.array(invoiceEventSchema) });

/** amount is what is left to pay, or the held amount for held money. */
export const owedSchema = z.object({
  kind: openEnum<OwedKind>(),
  invoiceId: hash32,
  number: z.number().int().positive().nullable(),
  reference: z.string().nullable().optional(),
  title: z.string().nullable(),
  clientName: z.string().nullable(),
  dueDate: apiDate.nullable(),
  daysLate: count, // whole UTC days
  optionCount: count,
  chainId: count,
  token: evmAddress,
  symbol: z.string(),
  decimals: count,
  amount: baseUnits,
});

/** The first rows by urgency; count and totals cover every row. */
export const owedListSchema = z.object({
  items: z.array(owedSchema),
  count: count.optional(),
  totals: z
    .array(
      z.object({
        chainId: count,
        token: evmAddress,
        symbol: z.string(),
        decimals: count,
        amount: baseUnits,
      }),
    )
    .optional(),
});
