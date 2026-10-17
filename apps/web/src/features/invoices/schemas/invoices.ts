import { z } from "zod";
import type {
  ApiDepositStatus,
  ApiPaymentStatus,
  ApiSettlementStatus,
} from "@/features/activity/types/activity";
import { clientBodySchema } from "@/features/clients/schemas/clients";
import { SETTLEMENT_WAITS } from "@/features/invoices/constants/invoices";
import type { InvoiceEventKind, OwedKind, ReminderStep } from "@/features/invoices/types/invoices";
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
  // The pay link's id.
  invoiceId: hash32,
  // The on-chain id in the terms below: invoiceId, or the chosen or first option's of a payer-chooses invoice.
  optionId: hash32,
  // An option received money, so the payer can't pick another (R-56).
  optionLocked: z.boolean(),
  // How many tokens and networks it accepts; 1 for a fixed invoice.
  optionCount: z.number().int().positive(),
  // A payment before expiry is seen and not final: a partly paid invoice reads as confirming meanwhile (R-69).
  confirming: z.boolean(),
  // The checkout closed and it can no longer be paid, before paymentStatus catches up: show it expired (R-77).
  closed: z.boolean(),
  number: z.number().int().positive(),
  title: z.string().nullable(),
  note: z.string().nullable(),
  // YYYY-MM-DD; shown only, payment closes at expiresAt.
  dueDate: apiDate.nullable(),
  // When the work was done or delivered (R-89).
  supplyDate: apiDate.nullable(),
  // The client's PO number or their reference (R-90).
  reference: z.string().nullable(),
  agreedValue: agreedValueSchema.nullable(),
  // Only in the owner's answers (create, list and the profile's read); the public GET leaves it out.
  client: invoiceClientSchema.optional(),
  issuer: invoiceIssuerSchema.nullable(),
  // The name the payer sees when there is no issuer, such as on a personal profile's request.
  senderName: z.string().nullable(),
  // The creator's https link, offered to the payer once paid (R-58).
  returnUrl: z.string().nullable(),
  chainId: count,
  token: evmAddress,
  amount: baseUnits,
  // The profile wallet that settlement pays.
  recipient: evmAddress,
  receiveAddress: evmAddress,
  expiresAt: apiTime,
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
  // The API's chain name, such as base-sepolia.
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

/** Payment reminders (R-96): stoppedAt is when the client stopped them; each reminder queued, with its step. */
export const invoiceRemindersSchema = z.object({
  on: z.boolean(),
  stoppedAt: apiTime.nullable(),
  emails: z.array(invoiceSendSchema.extend({ step: openEnum<ReminderStep>() })),
});

/** POST /v1/reminders/{token}/stop: which invoice the client stopped reminders for, and who sent it. */
export const stoppedRemindersSchema = z.object({
  number: z.number().int().positive(),
  from: z.string().nullable(),
});

/** An invoice read alone or just created. */
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
  // Only in the owner's reads: null while not paid or once settled.
  settlementWait: settlementWaitSchema.nullable().optional(),
  // Only in the owner's reads: each Send to client, oldest first.
  sends: z.array(invoiceSendSchema).optional(),
  // Only in the owner's reads.
  reminders: invoiceRemindersSchema.optional(),
});

/** POST /v1/invoices/{id}/recheck (R-55): what Check status found. Amounts in base units. */
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
