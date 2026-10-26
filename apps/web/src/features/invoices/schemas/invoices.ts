import { z } from "zod";
import type {
  ApiDepositStatus,
  ApiPaymentStatus,
  ApiSettlementStatus,
} from "@/features/activity/types/activity";
import { clientBodySchema } from "@/features/clients/schemas/clients";
import {
  DOCUMENT_KINDS,
  PAY_TOKEN_PATTERN,
  PAYMENT_PURPOSES,
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
  // Paid after expiry: held for the payer, never the creator's.
  late: z.boolean(),
  // The part the ledger booked to the creator at booking (R-121): all, part, or "0" when held; null until booked.
  paid: baseUnits.nullable(),
  blocksLeft: count,
  // The blocks it had to wait when first seen, fixed across reads: blocksTotal - blocksLeft have passed (R-73).
  blocksTotal: count,
  secondsLeft: count,
});

/** The price agreed with the client in fiat (R-93): amount in the currency's minor units (cents). */
export const agreedValueSchema = z.object({
  currency: z.string(),
  amount: baseUnits,
  decimals: count,
  date: apiDate,
});

/** openapi.yaml, InvoiceSummary. */
export const invoiceSummarySchema = z.object({
  purpose: z.enum(PAYMENT_PURPOSES).optional(),
  documentKind: z.enum(DOCUMENT_KINDS).optional(),
  linkId: z.guid().optional(),
  // keccak256 of payToken; the chain shows it, so it opens no public route (D-86).
  invoiceId: hash32,
  // The pay link's token; null for an invoice made before D-86, which has no pay link.
  payToken: z.string().regex(PAY_TOKEN_PATTERN).nullable(),
  // The on-chain id in the terms below: invoiceId, or the chosen or first option's of a payer-chooses invoice.
  optionId: hash32,
  // An option received money, so the payer can't pick another (R-56).
  optionLocked: z.boolean(),
  optionCount: z.number().int().positive(),
  // A payment before expiry is seen and not final: a partly paid invoice reads as confirming meanwhile (R-69).
  confirming: z.boolean(),
  // The checkout closed and it can no longer be paid, before paymentStatus catches up: show it expired (R-77).
  closed: z.boolean(),
  // Null for a payment-link invoice before its first deposit, when only its payer sees it (R-141).
  number: z.number().int().positive().nullable(),
  title: z.string().nullable(),
  note: z.string().nullable(),
  // YYYY-MM-DD; shown only, payment closes at closesAt.
  dueDate: apiDate.nullable(),
  // When the work was done or delivered (R-89).
  supplyDate: apiDate.nullable(),
  // The client's PO number or their reference (R-90).
  reference: z.string().nullable(),
  agreedValue: agreedValueSchema.nullable(),
  // Only in the owner's answers (create, list and the profile's read); the public GET leaves it out.
  client: invoiceClientSchema.optional(),
  // A merchant invoice's store (R-134), in the owner's answers only.
  store: z.object({ storeId: z.guid(), name: z.string() }).optional(),
  // Its store's branding (R-135); null without a store.
  brand: storeBrandSchema.nullish(),
  issuer: invoiceIssuerSchema.nullable(),
  // The name the payer sees when there is no issuer, such as on a personal profile's request.
  senderName: z.string().nullable(),
  // The creator's https link, offered to the payer once paid (R-58).
  returnUrl: z.string().nullable(),
  chainId: count,
  // False on a testnet: test mode, whose tokens have no value (D-87, R-143).
  livemode: z.boolean(),
  token: evmAddress,
  amount: baseUnits,
  // The profile wallet that settlement pays.
  recipient: evmAddress,
  receiveAddress: evmAddress,
  // The terms' expiry, which the receive address commits to; checkout closes at closesAt (R-130).
  expiresAt: apiTime,
  closesAt: apiTime,
  settleDeadline: apiTime,
  paymentStatus: openEnum<ApiPaymentStatus>(),
  settlementStatus: openEnum<ApiSettlementStatus>(),
  settlementTxHash: hash32.nullable(),
  createdAt: apiTime,
});

export const settlementWaitSchema = z.object({
  kind: z.enum(SETTLEMENT_WAITS),
  // retrying and dailyLimit: when the signer tries again.
  until: apiTime.nullable(),
  // finalizing: estimated chain time until the settle is final.
  secondsLeft: count.nullable(),
});

/** One token and network the invoice accepts, with its own on-chain id, amount and address (R-56). */
export const invoiceOptionSchema = z.object({
  optionId: hash32,
  chainId: count,
  network: z.string(),
  token: evmAddress,
  symbol: z.string(),
  decimals: count,
  amount: baseUnits,
  receiveAddress: evmAddress,
  // On an option other than the shown one, these are held for the payer (D-76).
  deposits: z.array(depositSchema),
});

/** One line item (R-88), in the base units of the option whose id is the invoice's; quantity has 2 decimals. */
export const invoiceLineSchema = z.object({
  description: z.string(),
  quantity: z.string(),
  unitPrice: baseUnits,
  amount: baseUnits,
});

/** One Send to client (R-94): sentAt and failedAt stay null while the email waits. */
export const invoiceSendSchema = z.object({
  requestedAt: apiTime,
  sentAt: apiTime.nullable(),
  failedAt: apiTime.nullable(),
});

/** Payment reminders (R-96); stoppedAt is when the client stopped them. */
export const invoiceRemindersSchema = z.object({
  on: z.boolean(),
  stoppedAt: apiTime.nullable(),
  emails: z.array(invoiceSendSchema.extend({ step: openEnum<ReminderStep>() })),
});

/** R-98: the next dates are null once the retainer ended or stopped. */
export const invoiceRetainerSchema = z.object({
  endDate: apiDate.nullable(),
  nextDueDate: apiDate.nullable(),
  nextOn: apiDate.nullable(),
  stoppedAt: apiTime.nullable(),
});

/** The other invoice of a Revise (R-129); payToken is the replacement's pay link. */
export const revisionSchema = z.object({
  invoiceId: hash32,
  number: z.number().int().positive(),
  payToken: z.string().regex(PAY_TOKEN_PATTERN).nullable(),
});

/** One history row (R-124, R-126 to R-130); its last nine fields are null when the row has none. */
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
  to: apiDate.nullable(),
  until: apiTime.nullable(),
  related: revisionSchema.nullable(),
});

/** An edit the payer sees (R-128); from and to are a due date's old and new value. */
export const invoiceUpdateSchema = z.object({
  at: apiTime,
  field: openEnum<HistoryField>(),
  from: apiDate.nullable(),
  to: apiDate.nullable(),
});

/** Pay page loads (R-125); both times are null before the first. */
export const invoiceViewsSchema = z.object({
  count,
  firstAt: apiTime.nullable(),
  lastAt: apiTime.nullable(),
});

/** POST /v1/reminders/{token}/stop. */
export const stoppedRemindersSchema = z.object({
  number: z.number().int().positive(),
  from: z.string().nullable(),
});

export const invoiceSchema = invoiceSummarySchema.extend({
  // Every accepted option, the shown one included: one for a fixed invoice.
  options: z.array(invoiceOptionSchema),
  // Once paid: the block time of the deposit that completed the amount.
  paidAt: apiTime.nullable(),
  // Once settled: when the settlement was recorded as final.
  settledAt: apiTime.nullable(),
  // When the owner canceled it (R-79).
  canceledAt: apiTime.nullable(),
  deposits: z.array(depositSchema),
  // When Check status may run again; null when it may now (R-55).
  nextCheckAt: apiTime.nullable(),
  // Its line items, empty without a breakdown (R-88).
  lines: z.array(invoiceLineSchema),
  // The edits the payer sees, newest first (R-128).
  updates: z.array(invoiceUpdateSchema),
  // The invoice a Revise replaced it with (R-129).
  replacedBy: revisionSchema.nullable(),
  // Only in the owner's reads: the invoice it replaced.
  replaces: revisionSchema.nullable().optional(),
  // Only in the owner's reads: null while not paid or once settled.
  settlementWait: settlementWaitSchema.nullable().optional(),
  // Only in the owner's reads: each Send to client, oldest first.
  sends: z.array(invoiceSendSchema).optional(),
  // Only in the owner's reads.
  reminders: invoiceRemindersSchema.optional(),
  // Only in the owner's reads: null when it doesn't repeat.
  retainer: invoiceRetainerSchema.nullable().optional(),
  // Only in the owner's reads: every change, newest first.
  history: z.array(invoiceHistoryEventSchema).optional(),
  // Only in the owner's reads.
  views: invoiceViewsSchema.optional(),
  // Only in the owner's reads: the owner's own note (R-127).
  memo: z.string().nullable().optional(),
  // Only in the owner's reads: the close a reopen would give now (R-130); null when it can't reopen.
  reopenUntil: apiTime.nullable().optional(),
});

/** POST /v1/invoices/{payToken}/recheck (R-55): what Check status found. Amounts in base units. */
export const recheckSchema = z.object({
  onChain: baseUnits,
  recorded: baseUnits,
  rescanning: z.boolean(),
  nextCheckAt: apiTime,
  // Chains of options whose network did not answer; the others were checked (F144).
  unreadable: z.array(count),
});

export const invoicesPageSchema = pageOf(invoiceSummarySchema);

/** Fixed: chainId, token and amount; payer chooses: amountUsd alone (R-56). */
export const createInvoiceBodySchema = z.object({
  // R-129: the invoice it replaces.
  replaces: hash32.optional(),
  // R-134: a merchant invoice's store.
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
  // R-93: amount as a decimal in the currency's own decimals.
  agreedValue: z.object({ currency: z.string(), amount: z.string(), date: z.string() }).optional(),
  // Payment reminders on at once (R-97); sent only when true.
  reminders: z.literal(true).optional(),
  // Repeat every month (R-98); sent only when checked, with endDate only when picked.
  repeat: z.object({ endDate: z.string().optional() }).optional(),
  senderName: z.string(),
  client: clientBodySchema,
  // R-88: unitPrice in the amount's own unit, base units with amount and a USD decimal with amountUsd.
  lines: z
    .array(z.object({ description: z.string(), quantity: z.string(), unitPrice: z.string() }))
    .optional(),
});

/** One of the bell's events (R-81): GET /v1/profiles/{id}/events. */
export const invoiceEventSchema = z.object({
  id: z.number().int(),
  kind: openEnum<InvoiceEventKind>(),
  invoiceId: hash32,
  number: z.number().int().positive(),
  chainId: count,
  token: evmAddress,
  symbol: z.string(),
  decimals: count,
  // The option's amount; for held money, the amount newly held for the payer.
  amount: baseUnits,
  at: apiTime,
});

export const invoiceEventsSchema = z.object({ items: z.array(invoiceEventSchema) });

/** One Owed to you row (R-95): amount is what is left to pay, or for held money the held amount. */
export const owedSchema = z.object({
  kind: openEnum<OwedKind>(),
  invoiceId: hash32,
  number: z.number().int().positive(),
  title: z.string().nullable(),
  clientName: z.string().nullable(),
  dueDate: apiDate.nullable(),
  // Whole UTC days past the due date; 0 unless overdue.
  daysLate: count,
  // Above 1 the client chooses the token, so an unpaid row reads in USD (D-75).
  optionCount: count,
  chainId: count,
  token: evmAddress,
  symbol: z.string(),
  decimals: count,
  amount: baseUnits,
});

export const owedListSchema = z.object({ items: z.array(owedSchema) });
